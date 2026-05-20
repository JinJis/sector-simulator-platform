from __future__ import annotations

import pytest
from simulation_service.sims.memory_semi import MemorySemiSim


def test_default_outputs_present_and_typed() -> None:
    out = MemorySemiSim().simulate()
    scalars = {
        "npv_free_cash_flow_usd",
        "peak_revenue_usd",
        "peak_revenue_year",
        "peak_gross_margin_pct",
        "terminal_gross_margin_pct",
    }
    series = {
        "company_revenue_usd",
        "gross_margin_pct",
        "free_cash_flow_usd",
        "company_capex_usd",
        "hbm_revenue_share_pct",
    }
    assert scalars <= set(out)
    assert series <= set(out)
    for name in scalars:
        assert out[name].scalar is not None, name
        assert out[name].series is None, name
    for name in series:
        assert out[name].series is not None, name
        assert out[name].scalar is None, name


def test_simulation_is_deterministic() -> None:
    a = MemorySemiSim().simulate()
    b = MemorySemiSim().simulate()
    assert a == b


def test_series_length_matches_horizon() -> None:
    out = MemorySemiSim().simulate()
    rev = out["company_revenue_usd"].series
    assert rev is not None
    assert len(rev) == MemorySemiSim.horizon_years + 1


def test_higher_ai_cagr_lifts_revenue_trajectory() -> None:
    low = MemorySemiSim().simulate(ai_dram_demand_cagr_pct=10.0)
    high = MemorySemiSim().simulate(ai_dram_demand_cagr_pct=100.0)
    low_rev = low["company_revenue_usd"].series
    high_rev = high["company_revenue_usd"].series
    assert low_rev is not None and high_rev is not None
    # Year 0 is identical (CAGR doesn't affect t=0); later years diverge upward.
    assert abs(low_rev[0] - high_rev[0]) < 1e-6
    assert high_rev[-1] > low_rev[-1] * 1.5


def test_lower_market_share_reduces_npv() -> None:
    big = MemorySemiSim().simulate(company_market_share_pct=45.0)
    small = MemorySemiSim().simulate(company_market_share_pct=10.0)
    assert big["npv_free_cash_flow_usd"].scalar is not None
    assert small["npv_free_cash_flow_usd"].scalar is not None
    assert big["npv_free_cash_flow_usd"].scalar > small["npv_free_cash_flow_usd"].scalar


def test_gross_margin_squeezed_when_asp_falls_fast() -> None:
    base = MemorySemiSim().simulate(commodity_dram_asp_cagr_pct=0.0)
    crash = MemorySemiSim().simulate(commodity_dram_asp_cagr_pct=-20.0)
    base_gm = base["gross_margin_pct"].series
    crash_gm = crash["gross_margin_pct"].series
    assert base_gm is not None and crash_gm is not None
    # Year 0 identical; terminal margin much lower under ASP crash.
    assert crash_gm[-1] < base_gm[-1]


def test_hbm_share_increases_with_premium() -> None:
    low_prem = MemorySemiSim().simulate(hbm_premium_x=2.0)
    high_prem = MemorySemiSim().simulate(hbm_premium_x=10.0)
    low_share = low_prem["hbm_revenue_share_pct"].series
    high_share = high_prem["hbm_revenue_share_pct"].series
    assert low_share is not None and high_share is not None
    assert high_share[-1] > low_share[-1]


def test_unknown_driver_raises() -> None:
    with pytest.raises(ValueError, match="Unknown drivers"):
        MemorySemiSim().simulate(bogus_thing=1.0)


def test_sensitivity_covers_all_scalar_outputs() -> None:
    sens = MemorySemiSim().sensitivity()
    expected_scalars = {
        "npv_free_cash_flow_usd",
        "peak_revenue_usd",
        "peak_gross_margin_pct",
    }
    assert expected_scalars <= set(sens)
    for entries in sens.values():
        assert set(entries) == set(MemorySemiSim.drivers)


def test_presets_apply_cleanly() -> None:
    sim_cls = MemorySemiSim
    for name, overrides in sim_cls.presets.items():
        assert set(overrides) <= set(sim_cls.drivers), name
        for driver_name, value in overrides.items():
            lo, hi = sim_cls.drivers[driver_name].range
            assert lo <= value <= hi, f"{name}.{driver_name}={value} outside [{lo},{hi}]"
        sim_cls().simulate(**overrides)


def test_provenance_attached_to_every_driver() -> None:
    sim_cls = MemorySemiSim
    assert set(sim_cls.provenance) == set(sim_cls.drivers)
    for name, prov in sim_cls.provenance.items():
        assert prov.sources, f"{name} has no sources"
        for s in prov.sources:
            assert s.kind, f"{name} source '{s.title}' missing kind"
