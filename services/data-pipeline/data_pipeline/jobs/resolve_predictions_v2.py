"""resolve_predictions_v2 — M46b PredictionV2 resolver cron.

Mirrors the M33b legacy resolver in shape but applies the band-based
scoring + tier multiplier formula:

For each PredictionV2 with status='open' and resolves_at <= cutoff:
  1. Find the first EquityQuote close on or AFTER resolves_at.
     (Legacy used on-or-BEFORE; v2 uses the next observed close so
     the resolution waits for the actual post-deadline price.)
  2. score = 1.0 if actual ∈ [min, max], linear decay to 0 over one
     full spread-width outside (see `score_prediction_v2`).
  3. reward_points = round(score × tier_multiplier × 10)
  4. Atomically update predictions_v2 row + write audit_log.

Idempotent — the UPDATE is gated by status='open', so a re-run on an
already-resolved prediction is a no-op. Skipped (no quote yet) rows
retry on later runs.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from pydantic import BaseModel

from data_pipeline.prediction2_repo import (
    PredictionV2ResolverRepository,
    ResolutionV2Payload,
    reward_points_v2,
    score_prediction_v2,
)

log = logging.getLogger(__name__)


class ResolvePredictionsV2Result(BaseModel):
    """One run's outcome — shape mirrors `ResolvePredictionsResult` so
    the /jobs/* response payloads stay uniform."""

    started_at: datetime
    finished_at: datetime
    cutoff_at: datetime
    total_due: int
    resolved: int
    already_resolved: int
    skipped_no_price: int
    errors: int
    failure_reasons: dict[str, str] = {}


async def resolve_due_predictions_v2(
    *,
    repo: PredictionV2ResolverRepository,
    now: datetime | None = None,
    limit: int = 500,
) -> ResolvePredictionsV2Result:
    started_at = datetime.now(UTC)
    cutoff = now or started_at
    due = await repo.list_due_predictions_v2(cutoff, limit=limit)

    resolved = 0
    already = 0
    skipped = 0
    errors = 0
    failure_reasons: dict[str, str] = {}

    for pred in due:
        try:
            actual = await repo.latest_close_on_or_after(
                pred.equity_id, on_date=pred.resolves_at.date()
            )
        except Exception as e:  # noqa: BLE001
            errors += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = f"price lookup raised: {e}"
            log.warning(
                "resolve_predictions_v2: price lookup raised for %s/%s: %s",
                pred.id,
                pred.equity_id,
                e,
            )
            continue
        if actual is None:
            skipped += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = (
                    "no equity_quotes row on/after resolves_at"
                )
            log.info(
                "resolve_predictions_v2: no price data for %s/%s on/after %s — skipping",
                pred.id,
                pred.equity_id,
                pred.resolves_at.date(),
            )
            continue

        score = score_prediction_v2(
            actual=actual,
            band_min=pred.expected_price_min,
            band_max=pred.expected_price_max,
        )
        reward = reward_points_v2(score, pred.tier)

        payload = ResolutionV2Payload(
            prediction_id=pred.id,
            user_id=pred.user_id,
            sector_slug=pred.sector_slug,
            actual_price=actual,
            score=score,
            reward_points=reward,
            resolved_at=started_at,
        )
        try:
            wrote = await repo.write_prediction2_resolution(payload)
            if wrote:
                resolved += 1
            else:
                already += 1
        except Exception as e:  # noqa: BLE001
            errors += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = f"write raised: {e}"
            log.warning(
                "resolve_predictions_v2: write raised for %s: %s", pred.id, e
            )

    finished_at = datetime.now(UTC)
    log.info(
        "resolve_predictions_v2 finished: due=%d resolved=%d already=%d "
        "skipped=%d errors=%d duration_s=%.1f",
        len(due),
        resolved,
        already,
        skipped,
        errors,
        (finished_at - started_at).total_seconds(),
    )
    return ResolvePredictionsV2Result(
        started_at=started_at,
        finished_at=finished_at,
        cutoff_at=cutoff,
        total_due=len(due),
        resolved=resolved,
        already_resolved=already,
        skipped_no_price=skipped,
        errors=errors,
        failure_reasons=failure_reasons,
    )


__all__ = [
    "ResolvePredictionsV2Result",
    "resolve_due_predictions_v2",
]
