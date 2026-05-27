"""DigestFetcher (commit 5/6).

Once a day (manual trigger only at this commit; cron arming is a
follow-up) the operator can request a per-vision Deep Research digest:
"synthesize what happened across the {vision} space in the last 24 h
— industry/macro context the per-source crawlers won't have caught."

The output lands as one `signals` row anchored on the vision's first
listed capability with `source_kind="research_brief"` + a synthetic
`source_url=internal://digest/{vision}/{YYYY-MM-DD}`. Re-running the
same day collapses via the existing `(source_url, capability_id)`
unique constraint. SignalExtractor scoring is applied (same shape as
RiskFetcher), so the deltas flow into the next ScoreUpdater pass.

This is the "고급 크롤링" pole of the tiered ingest: the 5-min news /
hourly research crons stay narrow and source-grounded; the daily
digest brings the higher-context industry-shift framing.
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
from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow
from data_pipeline.db.signal_writer import (
    SignalCitation,
    SignalUpsert,
    SignalWriter,
)
from data_pipeline.signal_repo import CapabilityHandle, SignalRepository

_DEFAULT_PROMPT = (
    "You are writing the daily industry-shift digest for the vision "
    "'{vision_slug}'. Use Google Search grounding to pull from the "
    "last 24-72 hours of:\n"
    "  - sell-side equity research notes (broker reports, analyst "
    "    upgrades / downgrades on companies in this vision)\n"
    "  - academic + applied research (arXiv, preprint servers, lab "
    "    press releases on the underlying technology)\n"
    "  - regulatory + government program announcements (NRC, FCC, "
    "    DOE, MOTIE, etc. — anything that materially moves the "
    "    regulatory dimension)\n"
    "  - supply-chain shocks + hyperscaler capex announcements\n"
    "  - M&A / strategic partnership news\n"
    "  - macro context (rates, FX, commodities) that affects unit "
    "    economics for this vision's deployment path\n\n"
    "Cite primary sources inline (filings, gov releases, broker "
    "PDFs, reputable news). Be specific about WHO did WHAT.\n\n"
    "Assess net impact on the four dimensions (technical, economic, "
    "regulatory, supply) for the anchor capability "
    "'{capability_name}' — this is the capability the resulting "
    "signal will be attributed to in the feasibility model. Keep "
    "the synthesis under ~500 words; citations don't count toward "
    "the limit."
)


@dataclass(frozen=True, slots=True)
class DigestRequest:
    vision_slug: str
    prompt: str | None = None  # override the default template


@dataclass(frozen=True, slots=True)
class DigestResult:
    run: CrawlRunRow
    anchor_capability: CapabilityHandle | None
    deep_research: GroundedResearchResult
    scoring: SignalExtractorRunResult | None
    signal_id: str | None


class DigestError(Exception):
    """Raised when the digest refuses to even attempt the DR call —
    e.g. unknown vision or vision with no capabilities to anchor on.
    The endpoint maps this to a 404."""

    def __init__(self, message: str, *, run: CrawlRunRow) -> None:
        super().__init__(message)
        self.run = run


def _synthetic_source_url(*, vision_slug: str, as_of: datetime) -> str:
    """Day-bucketed pseudo-URL so re-running on the same UTC day
    collapses to one Signal row via the unique constraint."""
    day = as_of.strftime("%Y-%m-%d")
    return f"internal://digest/{vision_slug}/{day}"


async def _pick_binding_anchor(
    *,
    capabilities: list[CapabilityHandle],
    signal_repo: SignalRepository,
) -> CapabilityHandle:
    """Return the capability with the lowest Liebig composite — the
    minimum of (technical, economic, regulatory, supply) — across the
    vision. That's the rate-limiting capability under Liebig's law of
    the minimum, which matches how the vision aggregator computes
    feasibility. Un-scored or partially-scored capabilities sort
    after fully-scored ones so the digest doesn't keep re-anchoring
    on cold-start caps. If every capability is un-scored, falls back
    to capabilities[0].

    Caller has already guaranteed `capabilities` is non-empty.
    """
    # Issue per-cap score reads in parallel. N is typically ≤10 for a
    # well-formed vision so the fan-out cost is negligible vs the
    # subsequent DR + extractor calls.
    import asyncio  # noqa: PLC0415 — local to keep the module import light

    scores = await asyncio.gather(
        *(signal_repo.get_current_capability_score(c.id) for c in capabilities)
    )

    def _liebig_min(s) -> float | None:  # noqa: ANN001 — duck-typed
        if s is None:
            return None
        dims = [s.technical, s.economic, s.regulatory, s.supply]
        present = [d for d in dims if d is not None]
        if not present:
            return None
        return min(present)

    def _sort_key(idx: int) -> tuple[bool, float, int]:
        m = _liebig_min(scores[idx])
        # (m-is-None, m, original-index) — None sorts after numeric,
        # smaller min sorts first, ties broken by source-list order.
        return (m is None, m if m is not None else 0.0, idx)

    ranked = sorted(range(len(capabilities)), key=_sort_key)
    return capabilities[ranked[0]]


def _first_sentence(text: str) -> str:
    for end in (".", "?", "!", "\n"):
        idx = text.find(end)
        if 0 < idx < 240:
            return text[: idx + 1].strip()
    return text[:240].strip()


def _digest_plan(request: DigestRequest) -> dict[str, Any]:
    return {
        "fetcher": "digest",
        "vision_slug": request.vision_slug,
        "prompt_override": request.prompt is not None,
        "tier": "max",
    }


async def enqueue_deep_research_digest(
    request: DigestRequest,
    *,
    runs_repo: CrawlRunRepository,
) -> CrawlRunRow:
    """HTTP-side: create the queued CrawlRun row. Worker calls
    `run_deep_research_digest(existing_run=…)` to execute."""
    return await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="digest",
        plan=_digest_plan(request),
    )


async def run_deep_research_digest(
    request: DigestRequest,
    *,
    runs_repo: CrawlRunRepository,
    signal_repo: SignalRepository,
    signal_writer: SignalWriter,
    deep_research: GroundedResearchClient,
    agent_client: AgentClient,
    existing_run: CrawlRunRow | None = None,
) -> DigestResult:
    run = existing_run or await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="digest",
        plan=_digest_plan(request),
    )
    await runs_repo.mark_running(run.id)

    # 1. Pick the binding-capability anchor — the capability whose
    # current composite score is lowest is the rate-limiter on the
    # whole vision's feasibility, so attributing the digest there
    # puts the rollup's worst dimension under the most signal
    # pressure. Cold-start visions (every capability un-scored) fall
    # back to the first listed capability so the digest still runs.
    capabilities = await signal_repo.list_vision_capabilities(request.vision_slug)
    if not capabilities:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "no_capabilities_for_vision",
                "vision_slug": request.vision_slug,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=f"vision {request.vision_slug!r} has no capabilities — "
            "digest cannot anchor a signal",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise DigestError(
            f"digest unanchored: {request.vision_slug}",
            run=fresh,
        )

    anchor = await _pick_binding_anchor(
        capabilities=capabilities, signal_repo=signal_repo
    )
    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug,
        capability_name=anchor.name,
    )

    # 2. Deep Research synthesis. tier="max" — the digest is the one
    # surface in this service where the deeper Vertex DR variant is
    # explicitly warranted (industry/macro framing).
    try:
        dr = await deep_research.research(
            prompt=prompt,
            surface="digest",
            vision_slug=request.vision_slug,
            tier="max",
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
                "anchor_capability_id": anchor.id,
                "anchor_capability_key": anchor.key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return DigestResult(
            run=fresh,
            anchor_capability=anchor,
            deep_research=GroundedResearchResult(
                interaction_id="",
                tier="max",
                model=grounded_model_for("deep"),
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
            result_summary=_summarize(dr=dr, scoring=None, anchor=anchor),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=dr.error or "deep research returned empty output",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return DigestResult(
            run=fresh,
            anchor_capability=anchor,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )

    # 3. SignalExtractor — digests aren't tied to a specific actor, so
    # leave actor_keywords empty. matched_actor_key will be None.
    signal_title = _first_sentence(dr.output_text)
    extractor_req = SignalExtractorRequest(
        sector_slug=anchor.sector_slug,
        capability_key=anchor.key,
        capability_name=anchor.name,
        capability_description=anchor.description or "",
        capability_rationale=anchor.rationale or "",
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
            result_summary=_summarize(dr=dr, scoring=None, anchor=anchor),
            cost_usd=total_cost if total_cost > 0 else None,
            signals_written=0,
            proposals_written=0,
            error=f"signal extractor failed: {exc}",
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return DigestResult(
            run=fresh,
            anchor_capability=anchor,
            deep_research=dr,
            scoring=None,
            signal_id=None,
        )
    total_cost += scoring.cost_usd

    # 4. Signal upsert. Day-bucketed source_url + anchor capability_id
    # is the dedup key. Digests are always promoted (is_highlight=True);
    # the cockpit Highlights drawer surfaces them at the top.
    now = datetime.now(UTC)
    upsert = SignalUpsert(
        sector_slug=anchor.sector_slug,
        capability_id=anchor.id,
        actor_id=None,
        source_kind="research_brief",
        source_url=_synthetic_source_url(
            vision_slug=anchor.sector_slug,
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
        is_highlight=True,
        # Persist the grounded-search citations on the signal row so
        # the user-facing /visions/[slug]/signals view can render
        # them inline. Crawl_runs.result_summary keeps a copy for
        # the admin cockpit; both reads pull from the same source.
        citations=tuple(
            SignalCitation(url=c.url, title=c.title) for c in dr.citations
        ),
    )
    signal_id = await signal_writer.upsert(upsert)
    signals_written = 1

    await runs_repo.mark_complete(
        run.id,
        status="ok",
        result_summary=_summarize(dr=dr, scoring=scoring, anchor=anchor),
        cost_usd=total_cost if total_cost > 0 else None,
        signals_written=signals_written,
        proposals_written=0,
        error=None,
    )
    fresh = await runs_repo.get(run.id)
    assert fresh is not None
    return DigestResult(
        run=fresh,
        anchor_capability=anchor,
        deep_research=dr,
        scoring=scoring,
        signal_id=signal_id,
    )


def _summarize(
    *,
    dr: GroundedResearchResult,
    scoring: SignalExtractorRunResult | None,
    anchor: CapabilityHandle,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "anchor_capability_id": anchor.id,
        "anchor_capability_key": anchor.key,
        "anchor_capability_name": anchor.name,
        "interaction_id": dr.interaction_id,
        "model": dr.model,
        "dr_status": dr.status,
        "dr_cached": dr.cached,
        "dr_elapsed_seconds": round(dr.elapsed_seconds, 3),
        "output_preview": dr.output_text[:280],
        # Grounded search citations — the cockpit + source-chip strip
        # use this to render real URLs alongside the synthesis.
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
