"""Golden cases for the M40 feasibility math.

All pure — no HTTP, no DB. The endpoints that wrap these are tested
in test_api.py.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from simulation_service.feasibility import (
    CapabilityForVision,
    CapabilityScoreInput,
    aggregate_capability,
    aggregate_vision,
    compute_delta_90d,
    estimate_eta,
)
from simulation_service.feasibility.eta import TrajectoryPoint


# ---- Capability aggregator -----------------------------------------------


class TestAggregateCapability:
    def test_all_equal_dims_returns_same_value(self) -> None:
        out = aggregate_capability(
            CapabilityScoreInput(technical=70, economic=70, regulatory=70, supply=70)
        )
        assert out.composite == 70.0
        assert out.composite_p10 == 70.0
        assert out.composite_p90 == 70.0

    def test_softening_blends_lowest_and_mean(self) -> None:
        # tech=20, others=80. weighted_mean=65, lowest=20. With
        # softening=0.6, composite = 20 + 0.6 × (65-20) = 47.
        out = aggregate_capability(
            CapabilityScoreInput(technical=20, economic=80, regulatory=80, supply=80),
            softening=0.6,
        )
        assert out.composite == pytest.approx(47.0, abs=0.01)

    def test_softening_zero_gives_pure_liebig(self) -> None:
        # softening=0 → composite = lowest_dim.
        out = aggregate_capability(
            CapabilityScoreInput(technical=20, economic=80, regulatory=80, supply=80),
            softening=0.0,
        )
        assert out.composite == 20.0

    def test_softening_one_gives_pure_weighted_mean(self) -> None:
        out = aggregate_capability(
            CapabilityScoreInput(technical=20, economic=80, regulatory=80, supply=80),
            softening=1.0,
        )
        assert out.composite == pytest.approx(65.0, abs=0.01)

    def test_softening_out_of_range_raises(self) -> None:
        with pytest.raises(ValueError):
            aggregate_capability(
                CapabilityScoreInput(technical=50, economic=50, regulatory=50, supply=50),
                softening=1.5,
            )

    def test_all_null_returns_null(self) -> None:
        out = aggregate_capability(
            CapabilityScoreInput(technical=None, economic=None, regulatory=None, supply=None)
        )
        assert out.composite is None
        assert out.composite_p10 is None
        assert out.composite_p90 is None

    def test_partial_null_aggregates_present_dims_only(self) -> None:
        # Only tech + econ present, both 60.
        out = aggregate_capability(
            CapabilityScoreInput(technical=60, economic=60, regulatory=None, supply=None)
        )
        assert out.composite == 60.0

    def test_uncertainty_band_widens_with_disagreement(self) -> None:
        tight = aggregate_capability(
            CapabilityScoreInput(technical=70, economic=70, regulatory=70, supply=70)
        )
        wide = aggregate_capability(
            CapabilityScoreInput(technical=20, economic=80, regulatory=70, supply=50)
        )
        tight_width = (tight.composite_p90 or 0) - (tight.composite_p10 or 0)
        wide_width = (wide.composite_p90 or 0) - (wide.composite_p10 or 0)
        assert wide_width > tight_width

    def test_custom_weights_shift_composite(self) -> None:
        # Heavy weight on tech (which is low) pulls composite down.
        out = aggregate_capability(
            CapabilityScoreInput(technical=20, economic=80, regulatory=80, supply=80),
            weights={"technical": 0.7, "economic": 0.1, "regulatory": 0.1, "supply": 0.1},
            softening=0.6,
        )
        # weighted_mean = (0.7×20 + 0.1×80×3) / 1.0 = 38. lowest = 20.
        # composite = 20 + 0.6 × (38-20) = 30.8
        assert out.composite == pytest.approx(30.8, abs=0.01)


# ---- Vision aggregator ---------------------------------------------------


class TestAggregateVision:
    def test_returns_none_when_no_rated_capabilities(self) -> None:
        out = aggregate_vision(
            [
                CapabilityForVision(
                    key="a", weight=0.5, composite=None, composite_p10=None, composite_p90=None
                )
            ]
        )
        assert out is None

    def test_identifies_binding_capability(self) -> None:
        caps = [
            CapabilityForVision(key="a", weight=0.3, composite=80, composite_p10=75, composite_p90=85),
            CapabilityForVision(key="b", weight=0.3, composite=40, composite_p10=35, composite_p90=45),
            CapabilityForVision(key="c", weight=0.3, composite=70, composite_p10=65, composite_p90=75),
        ]
        out = aggregate_vision(caps)
        assert out is not None
        assert out.binding_capability_key == "b"

    def test_liebig_softening_caps_at_binding(self) -> None:
        # 3 caps with one severely low. Softening 0.5 → composite is
        # halfway from lowest to weighted_mean.
        caps = [
            CapabilityForVision(key="a", weight=0.33, composite=80, composite_p10=None, composite_p90=None),
            CapabilityForVision(key="b", weight=0.33, composite=20, composite_p10=None, composite_p90=None),
            CapabilityForVision(key="c", weight=0.33, composite=80, composite_p10=None, composite_p90=None),
        ]
        out = aggregate_vision(caps, softening=0.5)
        assert out is not None
        # weighted_mean ≈ 60. composite = 20 + 0.5 × (60-20) = 40
        assert out.composite == pytest.approx(40.0, abs=1.0)

    def test_skips_null_composites(self) -> None:
        caps = [
            CapabilityForVision(key="a", weight=0.5, composite=70, composite_p10=None, composite_p90=None),
            CapabilityForVision(key="b", weight=0.5, composite=None, composite_p10=None, composite_p90=None),
        ]
        out = aggregate_vision(caps)
        assert out is not None
        assert out.composite == 70.0
        assert out.binding_capability_key == "a"


# ---- ETA -----------------------------------------------------------------


def _ts(days_ago: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days_ago)


class TestEstimateEta:
    def test_already_at_target_returns_zero(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(60), composite=70),
            TrajectoryPoint(as_of=_ts(0), composite=85),
        ]
        out = estimate_eta(traj, target=80)
        assert out.median_years == 0.0

    def test_linear_extrapolation_to_target(self) -> None:
        # +20 over 90 days = ~+81/year. Current 60, target 80, gap 20.
        # ETA ≈ 20 / 81 ≈ 0.25 years.
        traj = [
            TrajectoryPoint(as_of=_ts(90), composite=40),
            TrajectoryPoint(as_of=_ts(0), composite=60),
        ]
        out = estimate_eta(traj, target=80)
        assert out.median_years is not None
        assert 0.2 < out.median_years < 0.3

    def test_negative_slope_returns_none(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(90), composite=60),
            TrajectoryPoint(as_of=_ts(0), composite=50),
        ]
        out = estimate_eta(traj, target=80)
        assert out.median_years is None

    def test_flat_slope_returns_none(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(90), composite=60),
            TrajectoryPoint(as_of=_ts(0), composite=60),
        ]
        out = estimate_eta(traj, target=80)
        assert out.median_years is None

    def test_caps_at_max_years(self) -> None:
        # Very slow progress.
        traj = [
            TrajectoryPoint(as_of=_ts(90), composite=10),
            TrajectoryPoint(as_of=_ts(0), composite=10.1),
        ]
        out = estimate_eta(traj, target=80, max_years=30)
        assert out.median_years == 30.0

    def test_single_point_returns_none(self) -> None:
        traj = [TrajectoryPoint(as_of=_ts(0), composite=60)]
        out = estimate_eta(traj)
        assert out.median_years is None

    def test_p10_band_propagates(self) -> None:
        traj = [
            TrajectoryPoint(
                as_of=_ts(90),
                composite=40,
                composite_p10=35,
                composite_p90=45,
            ),
            TrajectoryPoint(
                as_of=_ts(0),
                composite=60,
                composite_p10=55,
                composite_p90=65,
            ),
        ]
        out = estimate_eta(traj, target=80)
        # Wider band gives wider ETA range.
        assert out.p10_years is not None
        assert out.p90_years is not None
        assert out.p10_years < (out.median_years or 0)
        assert out.p90_years > (out.median_years or 0)


# ---- 90d Delta -----------------------------------------------------------


class TestComputeDelta90d:
    def test_basic_delta(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(90), composite=60),
            TrajectoryPoint(as_of=_ts(0), composite=68),
        ]
        delta = compute_delta_90d(traj)
        assert delta == 8.0

    def test_finds_closest_anchor_within_window(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(95), composite=58),  # within window
            TrajectoryPoint(as_of=_ts(85), composite=62),  # within window, closer
            TrajectoryPoint(as_of=_ts(0), composite=70),
        ]
        delta = compute_delta_90d(traj)
        # 85d is closer to 90d than 95d.
        assert delta == pytest.approx(8.0, abs=0.01)

    def test_returns_none_when_no_anchor_in_window(self) -> None:
        traj = [
            TrajectoryPoint(as_of=_ts(30), composite=60),  # too recent
            TrajectoryPoint(as_of=_ts(0), composite=70),
        ]
        assert compute_delta_90d(traj) is None

    def test_returns_none_for_single_point(self) -> None:
        traj = [TrajectoryPoint(as_of=_ts(0), composite=70)]
        assert compute_delta_90d(traj) is None
