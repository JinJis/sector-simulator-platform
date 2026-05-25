"""Tests for the M46b PredictionV2 resolver job.

Two layers (mirrors test_resolve_predictions.py shape):
- `score_prediction_v2()` + `reward_points_v2()` — pure formulas.
- `resolve_due_predictions_v2()` — orchestration. Uses the in-memory
  repo to verify idempotency, skip-on-no-price, audit emission, and
  score+reward math end-to-end.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from data_pipeline.jobs.resolve_predictions_v2 import resolve_due_predictions_v2
from data_pipeline.prediction2_repo import (
    DuePredictionV2,
    InMemoryPredictionV2ResolverRepository,
    reward_points_v2,
    score_prediction_v2,
)


# ===== score_prediction_v2 ==============================================


class TestScoreV2:
    def test_inside_band_full_score(self):
        assert score_prediction_v2(actual=100, band_min=95, band_max=105) == 1.0
        assert score_prediction_v2(actual=95, band_min=95, band_max=105) == 1.0
        assert score_prediction_v2(actual=105, band_min=95, band_max=105) == 1.0

    def test_one_spread_outside_zero(self):
        # spread=10; one full spread outside = 0
        assert score_prediction_v2(actual=115, band_min=95, band_max=105) == 0
        assert score_prediction_v2(actual=85, band_min=95, band_max=105) == 0

    def test_half_spread_outside_half_score(self):
        # spread=10; 5 outside = 0.5
        assert score_prediction_v2(actual=110, band_min=95, band_max=105) == pytest.approx(0.5)
        assert score_prediction_v2(actual=90, band_min=95, band_max=105) == pytest.approx(0.5)

    def test_degenerate_band(self):
        assert score_prediction_v2(actual=100, band_min=105, band_max=95) == 0


# ===== reward_points_v2 =================================================


class TestRewardV2:
    def test_easy_max(self):
        assert reward_points_v2(1.0, "easy") == 10

    def test_medium_max(self):
        assert reward_points_v2(1.0, "medium") == 25

    def test_hard_max(self):
        assert reward_points_v2(1.0, "hard") == 50

    def test_half_score_scales(self):
        assert reward_points_v2(0.5, "hard") == 25

    def test_zero_score(self):
        assert reward_points_v2(0.0, "hard") == 0

    def test_unknown_tier_zero(self):
        assert reward_points_v2(1.0, "weird") == 0


# ===== Orchestration ====================================================


def _due(
    *,
    pid: str = "p1",
    user_id: str = "u1",
    equity_id: str = "e1",
    band_min: float = 95,
    band_max: float = 105,
    tier: str = "medium",
    resolves_at: datetime | None = None,
) -> DuePredictionV2:
    return DuePredictionV2(
        id=pid,
        user_id=user_id,
        equity_id=equity_id,
        sector_slug="memory-semi",
        horizon="1m",
        tier=tier,
        expected_price_min=band_min,
        expected_price_max=band_max,
        anchor_price=100,
        anchor_date=resolves_at - timedelta(days=30) if resolves_at else datetime(2026, 1, 1, tzinfo=UTC),
        resolves_at=resolves_at or datetime(2026, 1, 31, tzinfo=UTC),
    )


class TestResolveOrchestrator:
    @pytest.mark.asyncio
    async def test_writes_resolution_for_inside_band(self):
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[_due()],
            history={"e1": [(date(2026, 1, 31), 100.0)]},
        )
        result = await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 1, tzinfo=UTC)
        )
        assert result.total_due == 1
        assert result.resolved == 1
        assert len(repo.results) == 1
        r = repo.results[0]
        assert r.actual_price == 100.0
        assert r.score == 1.0
        assert r.reward_points == 25  # medium × 1.0 × 10
        assert len(repo.audit) == 1
        assert repo.audit[0]["action"] == "prediction2.resolve"

    @pytest.mark.asyncio
    async def test_idempotent_on_rerun(self):
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[_due()],
            history={"e1": [(date(2026, 1, 31), 100.0)]},
        )
        await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 1, tzinfo=UTC)
        )
        r2 = await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 1, tzinfo=UTC)
        )
        # In-memory repo filters resolved on subsequent list_due — total_due=0
        assert r2.total_due == 0
        assert r2.resolved == 0
        assert len(repo.results) == 1

    @pytest.mark.asyncio
    async def test_skips_when_no_price_data(self):
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[_due()],
            history={"e1": []},
        )
        result = await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 1, tzinfo=UTC)
        )
        assert result.total_due == 1
        assert result.skipped_no_price == 1
        assert result.resolved == 0
        assert repo.results == []

    @pytest.mark.asyncio
    async def test_uses_first_close_on_or_after_resolves_at(self):
        # Two quotes — one before, one after resolves_at. The resolver
        # should pick the on-or-AFTER one.
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[_due(resolves_at=datetime(2026, 1, 31, tzinfo=UTC))],
            history={
                "e1": [
                    (date(2026, 1, 30), 90.0),   # before — must NOT be used
                    (date(2026, 1, 31), 100.0),  # exactly on — should be used
                    (date(2026, 2, 1), 200.0),
                ]
            },
        )
        result = await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 5, tzinfo=UTC)
        )
        assert result.resolved == 1
        assert repo.results[0].actual_price == 100.0

    @pytest.mark.asyncio
    async def test_outside_band_zero_reward(self):
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[_due(tier="hard")],
            history={"e1": [(date(2026, 1, 31), 200.0)]},
        )
        await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 2, 1, tzinfo=UTC)
        )
        r = repo.results[0]
        assert r.score == 0
        assert r.reward_points == 0

    @pytest.mark.asyncio
    async def test_only_resolves_due(self):
        early = _due(pid="p_early", resolves_at=datetime(2026, 1, 1, tzinfo=UTC))
        future = _due(
            pid="p_future",
            equity_id="e2",
            resolves_at=datetime(2026, 12, 31, tzinfo=UTC),
        )
        repo = InMemoryPredictionV2ResolverRepository(
            predictions=[early, future],
            history={
                "e1": [(date(2026, 1, 1), 100.0)],
                "e2": [(date(2026, 12, 31), 100.0)],
            },
        )
        result = await resolve_due_predictions_v2(
            repo=repo, now=datetime(2026, 6, 1, tzinfo=UTC)
        )
        assert result.total_due == 1
        ids = [r.prediction_id for r in repo.results]
        assert ids == ["p_early"]
