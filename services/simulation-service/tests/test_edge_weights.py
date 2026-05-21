"""Edge-weight regression — milestone 9.

The hybrid-weights design says: passing no edge weights (or all 1.0)
must produce byte-identical output to the legacy hand-coded math. A
single non-neutral weight must propagate through `simulate()` and
produce a predictable, monotonic change in the expected output.

We test against `MemorySemiSim` because it's the first sim that has
the choke-point hooks wired (M9). Other sims (space-data-center, sofc)
remain weight-naive in M9 and will be refactored in a follow-up.
"""

from __future__ import annotations

import pytest
from platform_sdk import EdgeWeights
from simulation_service.sims.memory_semi import MemorySemiSim


def _scalar(out: dict, key: str) -> float:
    val = out[key].scalar
    assert val is not None, f"expected scalar for {key}"
    return float(val)


def test_neutral_weights_reproduce_legacy_outputs() -> None:
    """`EdgeWeights()` empty and the no-arg path must agree."""
    legacy = MemorySemiSim().simulate()
    via_neutral = MemorySemiSim(edge_weights=EdgeWeights()).simulate()

    for key in legacy:
        if legacy[key].scalar is not None:
            assert _scalar(legacy, key) == pytest.approx(_scalar(via_neutral, key), rel=0)
        if legacy[key].series is not None:
            a = legacy[key].series or []
            b = via_neutral[key].series or []
            assert len(a) == len(b)
            for ai, bi in zip(a, b):
                assert ai == pytest.approx(bi, rel=0)


def test_all_ones_weight_map_reproduces_legacy() -> None:
    """An explicit map of `1.0` per known choke point is also a no-op."""
    ew = EdgeWeights()
    for src, tgt in [
        ("ai_pb_trajectory", "industry_hbm_revenue"),
        ("hbm_mix_pct_of_ai_demand", "industry_hbm_revenue"),
        ("hbm_asp_trajectory", "industry_hbm_revenue"),
        ("ai_pb_trajectory", "industry_comm_revenue"),
        ("co_pb_trajectory", "industry_comm_revenue"),
        ("commodity_asp_trajectory", "industry_comm_revenue"),
        ("industry_revenue_total", "company_revenue_intermediate"),
        ("company_market_share_pct", "company_revenue_intermediate"),
        ("company_bits_gb", "company_cogs"),
        ("cost_per_gb_trajectory", "company_cogs"),
        ("company_revenue_intermediate", "opex_intermediate"),
        ("opex_pct_of_revenue", "opex_intermediate"),
        ("company_revenue_intermediate", "capex_intermediate"),
        ("capex_intensity_pct", "capex_intermediate"),
    ]:
        ew[(src, tgt)] = 1.0

    legacy = MemorySemiSim().simulate()
    via_ones = MemorySemiSim(edge_weights=ew).simulate()
    assert _scalar(legacy, "npv_free_cash_flow_usd") == pytest.approx(
        _scalar(via_ones, "npv_free_cash_flow_usd"), rel=0
    )


def test_doubling_company_revenue_edge_scales_outputs() -> None:
    """Weight=2.0 on industry_revenue → company_revenue should ~2x the
    company revenue (and therefore peak_revenue, NPV magnitude)."""
    ew = EdgeWeights({("industry_revenue_total", "company_revenue_intermediate"): 2.0})
    legacy = MemorySemiSim().simulate()
    boosted = MemorySemiSim(edge_weights=ew).simulate()

    ratio_peak = _scalar(boosted, "peak_revenue_usd") / _scalar(legacy, "peak_revenue_usd")
    assert ratio_peak == pytest.approx(2.0, rel=1e-9), (
        f"expected ~2x peak revenue, got {ratio_peak:.6f}"
    )


def test_zero_capex_edge_kills_capex_term() -> None:
    """Weight=0 on any capex edge zeroes the capex line — FCF becomes
    EBIT-only."""
    ew = EdgeWeights({("company_revenue_intermediate", "capex_intermediate"): 0.0})
    base = MemorySemiSim().simulate()
    no_capex = MemorySemiSim(edge_weights=ew).simulate()

    series_legacy = base["company_capex_usd"].series or []
    series_zero = no_capex["company_capex_usd"].series or []
    assert all(v == pytest.approx(0.0) for v in series_zero), series_zero[:3]
    # FCF must rise when capex disappears.
    fcf_legacy = base["free_cash_flow_usd"].series or []
    fcf_zero = no_capex["free_cash_flow_usd"].series or []
    assert all(fz >= fl for fz, fl in zip(fcf_zero, fcf_legacy))


def test_negative_weight_inverts_contribution() -> None:
    """A negative weight on HBM revenue makes HBM bits *reduce*
    industry revenue rather than add to it (only useful as an
    extreme stress test)."""
    ew = EdgeWeights(
        {
            ("ai_pb_trajectory", "industry_hbm_revenue"): -1.0,
            ("hbm_mix_pct_of_ai_demand", "industry_hbm_revenue"): 1.0,
            ("hbm_asp_trajectory", "industry_hbm_revenue"): 1.0,
        }
    )
    legacy = MemorySemiSim().simulate()
    flipped = MemorySemiSim(edge_weights=ew).simulate()
    # Peak revenue must drop substantially when HBM contribution flips
    # sign. We don't pin the exact number — just direction.
    assert _scalar(flipped, "peak_revenue_usd") < _scalar(legacy, "peak_revenue_usd")


def test_w_helper_default_is_one() -> None:
    """`SimulationBase.w(...)` returns 1.0 for unset pairs."""
    sim = MemorySemiSim()
    assert sim.w("nonexistent_source", "nonexistent_target") == 1.0
