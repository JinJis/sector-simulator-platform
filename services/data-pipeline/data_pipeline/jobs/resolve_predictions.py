"""resolve_predictions — cron job that scores unresolved predictions
whose `target_date` has passed (M33b).

For each due prediction:
  1. Look up `actual_close` from `equity_quotes` (latest trading day
     on or before `target_date`).
  2. Compute `actual_pct = (close - anchor) / anchor * 100`.
  3. Score: `max(0, 100 - |predicted_pct - actual_pct| * 5)`.
     Hit when score ≥ 50 (i.e. error ≤ 10pp).
  4. Atomically write PredictionResult + flip `predictions.resolved` +
     bump `user_scores` + append `audit_logs` row.

Idempotent — `predictions.resolved` is the gate, and the writer txn is
no-op when the gate is already true. Skips predictions for which no
quote data has landed yet (counted in `skipped_no_price`; will resolve
on a later run after the next quote refresh fills in the missing day).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel

from data_pipeline.prediction_repo import (
    PredictionResolverRepository,
    ResolutionPayload,
)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScoreResult:
    """Pure output of `score_prediction`. Easy to assert against in tests."""

    actual_pct: float
    abs_error: float
    score: float
    hit: bool


# Scoring constants. Kept module-level so a test can monkey-patch them
# (or so a future tuning slice can read them from env).
ERROR_TO_POINT_LOSS = 5.0  # error * 5 → points lost
HIT_THRESHOLD = 50.0       # score ≥ this counts as a hit


def score_prediction(*, predicted_pct: float, actual_pct: float) -> ScoreResult:
    """v1 score formula: linear decay. Perfect (0 error) = 100; off by
    20pp = 0. Hit when score ≥ 50, i.e. error ≤ 10pp. Pure — no I/O.

    The schema docstring (`PredictionResult.score` comment) is the
    canonical reference for this formula; keep it in sync if you tune.
    """
    abs_error = abs(predicted_pct - actual_pct)
    score = max(0.0, 100.0 - abs_error * ERROR_TO_POINT_LOSS)
    hit = score >= HIT_THRESHOLD
    return ScoreResult(
        actual_pct=actual_pct,
        abs_error=abs_error,
        score=score,
        hit=hit,
    )


class ResolvePredictionsResult(BaseModel):
    """One run's outcome. Mirrors the shape of the other refresh-job
    Results so the /jobs/* endpoints stay uniform."""

    started_at: datetime
    finished_at: datetime
    cutoff_at: datetime
    total_due: int
    resolved: int
    already_resolved: int
    skipped_no_price: int
    errors: int
    # prediction_id → human-readable reason. Capped to 50 entries so a
    # fully broken run doesn't balloon the response payload.
    failure_reasons: dict[str, str] = {}


async def resolve_due_predictions(
    *,
    repo: PredictionResolverRepository,
    now: datetime | None = None,
    limit: int = 500,
) -> ResolvePredictionsResult:
    started_at = datetime.now(UTC)
    cutoff = now or started_at
    due = await repo.list_due_predictions(cutoff, limit=limit)

    resolved = 0
    already_resolved = 0
    skipped = 0
    errors = 0
    failure_reasons: dict[str, str] = {}

    for pred in due:
        try:
            close = await repo.latest_close_on_or_before(
                pred.equity_id, on_date=pred.target_date.date()
            )
        except Exception as e:  # noqa: BLE001
            errors += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = f"price lookup raised: {e}"
            log.warning(
                "resolve_predictions: price lookup raised for %s/%s: %s",
                pred.id,
                pred.equity_id,
                e,
            )
            continue
        if close is None:
            skipped += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = "no equity_quotes row on/before target_date"
            log.info(
                "resolve_predictions: no price data for %s/%s on/before %s — skipping",
                pred.id,
                pred.equity_id,
                pred.target_date.date(),
            )
            continue

        if pred.anchor_close == 0:
            # Defensive — shouldn't happen (create-time rejects None
            # anchor), but a zero anchor would divide-by-zero below.
            errors += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = "anchor_close was zero"
            continue

        actual_pct = ((close - pred.anchor_close) / pred.anchor_close) * 100.0
        score = score_prediction(
            predicted_pct=pred.predicted_pct, actual_pct=actual_pct
        )

        payload = ResolutionPayload(
            prediction_id=pred.id,
            user_id=pred.user_id,
            sector_slug=pred.sector_slug,
            actual_close=close,
            actual_pct=score.actual_pct,
            abs_error=score.abs_error,
            score=score.score,
            hit=score.hit,
            resolved_at=started_at,
        )
        try:
            wrote = await repo.write_prediction_resolution(payload)
            if wrote:
                resolved += 1
            else:
                already_resolved += 1
        except Exception as e:  # noqa: BLE001
            errors += 1
            if len(failure_reasons) < 50:
                failure_reasons[pred.id] = f"write raised: {e}"
            log.warning(
                "resolve_predictions: write raised for %s: %s", pred.id, e
            )

    finished_at = datetime.now(UTC)
    log.info(
        "resolve_predictions finished: due=%d resolved=%d already=%d "
        "skipped=%d errors=%d duration_s=%.1f",
        len(due),
        resolved,
        already_resolved,
        skipped,
        errors,
        (finished_at - started_at).total_seconds(),
    )
    return ResolvePredictionsResult(
        started_at=started_at,
        finished_at=finished_at,
        cutoff_at=cutoff,
        total_due=len(due),
        resolved=resolved,
        already_resolved=already_resolved,
        skipped_no_price=skipped,
        errors=errors,
        failure_reasons=failure_reasons,
    )


__all__ = [
    "ResolvePredictionsResult",
    "ScoreResult",
    "score_prediction",
    "resolve_due_predictions",
]
