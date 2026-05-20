from __future__ import annotations

import pytest
from simulation_service.sims.space_data_center import SpaceDataCenterSim


def test_default_outputs_present_and_typed() -> None:
    out = SpaceDataCenterSim().simulate()
    scalars = {
        "launch_mass_kg",
        "system_capex_usd",
        "npv_savings_vs_ground_usd",
        "break_even_year",
    }
    series = {
        "effective_compute_pflops",
        "cost_per_pflops_year_space_usd",
        "cost_per_pflops_year_ground_usd",
        "cumulative_cost_space_usd",
        "cumulative_cost_ground_usd",
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
    a = SpaceDataCenterSim().simulate()
    b = SpaceDataCenterSim().simulate()
    assert a == b  # dataclass equality on Output


def test_series_length_tracks_mission_lifetime() -> None:
    out = SpaceDataCenterSim().simulate(mission_lifetime_years=5)
    assert out["effective_compute_pflops"].series is not None
    assert len(out["effective_compute_pflops"].series) == 6  # 0..5 inclusive


def test_effective_compute_monotonically_degrades() -> None:
    out = SpaceDataCenterSim().simulate()
    series = out["effective_compute_pflops"].series
    assert series is not None
    for prev, nxt in zip(series, series[1:], strict=False):
        assert nxt <= prev + 1e-9  # non-increasing within float tolerance


def test_lower_launch_cost_increases_npv() -> None:
    base = SpaceDataCenterSim().simulate()
    cheap = SpaceDataCenterSim().simulate(launch_cost_usd_per_kg=300.0)
    expensive = SpaceDataCenterSim().simulate(launch_cost_usd_per_kg=4000.0)
    assert cheap["npv_savings_vs_ground_usd"].scalar is not None
    assert expensive["npv_savings_vs_ground_usd"].scalar is not None
    assert (
        cheap["npv_savings_vs_ground_usd"].scalar
        > base["npv_savings_vs_ground_usd"].scalar
        > expensive["npv_savings_vs_ground_usd"].scalar
    )


def test_more_efficient_chip_reduces_launch_mass() -> None:
    weak = SpaceDataCenterSim().simulate(chip_pflops_per_kw=10.0)
    strong = SpaceDataCenterSim().simulate(chip_pflops_per_kw=150.0)
    assert weak["launch_mass_kg"].scalar is not None
    assert strong["launch_mass_kg"].scalar is not None
    assert strong["launch_mass_kg"].scalar < weak["launch_mass_kg"].scalar


def test_break_even_minus_one_when_uneconomic() -> None:
    # Crank everything against space: tiny system, terrible chip, expensive launch,
    # cheap ground baseline. Space should fail to break even.
    out = SpaceDataCenterSim().simulate(
        compute_demand_pflops=1.0,
        chip_pflops_per_kw=5.0,
        launch_cost_usd_per_kg=5000.0,
        chip_capex_usd_per_pflops=2_000_000.0,
        ground_baseline_cost_per_pflops_year_usd=50_000.0,
        annual_opex_pct_of_capex=25.0,
    )
    assert out["break_even_year"].scalar == -1.0
    assert out["npv_savings_vs_ground_usd"].scalar is not None
    assert out["npv_savings_vs_ground_usd"].scalar < 0


def test_unknown_driver_raises() -> None:
    with pytest.raises(ValueError, match="Unknown drivers"):
        SpaceDataCenterSim().simulate(nonexistent_lever=1.0)


def test_sensitivity_ranks_drivers_per_output() -> None:
    sens = SpaceDataCenterSim().sensitivity()
    # Sensitivity reports each scalar output.
    assert {"launch_mass_kg", "system_capex_usd", "npv_savings_vs_ground_usd"} <= set(sens)
    # All drivers represented under each output.
    for entries in sens.values():
        assert set(entries) == set(SpaceDataCenterSim.drivers)
    # Capex must be sensitive to chip capex.
    assert abs(sens["system_capex_usd"]["chip_capex_usd_per_pflops"]) > 0


def test_presets_apply_cleanly() -> None:
    sim_cls = SpaceDataCenterSim
    for name, overrides in sim_cls.presets.items():
        # Only valid driver names.
        assert set(overrides) <= set(sim_cls.drivers), name
        # All override values fall within their declared ranges.
        for driver_name, value in overrides.items():
            lo, hi = sim_cls.drivers[driver_name].range
            assert lo <= value <= hi, f"{name}.{driver_name}={value} outside [{lo},{hi}]"
        # And the resulting simulation runs without error.
        SpaceDataCenterSim().simulate(**overrides)
