"""marketing_digest job — bilingual social copy from live vision data.

Operator-armed, cost-gated (default-off cron, mirrors digest_daily). For
each active vision it assembles a *source-grounded snapshot* from the
same repository the recompute cron reads:

  1. Read each capability's current 4-dim score → composite (same Liebig
     aggregation recompute uses).
  2. The lowest composite is the **binding constraint** — the vision's
     feasibility-gating score.
  3. Pick the most impactful recent signal (largest |delta| in the
     window) + its source_url for provenance.
  4. Read the lead actor.
  5. POST the snapshot to agent-orchestration ``/marketing-content/
     generate`` → a bilingual (ko + en) Threads + Instagram post set.

The agent never invents numbers; everything in the snapshot traces to a
row. The CTA links the public vision page so the copy is product-led.

Per-vision failures are isolated — one bad vision doesn't kill the run.
The generated posts are returned in the stats (and logged) for the
operator to review + post manually; this job does NOT auto-publish.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from data_pipeline.jobs.recompute_feasibility import _aggregate_capability_composite
from data_pipeline.signal_repo import RecentSignalForScoring, SignalRepository

log = logging.getLogger(__name__)

_DEFAULT_AGENT_URL = "http://localhost:8002"
_DEFAULT_WEB_BASE_URL = "http://localhost:3000"
_RECENT_WINDOW_DAYS = 7
_RECENT_LIMIT = 100


@dataclass(slots=True)
class MarketingDigestStats:
    started_at: datetime
    finished_at: datetime | None = None
    visions_processed: int = 0
    visions_skipped_no_capabilities: int = 0
    post_sets_generated: int = 0
    agent_failures: int = 0
    total_cost_usd: float = 0.0
    # One entry per vision that produced copy: {slug, headline_insight,
    # angle, post_set, cost_usd}. The operator reviews + posts manually.
    results: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _dominant_delta(s: RecentSignalForScoring) -> float | None:
    """The largest-magnitude per-dimension delta this signal carried —
    used to rank signals by impact + as the headline 'what moved' pts."""
    deltas = [
        d
        for d in (
            s.delta_technical,
            s.delta_economic,
            s.delta_regulatory,
            s.delta_supply,
        )
        if d is not None
    ]
    if not deltas:
        return None
    return max(deltas, key=abs)


def _notable_signal_payload(s: RecentSignalForScoring) -> dict[str, Any]:
    domain = urlparse(s.source_url).netloc or None if s.source_url else None
    return {
        "title": s.title,
        "source_kind": s.source_kind,
        "source_domain": domain,
        "summary": s.summary,
        "published_at": (
            s.published_at.isoformat()[:10] if s.published_at else None
        ),
        "dominant_delta": _dominant_delta(s),
    }


async def _build_snapshot(
    *,
    slug: str,
    repo: SignalRepository,
    web_base_url: str,
    since: datetime,
    limit: int,
) -> dict[str, Any] | None:
    """Assemble a VisionMarketingSnapshot payload for one vision, or None
    when the vision has no capabilities (nothing to say yet)."""
    caps = await repo.list_vision_capabilities(slug)
    if not caps:
        return None

    capability_payloads: list[dict[str, Any]] = []
    binding_name: str | None = None
    binding_score: float | None = None
    best_signal: RecentSignalForScoring | None = None
    best_signal_rank = -1.0

    for cap in caps:
        current = await repo.get_current_capability_score(cap.id)
        composite = None
        if current is not None:
            composite, _p10, _p90 = _aggregate_capability_composite(
                current.technical,
                current.economic,
                current.regulatory,
                current.supply,
            )
        capability_payloads.append(
            {"name": cap.name, "composite": composite, "is_binding": False}
        )
        if composite is not None and (
            binding_score is None or composite < binding_score
        ):
            binding_score = composite
            binding_name = cap.name

        signals = await repo.list_recent_signals_for_capability(
            cap.id, since=since, limit=limit
        )
        for s in signals:
            dd = _dominant_delta(s)
            rank = abs(dd) if dd is not None else 0.0
            if rank > best_signal_rank:
                best_signal_rank = rank
                best_signal = s

    # Flag the binding capability so the agent can frame Liebig correctly.
    if binding_name is not None:
        for cp in capability_payloads:
            if cp["name"] == binding_name:
                cp["is_binding"] = True
                break

    actors = await repo.list_vision_actors(slug)
    lead_actor = None
    if actors:
        lead_actor = actors[0].short_name or actors[0].name

    return {
        "vision_name": caps[0].sector_slug.replace("-", " ").title(),
        "vision_slug": slug,
        "vision_url": f"{web_base_url.rstrip('/')}/visions/{slug}",
        "binding_constraint_score": binding_score,
        "binding_capability_name": binding_name,
        "capabilities": capability_payloads[:12],
        "notable_signal": (
            _notable_signal_payload(best_signal) if best_signal else None
        ),
        "lead_actor_name": lead_actor,
    }


async def _call_marketing_agent(
    *, agent_url: str, client: httpx.AsyncClient, snapshot: dict[str, Any]
) -> dict | None:
    try:
        resp = await client.post(
            f"{agent_url}/marketing-content/generate",
            json=snapshot,
            timeout=90.0,  # balanced + adaptive_thinking + bilingual output
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        log.warning(
            "marketing-content failed for %s: %s", snapshot.get("vision_slug"), e
        )
        return None


async def run_marketing_digest(
    *,
    sector_slugs: list[str],
    repo: SignalRepository,
    job_config: Any = None,
    agent_url: str | None = None,
    web_base_url: str | None = None,
    window_days: int | None = None,
    limit: int | None = None,
) -> MarketingDigestStats:
    """One marketing-digest pass — one bilingual post set per vision."""
    if agent_url is None:
        agent_url = os.environ.get("AGENT_ORCHESTRATION_URL", _DEFAULT_AGENT_URL)
    if web_base_url is None:
        web_base_url = os.environ.get("PUBLIC_WEB_BASE_URL", _DEFAULT_WEB_BASE_URL)

    if window_days is None:
        if job_config is not None:
            window_days = await job_config.get_typed(
                "RECOMPUTE_WINDOW_DAYS", default=_RECENT_WINDOW_DAYS, kind="int"
            )
        else:
            window_days = _RECENT_WINDOW_DAYS
    if limit is None:
        if job_config is not None:
            limit = await job_config.get_typed(
                "RECOMPUTE_LIMIT", default=_RECENT_LIMIT, kind="int"
            )
        else:
            limit = _RECENT_LIMIT

    stats = MarketingDigestStats(started_at=datetime.now(UTC))
    since = datetime.now(UTC) - timedelta(days=window_days)

    async with httpx.AsyncClient() as client:
        for slug in sector_slugs:
            snapshot = await _build_snapshot(
                slug=slug,
                repo=repo,
                web_base_url=web_base_url,
                since=since,
                limit=limit,
            )
            if snapshot is None:
                stats.visions_skipped_no_capabilities += 1
                continue
            stats.visions_processed += 1

            body = await _call_marketing_agent(
                agent_url=agent_url, client=client, snapshot=snapshot
            )
            if body is None:
                stats.agent_failures += 1
                continue

            cost = float(body.get("cost_usd", 0))
            stats.total_cost_usd += cost
            post_set = body.get("post_set") or {}
            stats.post_sets_generated += 1
            stats.results.append(
                {
                    "slug": slug,
                    "headline_insight": post_set.get("headline_insight", ""),
                    "angle": post_set.get("angle", ""),
                    "post_set": post_set,
                    "cost_usd": cost,
                }
            )

    stats.finished_at = datetime.now(UTC)
    log.info(
        "marketing_digest: visions=%d post-sets=%d failures=%d skipped=%d cost=$%.4f",
        stats.visions_processed,
        stats.post_sets_generated,
        stats.agent_failures,
        stats.visions_skipped_no_capabilities,
        stats.total_cost_usd,
    )
    return stats
