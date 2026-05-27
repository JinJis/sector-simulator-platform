"""CapabilityFetcher (M49a).

Per binding capability the orchestrator picks, ask the Gemini Deep
Research Agent for a current-state synthesis, hand the synthesis to
the existing SignalExtractor agent (haiku) for per-dimension scoring,
and upsert the result as one `signals` row tagged with the capability.

One run = one CrawlRun row = one Signal row (per capability per day).
Re-runs on the same day collapse via the `(source_url, capability_id)`
unique constraint — `internal://crawler/capability/{cap_key}/{date}`
is the synthetic source_url that gives us the idempotency window.

Discrete events (papers / patents / news) still come through the M39
SignalFetcher (wrapped in M49e); this fetcher produces the synthesized
"state of X" signal that M51's capability card surfaces above them.
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
    AgentClient,
    SignalExtractorRequest,
    SignalExtractorRunResult,
)
from data_pipeline.db.capability_reader import CapabilityReader, CapabilityRecord
from data_pipeline.db.signal_writer import SignalUpsert, SignalWriter
from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow


_DEFAULT_PROMPT = (
    "You are researching the current state of the technical capability "
    "'{capability_name}' for the broader vision '{vision_slug}'.\n\n"
    "Capability description: {description}\n"
    "Why it matters: {rationale}\n\n"
    "Synthesize what has happened in the last 90 days that materially "
    "changed any of the four dimensions: technical maturity, economic "
    "viability, regulatory posture, and supply / talent / capital. Cite "
    "primary sources (papers, filings, press, gov releases) inline. "
    "Be specific about WHO did WHAT — name companies, labs, or programs. "
    "Keep it under ~400 words."
)


@dataclass(frozen=True, slots=True)
class CapabilityFetchRequest:
    vision_slug: str
    capability_key: str
    prompt: str | None = None  # override the default prompt template


@dataclass(frozen=True, slots=True)
class CapabilityFetchResult:
    run: CrawlRunRow
    capability: CapabilityRecord
    deep_research: GroundedResearchResult
    scoring: SignalExtractorRunResult | None
    signal_id: str | None


def _synthetic_source_url(*, capability_key: str, vision_slug: str, as_of: datetime) -> str:
    """Day-bucketed pseudo-URL so multiple runs in the same UTC day
    collapse to one Signal row via the unique constraint."""
    day = as_of.strftime("%Y-%m-%d")
    return f"internal://crawler/capability/{vision_slug}/{capability_key}/{day}"


def _capability_plan(request: CapabilityFetchRequest) -> dict[str, Any]:
    return {
        "fetcher": "capability",
        "vision_slug": request.vision_slug,
        "capability_key": request.capability_key,
        "prompt_override": request.prompt is not None,
        "tier": "fast",
    }


async def enqueue_capability_fetcher(
    request: CapabilityFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
) -> CrawlRunRow:
    """HTTP-side: create the queued CrawlRun row so the trigger
    returns immediately. The worker picks up the row via ARQ and
    calls `run_capability_fetcher(existing_run=…)`."""
    return await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="capability",
        plan=_capability_plan(request),
    )


async def run_capability_fetcher(
    request: CapabilityFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
    capability_reader: CapabilityReader,
    signal_writer: SignalWriter,
    deep_research: GroundedResearchClient,
    agent_client: AgentClient,
    existing_run: CrawlRunRow | None = None,
) -> CapabilityFetchResult:
    run = existing_run or await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="capability",
        plan=_capability_plan(request),
    )
    await runs_repo.mark_running(run.id)

    # 1. Load capability metadata. A missing capability is the only
    # expected failure mode that we surface as a polite error rather
    # than an exception — admins type slugs by hand into the cockpit.
    capability = await capability_reader.get(
        sector_slug=request.vision_slug, capability_key=request.capability_key
    )
    if capability is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "capability_not_found",
                "vision_slug": request.vision_slug,
                "capability_key": request.capability_key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(
                f"no capability {request.capability_key!r} "
                f"for vision {request.vision_slug!r}"
            ),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise CapabilityFetcherError(
            f"capability not found: {request.vision_slug}/{request.capability_key}",
            run=fresh,
        )

    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug,
        capability_name=capability.name,
        description=capability.description,
        rationale=capability.rationale,
    )

    # 2. Deep Research synthesis. The DR client owns cache + cost
    # metering; we just read the result. If the call itself blows up
    # (e.g. Gemini auth / quota), record the failure on the run and
    # return — callers want a structured response, not an exception.
    try:
        dr = await deep_research.research(
            prompt=prompt,
            surface="capability",
            vision_slug=request.vision_slug,
            tier="fast",
        )
    except Exception as exc:  # noqa: BLE001
        err_text = (
            f"{type(exc).__name__}: "
            f"{str(exc).splitlines()[0] if str(exc) else 'unknown error'}"
        )
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": type(exc).__name__,
                "capability_id": capability.id,
                "capability_key": capability.key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return CapabilityFetchResult(
            run=fresh,
            capability=capability,
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
        # DR failed or timed out — record what we have, no Signal row.
        await runs_repo.mark_complete(
            run.id,
            status=dr.status if dr.status == "timeout" else "error",
            result_summary=_summarize(dr=dr, scoring=None, capability=capability),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=dr.error or "deep research returned empty output",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return CapabilityFetchResult(
            run=fresh,
            capability=capability,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )

    # 3. SignalExtractor: score the DR brief across the 4 dims.
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
        # M50 will populate actor_keywords from the actors table; M49a
        # leaves it empty (extractor returns matched_actor_key=null,
        # which is fine — the Signal row stays untagged for now).
        actor_keywords=[],
    )
    try:
        scoring = await agent_client.score_signal(extractor_req)
    except Exception as exc:  # noqa: BLE001
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary=_summarize(dr=dr, scoring=None, capability=capability),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=f"signal extractor failed: {exc}",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return CapabilityFetchResult(
            run=fresh,
            capability=capability,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )
    total_cost += scoring.cost_usd

    # 4. Signal upsert. Day-bucketed source_url is the dedup key.
    now = datetime.now(UTC)
    upsert = SignalUpsert(
        sector_slug=capability.sector_slug,
        capability_id=capability.id,
        actor_id=None,  # actor resolution lands in M49b (ActorFetcher) + M50
        source_kind="research_brief",
        source_url=_synthetic_source_url(
            capability_key=capability.key,
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
        delta_supply=scoring.scoring.delta_supply
        if scoring.scoring.confidence >= 0.5
        else None,
        is_highlight=scoring.scoring.is_highlight,
    )
    signal_id = await signal_writer.upsert(upsert)
    signals_written = 1

    await runs_repo.mark_complete(
        run.id,
        status="ok",
        result_summary=_summarize(dr=dr, scoring=scoring, capability=capability),
        cost_usd=total_cost if total_cost > 0 else None,
        signals_written=signals_written,
        proposals_written=0,
        error=None,
    )
    fresh = await runs_repo.get(run.id)
    assert fresh is not None
    return CapabilityFetchResult(
        run=fresh,
        capability=capability,
        deep_research=dr,
        scoring=scoring,
        signal_id=signal_id,
    )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


class CapabilityFetcherError(Exception):
    """Raised when the fetcher refuses to even attempt the run (e.g.
    unknown capability). The crawler endpoint maps this to a 404
    instead of a generic 500."""

    def __init__(self, message: str, *, run: CrawlRunRow) -> None:
        super().__init__(message)
        self.run = run


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
    capability: CapabilityRecord,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "capability_id": capability.id,
        "capability_key": capability.key,
        "capability_name": capability.name,
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
            "rationale": scoring.scoring.rationale,
            "cost_usd": scoring.cost_usd,
        }
    return out
