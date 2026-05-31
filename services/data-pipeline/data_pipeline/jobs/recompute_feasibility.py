"""Daily recompute_feasibility cron (M40b).

Runs after signal_ingest (default 09:30 UTC vs 09:00 UTC ingest). For
each vision × capability:

  1. Read current capability scores from `capability_scores` (where
     is_current = TRUE)
  2. Read recent signals from `signals` (capability_id matches, last
     30d window)
  3. Call ScoreUpdater agent (sonnet tier) via HTTP — returns new 4-dim
     scores + rationale + confidence
  4. Skip the write when confidence < 0.5 OR all dims null
  5. Compute composite via aggregator
  6. Write new CapabilityScore (is_current=TRUE; prior demoted in tx)

Then per vision:
  7. POST simulation-service `/feasibility/recompute/{slug}` which
     rolls capabilities into a VisionFeasibility snapshot

Failures are per-capability — one bad agent call doesn't kill the
whole vision's recompute.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import httpx

from data_pipeline.signal_repo import (
    CapabilityScoreWrite,
    SignalRepository,
)

log = logging.getLogger(__name__)

_DEFAULT_AGENT_URL = "http://localhost:8002"
_DEFAULT_SIM_URL = "http://localhost:8000"

# Default capability scoring weights (matches simulation-service
# aggregator default — keep in sync if you tune one).
_DEFAULT_WEIGHTS: dict[str, float] = {
    "technical": 0.25,
    "economic": 0.25,
    "regulatory": 0.25,
    "supply": 0.25,
}
_LIEBIG_SOFTENING = 0.6
_MIN_CONFIDENCE_TO_WRITE = 0.5
_RECENT_SIGNALS_WINDOW_DAYS = 30


@dataclass(slots=True)
class RecomputeStats:
    started_at: datetime
    finished_at: datetime | None = None
    visions_processed: int = 0
    capabilities_processed: int = 0
    score_updater_calls: int = 0
    score_updater_failures: int = 0
    score_writes: int = 0
    score_writes_skipped_low_confidence: int = 0
    feasibility_writes: int = 0
    score_updater_total_cost_usd: float = 0.0
    errors: list[str] = field(default_factory=list)


def _aggregate_capability_composite(
    technical: float | None,
    economic: float | None,
    regulatory: float | None,
    supply: float | None,
) -> tuple[float | None, float | None, float | None]:
    """Mirror of simulation_service.feasibility.aggregator. Kept local
    to avoid a cross-service Python import (data-pipeline → sim-service)
    that complicates packaging. If aggregation diverges, fix here AND
    in simulation_service/feasibility/aggregator.py."""
    dims = [
        ("technical", technical),
        ("economic", economic),
        ("regulatory", regulatory),
        ("supply", supply),
    ]
    present = [(name, v) for (name, v) in dims if v is not None]
    if not present:
        return None, None, None
    total_w = sum(_DEFAULT_WEIGHTS.get(n, 0.0) for n, _ in present)
    if total_w <= 0:
        return None, None, None
    weighted_mean = (
        sum(v * _DEFAULT_WEIGHTS.get(n, 0.0) for n, v in present) / total_w
    )
    values = [v for _, v in present]
    lowest = min(values)
    highest = max(values)
    composite = lowest + _LIEBIG_SOFTENING * (weighted_mean - lowest)
    composite = max(0.0, min(100.0, composite))
    half_band = (highest - lowest) / 4.0
    p10 = max(0.0, composite - half_band)
    p90 = min(100.0, composite + half_band)
    return round(composite, 2), round(p10, 2), round(p90, 2)


async def _call_score_updater(
    *,
    agent_url: str,
    client: httpx.AsyncClient,
    sector_slug: str,
    cap_key: str,
    cap_name: str,
    cap_description: str,
    cap_rationale: str,
    current_tech: float | None,
    current_econ: float | None,
    current_reg: float | None,
    current_sup: float | None,
    recent_signals: list[dict],
) -> dict | None:
    payload = {
        "sector_slug": sector_slug,
        "capability_key": cap_key,
        "capability_name": cap_name,
        "capability_description": cap_description,
        "capability_rationale": cap_rationale,
        "current_technical": current_tech,
        "current_economic": current_econ,
        "current_regulatory": current_reg,
        "current_supply": current_sup,
        "recent_signals": recent_signals,
    }
    try:
        resp = await client.post(
            f"{agent_url}/capability-score-updater/score",
            json=payload,
            timeout=60.0,  # sonnet + adaptive_thinking can take 20-40s
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        log.warning(
            "score-updater failed for %s/%s: %s",
            sector_slug,
            cap_key,
            e,
        )
        return None


async def run_recompute_feasibility(
    *,
    sector_slugs: list[str],
    repo: SignalRepository,
    job_config: Any = None,
    agent_url: str | None = None,
    sim_url: str | None = None,
    window_days: int | None = None,
    limit: int | None = None,
) -> RecomputeStats:
    """One recompute pass. Updates capability scores via the score-
    updater agent then triggers vision-level recompute on the sim
    service.
    """
    if agent_url is None:
        agent_url = os.environ.get("AGENT_ORCHESTRATION_URL", _DEFAULT_AGENT_URL)
    if sim_url is None:
        sim_url = os.environ.get("SIMULATION_SERVICE_URL", _DEFAULT_SIM_URL)

    if window_days is None:
        if job_config is not None:
            window_days = await job_config.get_typed("RECOMPUTE_WINDOW_DAYS", default=7, kind="int")
        else:
            window_days = 7

    if limit is None:
        if job_config is not None:
            limit = await job_config.get_typed("RECOMPUTE_LIMIT", default=100, kind="int")
        else:
            limit = 100

    stats = RecomputeStats(started_at=datetime.now(UTC))
    since = datetime.now(UTC) - timedelta(days=window_days)

    async with httpx.AsyncClient() as client:
        for slug in sector_slugs:
            caps = await repo.list_vision_capabilities(slug)
            if not caps:
                log.info("recompute_feasibility: %s — no capabilities, skipping", slug)
                continue
            stats.visions_processed += 1

            for cap in caps:
                stats.capabilities_processed += 1
                current = await repo.get_current_capability_score(cap.id)
                signals = await repo.list_recent_signals_for_capability(
                    cap.id, since=since, limit=limit
                )
                signal_payloads = [
                    {
                        "title": s.title,
                        "summary": s.summary,
                        "source_kind": s.source_kind,
                        "published_at": (
                            s.published_at.replace(tzinfo=UTC)
                            if s.published_at.tzinfo is None
                            else s.published_at
                        ).isoformat(),
                        "delta_technical": s.delta_technical,
                        "delta_economic": s.delta_economic,
                        "delta_regulatory": s.delta_regulatory,
                        "delta_supply": s.delta_supply,
                        "actor_short_name": s.actor_short_name,
                    }
                    for s in signals
                ]

                stats.score_updater_calls += 1
                body = await _call_score_updater(
                    agent_url=agent_url,
                    client=client,
                    sector_slug=slug,
                    cap_key=cap.key,
                    cap_name=cap.name,
                    cap_description=cap.description,
                    cap_rationale=cap.rationale,
                    current_tech=current.technical if current else None,
                    current_econ=current.economic if current else None,
                    current_reg=current.regulatory if current else None,
                    current_sup=current.supply if current else None,
                    recent_signals=signal_payloads,
                )
                if body is None:
                    stats.score_updater_failures += 1
                    continue
                stats.score_updater_total_cost_usd += float(body.get("cost_usd", 0))

                update = body.get("update") or {}
                confidence = float(update.get("confidence", 0.0))
                if confidence < _MIN_CONFIDENCE_TO_WRITE:
                    stats.score_writes_skipped_low_confidence += 1
                    continue

                # Apply: new dim = update's dim if present else current
                # (the agent returning null means "no change").
                new_tech = update.get("technical")
                new_econ = update.get("economic")
                new_reg = update.get("regulatory")
                new_sup = update.get("supply")
                final_tech = new_tech if new_tech is not None else (current.technical if current else None)
                final_econ = new_econ if new_econ is not None else (current.economic if current else None)
                final_reg = new_reg if new_reg is not None else (current.regulatory if current else None)
                final_sup = new_sup if new_sup is not None else (current.supply if current else None)

                composite, p10, p90 = _aggregate_capability_composite(
                    final_tech, final_econ, final_reg, final_sup
                )

                # Skip write if everything is still null (no dims have
                # ever been assessed AND no signals nudged anything).
                if (
                    final_tech is None
                    and final_econ is None
                    and final_reg is None
                    and final_sup is None
                ):
                    continue

                await repo.write_capability_score(
                    CapabilityScoreWrite(
                        capability_id=cap.id,
                        technical=final_tech,
                        economic=final_econ,
                        regulatory=final_reg,
                        supply=final_sup,
                        composite=composite,
                        composite_p10=p10,
                        composite_p90=p90,
                        rationale=update.get("rationale") or None,
                    )
                )
                stats.score_writes += 1

            # Vision-level recompute via simulation-service.
            try:
                resp = await client.post(
                    f"{sim_url}/feasibility/recompute/{slug}",
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    stats.feasibility_writes += 1
                else:
                    stats.errors.append(
                        f"{slug}: sim /feasibility/recompute → {resp.status_code} {resp.text[:200]}"
                    )
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                stats.errors.append(f"{slug}: sim /feasibility/recompute failed: {e}")

    stats.finished_at = datetime.now(UTC)
    log.info(
        "recompute_feasibility: visions=%d caps=%d score-writes=%d (skipped-low-conf=%d) "
        "feasibility-writes=%d cost=$%.4f",
        stats.visions_processed,
        stats.capabilities_processed,
        stats.score_writes,
        stats.score_writes_skipped_low_confidence,
        stats.feasibility_writes,
        stats.score_updater_total_cost_usd,
    )
    return stats
