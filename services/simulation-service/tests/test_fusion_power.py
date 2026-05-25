from __future__ import annotations

import pytest
from simulation_service.sims.fusion_power import FusionPowerSim


def test_default_outputs_present_and_typed() -> None:
    out = FusionPowerSim().simulate()
    scalars = {
        "lcoe_usd_per_mwh",
        "net_electric_capacity_mw",
        "npv_savings_vs_grid_usd",
        "break_even_year",
    }
    series = {
        "annual_electricity_output_mwh",
        "annual_fuel_cost_usd",
        "wall_replacement_cost_usd",
        "cumulative_cost_fusion_usd",
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
    a = FusionPowerSim().simulate()
    b = FusionPowerSim().simulate()
    assert a == b


def test_net_electric_matches_thermal_x_efficiency() -> None:
    out = FusionPowerSim().simulate(
        plant_thermal_mw=500.0,
        thermal_to_electric_pct=40.0,
    )
    cap = out["net_electric_capacity_mw"].scalar
    assert cap is not None
    assert abs(cap - 200.0) < 1e-6


def test_series_length_tracks_project_lifetime() -> None:
    out = FusionPowerSim().simulate(project_lifetime_years=20)
    series = out["annual_electricity_output_mwh"].series
    assert series is not None
    assert len(series) == 21  # 0..20 inclusive


def test_tbr_above_one_zeroes_fuel_cost() -> None:
    out = FusionPowerSim().simulate(tritium_breeding_ratio=1.2)
    fuel = out["annual_fuel_cost_usd"].series
    assert fuel is not None
    assert all(v == 0.0 for v in fuel)


def test_tbr_below_one_charges_for_tritium() -> None:
    out = FusionPowerSim().simulate(tritium_breeding_ratio=0.8)
    fuel = out["annual_fuel_cost_usd"].series
    assert fuel is not None
    assert all(v > 0.0 for v in fuel)


def test_lower_capex_lowers_lcoe() -> None:
    cheap = FusionPowerSim().simulate(plant_capex_usd_per_kw_e=4000.0)
    expensive = FusionPowerSim().simulate(plant_capex_usd_per_kw_e=20000.0)
    assert cheap["lcoe_usd_per_mwh"].scalar is not None
    assert expensive["lcoe_usd_per_mwh"].scalar is not None
    assert cheap["lcoe_usd_per_mwh"].scalar < expensive["lcoe_usd_per_mwh"].scalar


def test_higher_duty_cycle_lowers_lcoe() -> None:
    low = FusionPowerSim().simulate(duty_cycle_pct=30.0)
    high = FusionPowerSim().simulate(duty_cycle_pct=90.0)
    assert low["lcoe_usd_per_mwh"].scalar is not None
    assert high["lcoe_usd_per_mwh"].scalar is not None
    assert high["lcoe_usd_per_mwh"].scalar < low["lcoe_usd_per_mwh"].scalar


def test_wall_replacement_creates_cost_bumps() -> None:
    out = FusionPowerSim().simulate(
        first_wall_lifetime_fpy=2.0,
        duty_cycle_pct=100.0,
        replacement_pct_of_capex=20.0,
        project_lifetime_years=10,
    )
    wall = out["wall_replacement_cost_usd"].series
    assert wall is not None
    # Expect non-zero at multiples of fw_life / duty (= 2 calendar years here).
    nonzero = [t for t, v in enumerate(wall) if v > 0]
    assert nonzero == [2, 4, 6, 8, 10]


def test_carbon_price_makes_grid_more_expensive() -> None:
    no_carbon = FusionPowerSim().simulate(carbon_price_usd_per_ton_co2=0.0)
    high_carbon = FusionPowerSim().simulate(carbon_price_usd_per_ton_co2=200.0)
    nc_savings = no_carbon["npv_savings_vs_grid_usd"].scalar
    hc_savings = high_carbon["npv_savings_vs_grid_usd"].scalar
    assert nc_savings is not None and hc_savings is not None
    assert hc_savings > nc_savings


def test_break_even_minus_one_when_uneconomic() -> None:
    out = FusionPowerSim().simulate(
        plant_capex_usd_per_kw_e=25000.0,
        duty_cycle_pct=25.0,
        grid_lcoe_usd_per_mwh=40.0,
        carbon_price_usd_per_ton_co2=0.0,
    )
    assert out["break_even_year"].scalar == -1.0
    assert out["npv_savings_vs_grid_usd"].scalar is not None
    assert out["npv_savings_vs_grid_usd"].scalar < 0


def test_unknown_driver_raises() -> None:
    with pytest.raises(ValueError, match="Unknown drivers"):
        FusionPowerSim().simulate(not_a_real_driver=1.0)


def test_sensitivity_covers_all_scalar_outputs() -> None:
    sens = FusionPowerSim().sensitivity()
    expected = {
        "lcoe_usd_per_mwh",
        "net_electric_capacity_mw",
        "npv_savings_vs_grid_usd",
    }
    assert expected <= set(sens)
    for entries in sens.values():
        assert set(entries) == set(FusionPowerSim.drivers)


def test_presets_apply_cleanly() -> None:
    for name, overrides in FusionPowerSim.presets.items():
        assert set(overrides) <= set(FusionPowerSim.drivers), name
        for driver_name, value in overrides.items():
            lo, hi = FusionPowerSim.drivers[driver_name].range
            assert lo <= value <= hi, f"{name}.{driver_name}={value} outside [{lo},{hi}]"
        FusionPowerSim().simulate(**overrides)
