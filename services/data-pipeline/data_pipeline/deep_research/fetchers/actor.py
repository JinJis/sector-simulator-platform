"""ActorFetcher (M49b).

Per actor the orchestrator picks (top-N relevance per vision per day),
ask the Gemini Deep Research Agent for a 90-day synthesis of the
actor's activity *for this vision*, hand the synthesis to the existing
SignalExtractor agent (haiku) — passing the actor's signal_keywords so
the extractor can confirm the match — and upsert the result as one
`signals` row tagged with both the actor and the actor's primary
capability.

One run = one CrawlRun row = one Signal row (per actor per day).
Re-runs on the same UTC day collapse via the `(source_url, capability_id)`
unique constraint — `internal://crawler/actor/{vision}/{actor_key}/{date}`
is the synthetic source_url that gives us the idempotency window.

Anchoring against the actor's primary CapabilityActor binding is a
deliberate v1 choice: `signals.capability_id` is part of the dedup key,
and the actor's lead capability is the closest semantic anchor for a
"what has X been up to" synthesis. The actor_id field is what the
Capability card's actor footer + the M53 ActorRelevanceBubble read.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from agent_tools import (
    GroundedResearchClient,
    GroundedResearchResult,
    grounded_model_for,
)

from data_pipeline.agents import (
    ActorKeywordSet,
    AgentClient,
    SignalExtractorRequest,
    SignalExtractorRunResult,
)
from data_pipeline.db.actor_reader import ActorReader, ActorRecord
from data_pipeline.db.signal_writer import SignalUpsert, SignalWriter
from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow

_DEFAULT_PROMPT = (
    "You are researching what '{actor_name}' has done in the last 90 days "
    "that materially advances or hinders the vision '{vision_slug}', "
    "specifically in the context of the capability '{capability_name}'.\n\n"
    "Capability context: {capability_description}\n"
    "Why this capability matters: {capability_rationale}\n\n"
    "Synthesize {actor_name}'s recent moves — product launches, "
    "publications, filings, hires, partnerships, regulatory submissions, "
    "earnings commentary — and assess net impact on the four dimensions: "
    "technical maturity, economic viability, regulatory posture, and "
    "supply / talent / capital. Cite primary sources (press releases, "
    "papers, filings, news) inline. Be specific about WHAT they shipped "
    "or shifted. Keep it under ~400 words."
)


@dataclass(frozen=True, slots=True)
class ActorFetchRequest:
    vision_slug: str
    actor_key: str
    prompt: str | None = None  # override the default prompt template


@dataclass(frozen=True, slots=True)
class ActorFetchResult:
    run: CrawlRunRow
    actor: ActorRecord
    deep_research: GroundedResearchResult
    scoring: SignalExtractorRunResult | None
    signal_id: str | None


class ActorFetcherError(Exception):
    """Raised when the fetcher refuses to even attempt the run (e.g.
    unknown actor or actor not bound to any capability in this vision).
    The crawler endpoint maps this to a 404 instead of a generic 500."""

    def __init__(self, message: str, *, run: CrawlRunRow) -> None:
        super().__init__(message)
        self.run = run


def _synthetic_source_url(*, actor_key: str, vision_slug: str, as_of: datetime) -> str:
    """Day-bucketed pseudo-URL so multiple runs in the same UTC day
    collapse to one Signal row via the unique constraint."""
    day = as_of.strftime("%Y-%m-%d")
    return f"internal://crawler/actor/{vision_slug}/{actor_key}/{day}"


def _actor_plan(request: ActorFetchRequest) -> dict[str, Any]:
    return {
        "fetcher": "actor",
        "vision_slug": request.vision_slug,
        "actor_key": request.actor_key,
        "prompt_override": request.prompt is not None,
        "tier": "fast",
    }


async def enqueue_actor_fetcher(
    request: ActorFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
) -> CrawlRunRow:
    """HTTP-side: create the queued CrawlRun row. Worker calls
    `run_actor_fetcher(existing_run=…)` to execute."""
    return await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="actor",
        plan=_actor_plan(request),
    )


async def run_actor_fetcher(
    request: ActorFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
    actor_reader: ActorReader,
    signal_writer: SignalWriter,
    deep_research: GroundedResearchClient,
    agent_client: AgentClient,
    existing_run: CrawlRunRow | None = None,
) -> ActorFetchResult:
    run = existing_run or await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="actor",
        plan=_actor_plan(request),
    )
    await runs_repo.mark_running(run.id)

    # 1. Load actor + its primary capability binding. Two refusal modes:
    #    (a) unknown actor or actor not bound to the vision, and
    #    (b) actor bound to the vision but no CapabilityActor row — we
    #        have nothing to anchor the signal against.
    actor = await actor_reader.get(sector_slug=request.vision_slug, actor_key=request.actor_key)
    if actor is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "actor_not_found",
                "vision_slug": request.vision_slug,
                "actor_key": request.actor_key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(f"no actor {request.actor_key!r} bound to vision {request.vision_slug!r}"),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise ActorFetcherError(
            f"actor not found: {request.vision_slug}/{request.actor_key}",
            run=fresh,
        )

    if actor.primary_capability is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "actor_unbound",
                "vision_slug": request.vision_slug,
                "actor_key": request.actor_key,
                "actor_id": actor.id,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(
                f"actor {request.actor_key!r} has no capability binding "
                f"in vision {request.vision_slug!r}"
            ),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise ActorFetcherError(
            f"actor unbound: {request.vision_slug}/{request.actor_key}",
            run=fresh,
        )

    capability = actor.primary_capability

    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug,
        actor_name=actor.name,
        capability_name=capability.name,
        capability_description=capability.description,
        capability_rationale=capability.rationale,
    )

    # 2. Deep Research synthesis. DR client owns cache + cost metering.
    try:
        dr = await deep_research.research(
            prompt=prompt,
            surface="actor",
            vision_slug=request.vision_slug,
            tier="fast",
        )
    except Exception as exc:  # noqa: BLE001
        err_text = (
            f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else 'unknown error'}"
        )
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": type(exc).__name__,
                "actor_id": actor.id,
                "actor_key": actor.key,
                "capability_id": capability.id,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return ActorFetchResult(
            run=fresh,
            actor=actor,
            deep_research=GroundedResearchResult(
                interaction_id="",
                tier="fast",
                model=grounded_model_for("fast"),
                status="error",
                output_text="",
                error=err_text,
                cached=False,
                cost_usd=0.0,
                elapsed_seconds=0.0,
                raw_usage={},
            ),
            scoring=None,
            signal_id=None,
        )

    total_cost = dr.cost_usd
    signals_written = 0
    scoring: SignalExtractorRunResult | None = None
    signal_id: str | None = None

    if dr.status != "completed" or not dr.output_text:
        await runs_repo.mark_complete(
            run.id,
            status=dr.status if dr.status == "timeout" else "error",
            result_summary=_summarize(dr=dr, scoring=None, actor=actor),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=dr.error or "deep research returned empty output",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return ActorFetchResult(
            run=fresh,
            actor=actor,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )

    # 3. SignalExtractor — pass the actor's keyword set so the extractor
    # confirms the match. We still set actor_id directly on the Signal
    # row below regardless of matched_actor_key (the fetcher is per-actor
    # by construction); the extractor signal is used for sanity reporting.
    signal_title = _first_sentence(dr.output_text)
    extractor_req = SignalExtractorRequest(
        sector_slug=capability.sector_slug,
        capability_key=capability.key,
        capability_name=capability.name,
        capability_description=capability.description or "",
        capability_rationale=capability.rationale or "",
        signal_title=signal_title,
        signal_summary=dr.output_text,
        source_kind="research_brief",
        actor_keywords=[
            ActorKeywordSet(
                actor_key=actor.key,
                aliases=actor.signal_keywords,
            )
        ],
    )
    try:
        scoring = await agent_client.score_signal(extractor_req)
    except Exception as exc:  # noqa: BLE001
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary=_summarize(dr=dr, scoring=None, actor=actor),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=f"signal extractor failed: {exc}",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return ActorFetchResult(
            run=fresh,
            actor=actor,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )
    total_cost += scoring.cost_usd

    # 4. Signal upsert. Day-bucketed source_url + capability_id is the
    # dedup key; actor_id is the fetcher's whole point.
    now = datetime.now(UTC)
    upsert = SignalUpsert(
        sector_slug=capability.sector_slug,
        capability_id=capability.id,
        actor_id=actor.id,
        source_kind="research_brief",
        source_url=_synthetic_source_url(
            actor_key=actor.key,
            vision_slug=capability.sector_slug,
            as_of=now,
        ),
        source_id_ext=dr.interaction_id,
        title=signal_title,
        summary=dr.output_text,
        published_at=now,
        delta_technical=scoring.scoring.delta_technical
        if scoring.scoring.confidence >= 0.5
        else None,
        delta_economic=scoring.scoring.delta_economic
        if scoring.scoring.confidence >= 0.5
        else None,
        delta_regulatory=scoring.scoring.delta_regulatory
        if scoring.scoring.confidence >= 0.5
        else None,
        delta_supply=scoring.scoring.delta_supply if scoring.scoring.confidence >= 0.5 else None,
        is_highlight=scoring.scoring.is_highlight,
    )
    signal_id = await signal_writer.upsert(upsert)
    signals_written = 1

    await runs_repo.mark_complete(
        run.id,
        status="ok",
        result_summary=_summarize(dr=dr, scoring=scoring, actor=actor),
        cost_usd=total_cost if total_cost > 0 else None,
        signals_written=signals_written,
        proposals_written=0,
        error=None,
    )
    fresh = await runs_repo.get(run.id)
    assert fresh is not None
    return ActorFetchResult(
        run=fresh,
        actor=actor,
        deep_research=dr,
        scoring=scoring,
        signal_id=signal_id,
    )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _first_sentence(text: str) -> str:
    """Best-effort first-sentence extraction for the Signal title.
    Falls back to the first 240 chars if we can't find a sentence
    boundary."""
    for end in (".", "?", "!", "\n"):
        idx = text.find(end)
        if 0 < idx < 240:
            return text[: idx + 1].strip()
    return text[:240].strip()


def _summarize(
    *,
    dr: GroundedResearchResult,
    scoring: SignalExtractorRunResult | None,
    actor: ActorRecord,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "actor_id": actor.id,
        "actor_key": actor.key,
        "actor_name": actor.name,
        "primary_capability_id": actor.primary_capability.id
        if actor.primary_capability is not None
        else None,
        "primary_capability_key": actor.primary_capability.key
        if actor.primary_capability is not None
        else None,
        "interaction_id": dr.interaction_id,
        "model": dr.model,
        "dr_status": dr.status,
        "dr_cached": dr.cached,
        "dr_elapsed_seconds": round(dr.elapsed_seconds, 3),
        "output_preview": dr.output_text[:280],
        "citations": [
            {"url": c.url, "title": c.title} for c in dr.citations
        ],
    }
    if scoring is not None:
        out["scoring"] = {
            "confidence": scoring.scoring.confidence,
            "delta_technical": scoring.scoring.delta_technical,
            "delta_economic": scoring.scoring.delta_economic,
            "delta_regulatory": scoring.scoring.delta_regulatory,
            "delta_supply": scoring.scoring.delta_supply,
            "is_highlight": scoring.scoring.is_highlight,
            "matched_actor_key": scoring.scoring.matched_actor_key,
            "rationale": scoring.scoring.rationale,
            "cost_usd": scoring.cost_usd,
        }
    return out
