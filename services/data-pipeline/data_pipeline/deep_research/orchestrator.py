"""Orchestrator (M49f).

Picks which (vision × fetcher × key) to dispatch this tick. Pure
scoring + budget-aware top-K — no dispatch (that's `dispatcher.py`).

composition.md §4 formula:

  score(candidate) =
       W_binding   * (100 - anchor_composite)        # bottom-half caps first
     + W_stale     * hours_since_last_update
     + W_priority  * (100 if vision_pinned else 0)
     - W_cost      * estimated_cost_usd

Budget: per-vision daily $/day cap. The picker reads the last 24h of
CrawlRun cost per vision and skips candidates whose estimated cost
would push the vision over the cap. Top-K cap across all visions
prevents one tick from queueing the whole world.

Admin pinning isn't surfaced yet (M52 cockpit ships the toggle); the
function accepts a `pinned_visions` set so the API is ready.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from data_pipeline.deep_research.config import CONFIG, OrchestratorConfig
from data_pipeline.db.orchestrator_repo import (
    ActorCandidate,
    CapabilityCandidate,
    OrchestratorReader,
    RiskCandidate,
)


@dataclass(frozen=True, slots=True)
class Candidate:
    vision_slug: str
    fetcher_kind: str  # capability | actor | risk | signal
    key: str  # capability_key | actor_key | risk_key
    anchor_composite: float | None
    stale_hours: float
    estimated_cost_usd: float
    ranking_score: float


@dataclass(slots=True)
class PickResult:
    picked: list[Candidate]
    # Stats useful for the cockpit + tests.
    total_candidates: int = 0
    over_budget_skipped: int = 0
    per_vision_remaining_usd: dict[str, float] = field(default_factory=dict)


def _hours_between(later: datetime, earlier: datetime) -> float:
    """Hours between two datetimes, tolerant of naive vs aware.

    Prisma's default `DateTime` maps to Postgres `timestamp` (no
    timezone), so asyncpg returns naive values for crawl_runs.ended_at
    etc. — but `now` here is `datetime.now(UTC)` (aware). Subtracting
    them raises `TypeError: can't subtract offset-naive and offset-
    aware datetimes`. Normalise to UTC-aware before subtracting.

    All timestamps the pipeline writes ARE in UTC (we write `now(UTC)`
    everywhere), so treating a naive value as UTC is correct here —
    not a guess.
    """
    if later.tzinfo is None:
        later = later.replace(tzinfo=UTC)
    if earlier.tzinfo is None:
        earlier = earlier.replace(tzinfo=UTC)
    delta = later - earlier
    return max(0.0, delta.total_seconds() / 3600.0)


def score_candidate(
    *,
    anchor_composite: float | None,
    stale_hours: float,
    estimated_cost_usd: float,
    pinned: bool,
    config: OrchestratorConfig,
) -> float:
    """Pure formula — extracted so tests can pin behavior."""
    # When a capability has no composite score yet, treat it as if
    # binding (score 0) so it gets first-look attention.
    binding_term = config.w_binding * (100.0 - (anchor_composite or 0.0))
    stale_term = config.w_stale * stale_hours
    priority_term = config.w_priority * (100.0 if pinned else 0.0)
    cost_term = config.w_cost * estimated_cost_usd
    return binding_term + stale_term + priority_term - cost_term


async def _build_candidates_for_vision(
    *,
    reader: OrchestratorReader,
    vision_slug: str,
    pinned: bool,
    config: OrchestratorConfig,
    now: datetime,
) -> list[Candidate]:
    cands: list[Candidate] = []

    # Capability fetcher (one per capability).
    cap_rows: list[CapabilityCandidate] = await reader.list_capability_candidates(
        vision_slug=vision_slug
    )
    for c in cap_rows:
        last = await reader.last_run_ended_at(
            vision_slug=vision_slug,
            fetcher_kind="capability",
            key=c.capability_key,
        )
        stale = _hours_between(now, last) if last is not None else config.stale_hours_fallback
        cost = config.estimated_cost("capability")
        rs = score_candidate(
            anchor_composite=c.composite_score,
            stale_hours=stale,
            estimated_cost_usd=cost,
            pinned=pinned,
            config=config,
        )
        cands.append(
            Candidate(
                vision_slug=vision_slug,
                fetcher_kind="capability",
                key=c.capability_key,
                anchor_composite=c.composite_score,
                stale_hours=stale,
                estimated_cost_usd=cost,
                ranking_score=rs,
            )
        )

    # Signal fetcher (also keyed by capability_key, but separate cadence).
    for c in cap_rows:
        last = await reader.last_run_ended_at(
            vision_slug=vision_slug,
            fetcher_kind="signal",
            key=c.capability_key,
        )
        stale = _hours_between(now, last) if last is not None else config.stale_hours_fallback
        cost = config.estimated_cost("signal")
        rs = score_candidate(
            anchor_composite=c.composite_score,
            stale_hours=stale,
            estimated_cost_usd=cost,
            pinned=pinned,
            config=config,
        )
        cands.append(
            Candidate(
                vision_slug=vision_slug,
                fetcher_kind="signal",
                key=c.capability_key,
                anchor_composite=c.composite_score,
                stale_hours=stale,
                estimated_cost_usd=cost,
                ranking_score=rs,
            )
        )

    # Actor fetcher.
    actor_rows: list[ActorCandidate] = await reader.list_actor_candidates(vision_slug=vision_slug)
    for a in actor_rows:
        # Actors without a capability binding can't anchor a Signal —
        # ActorFetcher would 404. Skip them at the orchestrator level
        # too so we don't waste a tick slot.
        if a.anchor_composite_score is None:
            continue
        last = await reader.last_run_ended_at(
            vision_slug=vision_slug,
            fetcher_kind="actor",
            key=a.actor_key,
        )
        stale = _hours_between(now, last) if last is not None else config.stale_hours_fallback
        cost = config.estimated_cost("actor")
        rs = score_candidate(
            anchor_composite=a.anchor_composite_score,
            stale_hours=stale,
            estimated_cost_usd=cost,
            pinned=pinned,
            config=config,
        )
        cands.append(
            Candidate(
                vision_slug=vision_slug,
                fetcher_kind="actor",
                key=a.actor_key,
                anchor_composite=a.anchor_composite_score,
                stale_hours=stale,
                estimated_cost_usd=cost,
                ranking_score=rs,
            )
        )

    # Risk fetcher.
    risk_rows: list[RiskCandidate] = await reader.list_risk_candidates(vision_slug=vision_slug)
    for r in risk_rows:
        if r.anchor_composite_score is None:
            continue
        last = await reader.last_run_ended_at(
            vision_slug=vision_slug,
            fetcher_kind="risk",
            key=r.risk_key,
        )
        stale = _hours_between(now, last) if last is not None else config.stale_hours_fallback
        cost = config.estimated_cost("risk")
        rs = score_candidate(
            anchor_composite=r.anchor_composite_score,
            stale_hours=stale,
            estimated_cost_usd=cost,
            pinned=pinned,
            config=config,
        )
        cands.append(
            Candidate(
                vision_slug=vision_slug,
                fetcher_kind="risk",
                key=r.risk_key,
                anchor_composite=r.anchor_composite_score,
                stale_hours=stale,
                estimated_cost_usd=cost,
                ranking_score=rs,
            )
        )

    return cands


async def pick_for_tick(
    *,
    reader: OrchestratorReader,
    config: OrchestratorConfig = CONFIG,
    pinned_visions: set[str] | None = None,
    now: datetime | None = None,
) -> PickResult:
    """Build candidates → score → greedy top-K under per-vision $/day cap."""
    pinned = pinned_visions or set()
    now = now or datetime.now(UTC)
    # `daily_cost_usd_since` binds `since` against `crawl_runs.ended_at`,
    # a Postgres `timestamp` (no tz) since Prisma's default DateTime
    # maps that way. asyncpg refuses to bind an aware datetime to a
    # naive column — strip the tz here so the parameter shape matches.
    # All comparisons are in UTC either way (we always write `now(UTC)`).
    since = (now - timedelta(hours=24)).replace(tzinfo=None)

    visions = await reader.list_vision_slugs()
    all_cands: list[Candidate] = []
    for slug in visions:
        all_cands.extend(
            await _build_candidates_for_vision(
                reader=reader,
                vision_slug=slug,
                pinned=slug in pinned,
                config=config,
                now=now,
            )
        )

    # Pre-load current 24h cost per vision so we can stop adding once
    # a vision is over its cap. Tick-local mutable map.
    cost_so_far: dict[str, float] = {}
    for slug in visions:
        cost_so_far[slug] = await reader.daily_cost_usd_since(vision_slug=slug, since=since)
    remaining: dict[str, float] = {
        slug: max(0.0, config.per_vision_daily_usd_cap - cost_so_far[slug]) for slug in visions
    }

    # Greedy: sort by ranking_score desc, pick if vision has budget.
    all_cands.sort(key=lambda c: c.ranking_score, reverse=True)
    picked: list[Candidate] = []
    skipped = 0
    for cand in all_cands:
        if len(picked) >= config.top_k_per_tick:
            break
        rem = remaining.get(cand.vision_slug, 0.0)
        if cand.estimated_cost_usd > rem:
            skipped += 1
            continue
        picked.append(cand)
        remaining[cand.vision_slug] = rem - cand.estimated_cost_usd

    return PickResult(
        picked=picked,
        total_candidates=len(all_cands),
        over_budget_skipped=skipped,
        per_vision_remaining_usd=remaining,
    )
