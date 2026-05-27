"""RiskFetcher (M49d).

Per risk the orchestrator picks (curated risk refresh — discovery of
NEW risks lands in M50 via the proposal drafter), ask the Gemini Deep
Research Agent for a 90-day synthesis of regulatory + safety + supply-
shock evidence relevant to the risk, hand the synthesis to the
SignalExtractor agent, and upsert the result as one `signals` row
anchored on the risk's primary affected capability.

One run = one CrawlRun row = one Signal row (per risk per UTC day).
Re-runs on the same day collapse via the `(source_url, capability_id)`
unique constraint — `internal://crawler/risk/{vision}/{risk_key}/{date}`
is the synthetic source_url. The Signal carries the risk-relevant
deltas on the linked capability; `actor_id` stays null (risks are not
actors).

Risk discovery (new risk categories) is intentionally scoped out of
this fetcher — M50 EntityDetector handles that via Deep Research +
CommunityProposal drafts.
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
from data_pipeline.db.risk_reader import RiskReader, RiskRecord
from data_pipeline.db.signal_writer import SignalUpsert, SignalWriter
from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow

_DEFAULT_PROMPT = (
    "You are researching the risk '{risk_name}' for the vision "
    "'{vision_slug}'.\n\n"
    "Risk category: {category}\n"
    "Current severity: {severity} · likelihood: {likelihood} · "
    "horizon: {time_horizon}\n"
    "Description: {description}\n"
    "Curated mitigations: {mitigations}\n\n"
    "Synthesize what has happened in the last 90 days that materially "
    "raises or lowers this risk — regulatory actions, accidents, "
    "supply-shock events, court rulings, agency rulemakings, policy "
    "changes, industry safety advisories. Cite primary sources "
    "(filings, gov releases, accident reports, news) inline. Be "
    "specific about WHO did WHAT. Assess net impact on the four "
    "dimensions (technical, economic, regulatory, supply) for the "
    "anchor capability '{capability_name}'. Keep under ~400 words."
)


@dataclass(frozen=True, slots=True)
class RiskFetchRequest:
    vision_slug: str
    risk_key: str
    prompt: str | None = None  # override the default prompt template


@dataclass(frozen=True, slots=True)
class RiskFetchResult:
    run: CrawlRunRow
    risk: RiskRecord
    deep_research: GroundedResearchResult
    scoring: SignalExtractorRunResult | None
    signal_id: str | None


class RiskFetcherError(Exception):
    """Raised when the fetcher refuses to even attempt the run (e.g.
    unknown risk or risk with no resolvable affected capability). The
    crawler endpoint maps this to a 404 instead of a generic 500."""

    def __init__(self, message: str, *, run: CrawlRunRow) -> None:
        super().__init__(message)
        self.run = run


def _synthetic_source_url(*, risk_key: str, vision_slug: str, as_of: datetime) -> str:
    """Day-bucketed pseudo-URL so multiple runs in the same UTC day
    collapse to one Signal row via the unique constraint."""
    day = as_of.strftime("%Y-%m-%d")
    return f"internal://crawler/risk/{vision_slug}/{risk_key}/{day}"


def _risk_plan(request: RiskFetchRequest) -> dict[str, Any]:
    return {
        "fetcher": "risk",
        "vision_slug": request.vision_slug,
        "risk_key": request.risk_key,
        "prompt_override": request.prompt is not None,
        "tier": "fast",
    }


async def enqueue_risk_fetcher(
    request: RiskFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
) -> CrawlRunRow:
    """HTTP-side: create the queued CrawlRun row. Worker calls
    `run_risk_fetcher(existing_run=…)` to execute."""
    return await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="risk",
        plan=_risk_plan(request),
    )


async def run_risk_fetcher(
    request: RiskFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
    risk_reader: RiskReader,
    signal_writer: SignalWriter,
    deep_research: GroundedResearchClient,
    agent_client: AgentClient,
    existing_run: CrawlRunRow | None = None,
) -> RiskFetchResult:
    run = existing_run or await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="risk",
        plan=_risk_plan(request),
    )
    await runs_repo.mark_running(run.id)

    # 1. Load risk + its primary affected capability. Two refusal modes:
    #    (a) unknown risk for this vision, and
    #    (b) risk's affected_capability_keys[] resolves to zero rows in
    #        the capabilities table — nothing to anchor the signal on.
    risk = await risk_reader.get(sector_slug=request.vision_slug, risk_key=request.risk_key)
    if risk is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "risk_not_found",
                "vision_slug": request.vision_slug,
                "risk_key": request.risk_key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(f"no risk {request.risk_key!r} for vision {request.vision_slug!r}"),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise RiskFetcherError(
            f"risk not found: {request.vision_slug}/{request.risk_key}",
            run=fresh,
        )

    if risk.primary_capability is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "risk_unanchored",
                "vision_slug": request.vision_slug,
                "risk_key": request.risk_key,
                "risk_id": risk.id,
                "affected_capability_keys": risk.affected_capability_keys,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(
                f"risk {request.risk_key!r} has no resolvable affected "
                f"capability in vision {request.vision_slug!r}"
            ),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise RiskFetcherError(
            f"risk unanchored: {request.vision_slug}/{request.risk_key}",
            run=fresh,
        )

    capability = risk.primary_capability

    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug,
        risk_name=risk.name,
        category=risk.category,
        severity=risk.severity,
        likelihood=risk.likelihood,
        time_horizon=risk.time_horizon,
        description=risk.description,
        mitigations=risk.mitigations or "(none curated)",
        capability_name=capability.name,
    )

    # 2. Deep Research synthesis.
    try:
        dr = await deep_research.research(
            prompt=prompt,
            surface="risk",
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
                "risk_id": risk.id,
                "risk_key": risk.key,
                "capability_id": capability.id,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return RiskFetchResult(
            run=fresh,
            risk=risk,
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
    scoring: SignalExtractorRunResult | None = None
    signal_id: str | None = None
    signals_written = 0

    if dr.status != "completed" or not dr.output_text:
        await runs_repo.mark_complete(
            run.id,
            status=dr.status if dr.status == "timeout" else "error",
            result_summary=_summarize(dr=dr, scoring=None, risk=risk),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=dr.error or "deep research returned empty output",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return RiskFetchResult(
            run=fresh,
            risk=risk,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )

    # 3. SignalExtractor — risks aren't actors, so we leave
    # actor_keywords empty. The extractor will return
    # matched_actor_key=None which is the expected shape.
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
        actor_keywords=[],
    )
    try:
        scoring = await agent_client.score_signal(extractor_req)
    except Exception as exc:  # noqa: BLE001
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary=_summarize(dr=dr, scoring=None, risk=risk),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=f"signal extractor failed: {exc}",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return RiskFetchResult(
            run=fresh,
            risk=risk,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )
    total_cost += scoring.cost_usd

    # 4. Signal upsert. Day-bucketed source_url + the risk's anchor
    # capability_id is the dedup key. actor_id stays null.
    now = datetime.now(UTC)
    upsert = SignalUpsert(
        sector_slug=capability.sector_slug,
        capability_id=capability.id,
        actor_id=None,
        source_kind="research_brief",
        source_url=_synthetic_source_url(
            risk_key=risk.key,
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
        result_summary=_summarize(dr=dr, scoring=scoring, risk=risk),
        cost_usd=total_cost if total_cost > 0 else None,
        signals_written=signals_written,
        proposals_written=0,
        error=None,
    )
    fresh = await runs_repo.get(run.id)
    assert fresh is not None
    return RiskFetchResult(
        run=fresh,
        risk=risk,
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
    risk: RiskRecord,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "risk_id": risk.id,
        "risk_key": risk.key,
        "risk_name": risk.name,
        "risk_severity": risk.severity,
        "risk_likelihood": risk.likelihood,
        "primary_capability_id": risk.primary_capability.id
        if risk.primary_capability is not None
        else None,
        "primary_capability_key": risk.primary_capability.key
        if risk.primary_capability is not None
        else None,
        "curated_source_url": risk.source_url,
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
