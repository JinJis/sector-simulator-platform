from __future__ import annotations

import pytest
from simulation_service.sims.sofc import SOFCSim


def test_default_outputs_present_and_typed() -> None:
    out = SOFCSim().simulate()
    scalars = {
        "lcoe_usd_per_mwh",
        "system_capex_total_usd",
        "npv_savings_vs_grid_usd",
        "break_even_year",
    }
    series = {
        "effective_efficiency_pct",
        "annual_electricity_output_mwh",
        "annual_fuel_cost_usd",
        "annual_carbon_cost_usd",
        "cumulative_cost_sofc_usd",
        "cumulative_cost_grid_usd",
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
    a = SOFCSim().simulate()
    b = SOFCSim().simulate()
    assert a == b


def test_series_length_tracks_project_lifetime() -> None:
    out = SOFCSim().simulate(project_lifetime_years=10)
    series = out["annual_electricity_output_mwh"].series
    assert series is not None
    assert len(series) == 11  # 0..10 inclusive


def test_efficiency_monotonically_degrades() -> None:
    out = SOFCSim().simulate()
    eff = out["effective_efficiency_pct"].series
    assert eff is not None
    for prev, nxt in zip(eff, eff[1:], strict=False):
        assert nxt <= prev + 1e-9


def test_cheaper_gas_improves_npv() -> None:
    cheap = SOFCSim().simulate(natural_gas_price_usd_per_mmbtu=3.0)
    expensive = SOFCSim().simulate(natural_gas_price_usd_per_mmbtu=15.0)
    assert cheap["npv_savings_vs_grid_usd"].scalar is not None
    assert expensive["npv_savings_vs_grid_usd"].scalar is not None
    assert (
        cheap["npv_savings_vs_grid_usd"].scalar
        > expensive["npv_savings_vs_grid_usd"].scalar
    )


def test_higher_efficiency_lowers_lcoe() -> None:
    low = SOFCSim().simulate(system_efficiency_pct_lhv=35.0)
    high = SOFCSim().simulate(system_efficiency_pct_lhv=65.0)
    assert low["lcoe_usd_per_mwh"].scalar is not None
    assert high["lcoe_usd_per_mwh"].scalar is not None
    assert high["lcoe_usd_per_mwh"].scalar < low["lcoe_usd_per_mwh"].scalar


def test_carbon_price_increases_sofc_cost() -> None:
    no_carbon = SOFCSim().simulate(carbon_price_usd_per_ton_co2=0.0)
    high_carbon = SOFCSim().simulate(carbon_price_usd_per_ton_co2=200.0)
    nc = no_carbon["cumulative_cost_sofc_usd"].series
    hc = high_carbon["cumulative_cost_sofc_usd"].series
    assert nc is not None and hc is not None
    # Year 0 identical (capex-only at t=0 if we ignore year-0 fuel? No — annual
    # opex is incurred from t=0 in this model, so even t=0 differs slightly).
    assert hc[-1] > nc[-1]


def test_stack_replacement_creates_cost_bumps() -> None:
    # Force stack replacement every 4 years over a 20yr horizon — should see
    # discrete cost bumps at years 4, 8, 12, 16, 20.
    out = SOFCSim().simulate(
        stack_lifetime_years=4,
        stack_replacement_cost_usd_per_kw=2000.0,
        project_lifetime_years=20,
    )
    cum = out["cumulative_cost_sofc_usd"].series
    assert cum is not None
    # The jump at year 4 (vs 3) must be larger than the jump at year 3 (vs 2)
    # because year 4 includes the stack swap.
    delta_3_to_4 = cum[4] - cum[3]
    delta_2_to_3 = cum[3] - cum[2]
    assert delta_3_to_4 > delta_2_to_3 * 1.5


def test_break_even_minus_one_when_uneconomic() -> None:
    out = SOFCSim().simulate(
        system_capex_usd_per_kw=8000.0,
        natural_gas_price_usd_per_mmbtu=20.0,
        grid_lcoe_usd_per_mwh=50.0,
        carbon_price_usd_per_ton_co2=0.0,
    )
    assert out["break_even_year"].scalar == -1.0
    assert out["npv_savings_vs_grid_usd"].scalar is not None
    assert out["npv_savings_vs_grid_usd"].scalar < 0


def test_unknown_driver_raises() -> None:
    with pytest.raises(ValueError, match="Unknown drivers"):
        SOFCSim().simulate(not_a_real_driver=1.0)


def test_sensitivity_covers_all_scalar_outputs() -> None:
    sens = SOFCSim().sensitivity()
    expected = {"lcoe_usd_per_mwh", "system_capex_total_usd", "npv_savings_vs_grid_usd"}
    assert expected <= set(sens)
    for entries in sens.values():
        assert set(entries) == set(SOFCSim.drivers)


def test_presets_apply_cleanly() -> None:
    sim_cls = SOFCSim
    for name, overrides in sim_cls.presets.items():
        assert set(overrides) <= set(sim_cls.drivers), name
        for driver_name, value in overrides.items():
            lo, hi = sim_cls.drivers[driver_name].range
            assert lo <= value <= hi, f"{name}.{driver_name}={value} outside [{lo},{hi}]"
        sim_cls().simulate(**overrides)


def test_provenance_attached_to_every_driver() -> None:
    sim_cls = SOFCSim
    assert set(sim_cls.provenance) == set(sim_cls.drivers)
    for name, prov in sim_cls.provenance.items():
        assert prov.sources, f"{name} has no sources"
        for s in prov.sources:
            assert s.kind, f"{name} source '{s.title}' missing kind"
