"""Tests for the M33b resolve-predictions job.

Two layers:
- `score_prediction()` — pure formula, hammer the edge cases (sign,
  hit threshold, off-by-large, perfect, negative anchor side).
- `resolve_due_predictions()` — orchestration. Uses
  `InMemoryPredictionResolverRepository` to verify ordering,
  idempotency, skip-on-no-price, and UserScore deltas (score sum,
  hit count, current/best streak, hit_rate).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from data_pipeline.jobs.resolve_predictions import (
    resolve_due_predictions,
    score_prediction,
)
from data_pipeline.prediction_repo import (
    DuePrediction,
    InMemoryPredictionResolverRepository,
)


# ---- score_prediction (pure) -------------------------------------------


def test_score_prediction_perfect_call() -> None:
    s = score_prediction(predicted_pct=5.0, actual_pct=5.0)
    assert s.score == 100.0
    assert s.abs_error == 0.0
    assert s.hit is True


def test_score_prediction_off_by_ten_pp_lands_exactly_on_hit_boundary() -> None:
    # Error 10pp → score 100 - 10*5 = 50 → hit (>= 50)
    s = score_prediction(predicted_pct=5.0, actual_pct=15.0)
    assert s.score == 50.0
    assert s.hit is True


def test_score_prediction_off_by_eleven_pp_misses() -> None:
    s = score_prediction(predicted_pct=5.0, actual_pct=16.0)
    assert s.score == pytest.approx(45.0)
    assert s.hit is False


def test_score_prediction_sign_mismatch_is_proportional_not_hard_zero() -> None:
    """v1 formula does NOT special-case sign mismatch — predicted +1
    actual -1 is just 2pp error → score 90. Loss happens via abs_error
    growing, not via a flag. (Locks in the formula contract; if a
    future revision wants direction-sensitive penalty, this test
    flags the change.)"""
    s = score_prediction(predicted_pct=1.0, actual_pct=-1.0)
    assert s.abs_error == 2.0
    assert s.score == 90.0
    assert s.hit is True


def test_score_prediction_huge_error_clips_at_zero() -> None:
    s = score_prediction(predicted_pct=10.0, actual_pct=-50.0)
    assert s.score == 0.0
    assert s.hit is False


def test_score_prediction_is_symmetric_in_error_direction() -> None:
    over = score_prediction(predicted_pct=10.0, actual_pct=5.0)
    under = score_prediction(predicted_pct=5.0, actual_pct=10.0)
    assert over.score == under.score
    assert over.abs_error == under.abs_error


# ---- resolve_due_predictions (orchestration) ---------------------------


def _pred(
    pid: str,
    *,
    user_id: str = "user-1",
    equity_id: str = "eq-1",
    anchor: float = 100.0,
    predicted_pct: float = 5.0,
    target_offset_days: int = -1,
    sector_slug: str = "memory-semi",
) -> DuePrediction:
    """Build a DuePrediction with sensible defaults.
    `target_offset_days` is relative to "now" (negative = past = due)."""
    base = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    return DuePrediction(
        id=pid,
        user_id=user_id,
        equity_id=equity_id,
        horizon="1w",
        predicted_pct=predicted_pct,
        anchor_close=anchor,
        target_date=base + timedelta(days=target_offset_days),
        sector_slug=sector_slug,
    )


@pytest.mark.asyncio
async def test_resolve_writes_result_and_bumps_score_on_hit() -> None:
    pred = _pred("p1", predicted_pct=5.0)
    # actual close 105 → +5% → exact hit, score 100
    repo = InMemoryPredictionResolverRepository(
        predictions=[pred],
        history={"eq-1": [(date(2026, 5, 21), 105.0)]},
    )
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)

    result = await resolve_due_predictions(repo=repo, now=now)

    assert result.total_due == 1
    assert result.resolved == 1
    assert result.skipped_no_price == 0
    assert len(repo.results) == 1
    written = repo.results[0]
    assert written.actual_close == 105.0
    assert written.score == 100.0
    assert written.hit is True
    score = repo.scores["user-1"]
    assert score.total_points == 100.0
    assert score.predictions_resolved == 1
    assert score.hits == 1
    assert score.hit_rate_pct == 100.0
    assert score.current_streak == 1
    assert score.best_streak == 1


@pytest.mark.asyncio
async def test_resolve_skips_predictions_with_no_price_data() -> None:
    pred = _pred("p1")
    repo = InMemoryPredictionResolverRepository(
        predictions=[pred],
        history={"eq-1": []},  # no bars at all
    )
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    result = await resolve_due_predictions(repo=repo, now=now)
    assert result.total_due == 1
    assert result.resolved == 0
    assert result.skipped_no_price == 1
    assert repo.results == []
    assert "p1" in result.failure_reasons


@pytest.mark.asyncio
async def test_resolve_ignores_predictions_not_yet_due() -> None:
    future_pred = _pred("p1", target_offset_days=+5)
    repo = InMemoryPredictionResolverRepository(
        predictions=[future_pred],
        history={"eq-1": [(date(2026, 5, 21), 105.0)]},
    )
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    result = await resolve_due_predictions(repo=repo, now=now)
    assert result.total_due == 0
    assert result.resolved == 0


@pytest.mark.asyncio
async def test_resolve_is_idempotent_on_rerun() -> None:
    pred = _pred("p1", predicted_pct=5.0)
    repo = InMemoryPredictionResolverRepository(
        predictions=[pred],
        history={"eq-1": [(date(2026, 5, 21), 105.0)]},
    )
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    first = await resolve_due_predictions(repo=repo, now=now)
    second = await resolve_due_predictions(repo=repo, now=now)
    assert first.resolved == 1
    # Second run should find no due predictions because the in-memory
    # repo tracks `_resolved` and filters it out of list_due_predictions.
    assert second.total_due == 0
    assert second.resolved == 0
    # UserScore is untouched on second run.
    score = repo.scores["user-1"]
    assert score.predictions_resolved == 1
    assert score.total_points == 100.0


@pytest.mark.asyncio
async def test_resolve_streak_breaks_on_miss_and_best_persists() -> None:
    # 3 hits then 1 miss then 1 hit — best=3, current=1 after run.
    preds = [
        _pred("p1", predicted_pct=5.0, target_offset_days=-5),  # hit
        _pred("p2", predicted_pct=5.0, target_offset_days=-4),  # hit
        _pred("p3", predicted_pct=5.0, target_offset_days=-3),  # hit
        _pred("p4", predicted_pct=5.0, target_offset_days=-2),  # miss (delta huge)
        _pred("p5", predicted_pct=5.0, target_offset_days=-1),  # hit
    ]
    # Per-target-date prices. Hits arrange the actual_pct close to +5.
    # The miss has actual_pct = -30% → 35pp error → score 0 → miss.
    history = {
        "eq-1": [
            (date(2026, 5, 17), 105.0),  # p1
            (date(2026, 5, 18), 105.0),  # p2
            (date(2026, 5, 19), 105.0),  # p3
            (date(2026, 5, 20), 70.0),   # p4 — miss
            (date(2026, 5, 21), 105.0),  # p5
        ]
    }
    repo = InMemoryPredictionResolverRepository(predictions=preds, history=history)
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    await resolve_due_predictions(repo=repo, now=now)
    score = repo.scores["user-1"]
    assert score.predictions_resolved == 5
    assert score.hits == 4
    assert score.hit_rate_pct == pytest.approx(80.0)
    assert score.current_streak == 1
    assert score.best_streak == 3


@pytest.mark.asyncio
async def test_resolve_handles_zero_anchor_defensively() -> None:
    pred = _pred("p1", anchor=0.0)  # would divide-by-zero if let through
    repo = InMemoryPredictionResolverRepository(
        predictions=[pred],
        history={"eq-1": [(date(2026, 5, 21), 50.0)]},
    )
    now = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    result = await resolve_due_predictions(repo=repo, now=now)
    assert result.errors == 1
    assert result.resolved == 0
    assert "p1" in result.failure_reasons


@pytest.mark.asyncio
async def test_resolve_per_user_streaks_are_independent() -> None:
    """A's miss must not break B's streak."""
    preds = [
        _pred("a1", user_id="user-A", predicted_pct=5.0, target_offset_days=-3),  # hit
        _pred("a2", user_id="user-A", predicted_pct=5.0, target_offset_days=-2),  # miss
        _pred("b1", user_id="user-B", predicted_pct=5.0, target_offset_days=-1),  # hit
    ]
    history = {
        "eq-1": [
            (date(2026, 5, 19), 105.0),
            (date(2026, 5, 20), 70.0),
            (date(2026, 5, 21), 105.0),
        ]
    }
    repo = InMemoryPredictionResolverRepository(predictions=preds, history=history)
    await resolve_due_predictions(
        repo=repo, now=datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    )
    score_a = repo.scores["user-A"]
    score_b = repo.scores["user-B"]
    assert score_a.predictions_resolved == 2
    assert score_a.hits == 1
    assert score_a.current_streak == 0
    assert score_b.predictions_resolved == 1
    assert score_b.hits == 1
    assert score_b.current_streak == 1


@pytest.mark.asyncio
async def test_resolve_picks_latest_close_on_or_before_target_date() -> None:
    """If target_date is Wednesday and we have Tuesday + Thursday bars,
    use Tuesday's (the latest ≤ target). Thursday data must be ignored."""
    pred = _pred("p1", predicted_pct=5.0, target_offset_days=-1)  # 2026-05-21
    repo = InMemoryPredictionResolverRepository(
        predictions=[pred],
        history={
            "eq-1": [
                (date(2026, 5, 19), 90.0),   # earlier — ignored
                (date(2026, 5, 21), 105.0),  # target day — use this
                (date(2026, 5, 23), 200.0),  # after target — must be ignored
            ]
        },
    )
    await resolve_due_predictions(
        repo=repo, now=datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    )
    assert repo.results[0].actual_close == 105.0
