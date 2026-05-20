"""Decomposition Agent eval cases.

Each case carries:
  - A realistic user description (the sector concept).
  - A canned `Decomposition` response that offline mode replays. The
    canned response is what a healthy agent *should* return — calibrate
    it before adding the case, not by working backward from the
    assertions.
  - A list of post-conditions written as plain callables. Use `assert`
    so pytest reports the specific failure line cleanly.

Cost budget for decomposition is generous (Opus 4.7 + adaptive
thinking + structured output runs ~$0.10–$0.30 per case under our
prompt). Tune downward as we learn the empirical envelope.
"""

from __future__ import annotations

from agent_orchestration.schemas import (
    Decomposition,
    DriverNode,
    IntermediateNode,
    OutputNode,
)
from harness import Case, CostBudget

# ---- Shared invariant assertions -----------------------------------------


def _all_drivers_snake_case(d: Decomposition) -> None:
    import re

    pat = re.compile(r"^[a-z][a-z0-9_]*$")
    for driver in d.drivers:
        assert pat.match(driver.name), (
            f"driver name {driver.name!r} is not snake_case"
        )


def _driver_default_within_range(d: Decomposition) -> None:
    for driver in d.drivers:
        assert driver.min <= driver.default <= driver.max, (
            f"driver {driver.name}: default={driver.default} outside "
            f"[{driver.min}, {driver.max}]"
        )
        assert driver.min < driver.max, (
            f"driver {driver.name}: degenerate range (min == max)"
        )


def _every_driver_has_group(d: Decomposition) -> None:
    for driver in d.drivers:
        assert driver.group, f"driver {driver.name} has empty group"


def _has_at_least_one_scalar_output(d: Decomposition) -> None:
    scalars = [o for o in d.outputs if o.kind == "scalar"]
    assert scalars, "decomposition has no scalar outputs"


def _driver_count_in_useful_range(d: Decomposition) -> None:
    # Per the prompt: 8-16 sweet spot. Allow 5-20 to absorb realistic
    # variance from the agent.
    assert 5 <= len(d.drivers) <= 20, (
        f"driver count {len(d.drivers)} outside reasonable range (5-20)"
    )


def _output_count_in_useful_range(d: Decomposition) -> None:
    assert 2 <= len(d.outputs) <= 20, (
        f"output count {len(d.outputs)} outside reasonable range (2-20)"
    )


def _horizon_realistic(d: Decomposition) -> None:
    assert 1 <= d.horizon_years <= 50, (
        f"horizon_years {d.horizon_years} outside 1-50"
    )


def _slug_is_kebab_case(d: Decomposition) -> None:
    import re

    assert re.match(r"^[a-z][a-z0-9-]*$", d.slug), (
        f"slug {d.slug!r} is not kebab-case"
    )


_BASELINE_ASSERTIONS = [
    _all_drivers_snake_case,
    _driver_default_within_range,
    _every_driver_has_group,
    _has_at_least_one_scalar_output,
    _driver_count_in_useful_range,
    _output_count_in_useful_range,
    _horizon_realistic,
    _slug_is_kebab_case,
]


# ---- Canned responses ----------------------------------------------------


def _battery_recycling_canned() -> Decomposition:
    return Decomposition(
        name="Lithium-ion Battery Recycling",
        slug="li-ion-battery-recycling",
        description=(
            "Hydrometallurgical recycling of EV battery packs. Models recovery "
            "yields, processing costs, metal prices, and CAPEX/OPEX to compute "
            "per-pack economics over the project horizon."
        ),
        horizon_years=15,
        drivers=[
            DriverNode(
                name="annual_pack_throughput_tons",
                group="Throughput",
                unit="t/yr",
                default=20_000.0,
                min=1_000.0,
                max=200_000.0,
                description="Tons of battery packs processed per year.",
            ),
            DriverNode(
                name="nickel_recovery_pct",
                group="Yields",
                unit="%",
                default=92.0,
                min=70.0,
                max=99.0,
                description="Mass-yield of nickel from input feedstock.",
            ),
            DriverNode(
                name="cobalt_recovery_pct",
                group="Yields",
                unit="%",
                default=95.0,
                min=70.0,
                max=99.0,
                description="Mass-yield of cobalt.",
            ),
            DriverNode(
                name="lithium_recovery_pct",
                group="Yields",
                unit="%",
                default=80.0,
                min=40.0,
                max=99.0,
                description="Mass-yield of lithium (historically the hardest).",
            ),
            DriverNode(
                name="nickel_price_usd_per_kg",
                group="Prices",
                unit="$/kg",
                default=18.0,
                min=8.0,
                max=40.0,
                description="LME nickel spot price.",
            ),
            DriverNode(
                name="cobalt_price_usd_per_kg",
                group="Prices",
                unit="$/kg",
                default=32.0,
                min=20.0,
                max=80.0,
                description="LME cobalt spot price.",
            ),
            DriverNode(
                name="lithium_price_usd_per_kg",
                group="Prices",
                unit="$/kg",
                default=22.0,
                min=8.0,
                max=80.0,
                description="Battery-grade lithium carbonate.",
            ),
            DriverNode(
                name="processing_opex_usd_per_ton",
                group="Costs",
                unit="$/t",
                default=2_500.0,
                min=800.0,
                max=8_000.0,
                description="Reagents + utilities + labor per ton processed.",
            ),
            DriverNode(
                name="facility_capex_usd",
                group="Costs",
                unit="USD",
                default=120_000_000.0,
                min=20_000_000.0,
                max=500_000_000.0,
                description="One-time facility build-out.",
            ),
            DriverNode(
                name="discount_rate_pct",
                group="Economics",
                unit="%",
                default=10.0,
                min=4.0,
                max=20.0,
                description="WACC for NPV.",
            ),
        ],
        intermediates=[
            IntermediateNode(
                name="metals_revenue_yearly",
                unit="USD",
                description="Σ(recovery × pack metal fraction × price) × throughput.",
            ),
            IntermediateNode(
                name="annual_opex",
                unit="USD",
                description="processing_opex × throughput.",
            ),
        ],
        outputs=[
            OutputNode(
                name="npv_usd",
                kind="scalar",
                unit="USD",
                description="NPV of free cash flow over the project life.",
            ),
            OutputNode(
                name="payback_years",
                kind="scalar",
                unit="yr",
                description="Year cumulative FCF first turns positive.",
            ),
            OutputNode(
                name="yearly_revenue_usd",
                kind="series",
                unit="USD",
                description="Annual metals revenue trajectory.",
            ),
        ],
    )


def _grid_storage_canned() -> Decomposition:
    return Decomposition(
        name="Grid-Scale Lithium Battery Storage",
        slug="grid-li-storage",
        description=(
            "Utility-scale Li-ion battery storage providing arbitrage + ancillary "
            "services. Computes LCOS and IRR over a 15-year project lifetime."
        ),
        horizon_years=15,
        drivers=[
            DriverNode(
                name="system_capex_usd_per_kwh",
                group="System",
                unit="$/kWh",
                default=300.0,
                min=120.0,
                max=800.0,
                description="Installed system capex per kWh.",
            ),
            DriverNode(
                name="system_size_mwh",
                group="System",
                unit="MWh",
                default=200.0,
                min=10.0,
                max=2000.0,
                description="Nameplate energy capacity.",
            ),
            DriverNode(
                name="power_capacity_mw",
                group="System",
                unit="MW",
                default=100.0,
                min=5.0,
                max=1000.0,
                description="Nameplate power capacity.",
            ),
            DriverNode(
                name="round_trip_efficiency_pct",
                group="System",
                unit="%",
                default=86.0,
                min=70.0,
                max=95.0,
                description="AC-AC round-trip efficiency.",
            ),
            DriverNode(
                name="cycles_per_year",
                group="Operation",
                unit="cycle/yr",
                default=350.0,
                min=100.0,
                max=400.0,
                description="Equivalent full cycles per year.",
            ),
            DriverNode(
                name="capacity_degradation_pct_per_year",
                group="Operation",
                unit="%/yr",
                default=2.0,
                min=0.5,
                max=5.0,
                description="Capacity fade per year.",
            ),
            DriverNode(
                name="annual_om_pct_of_capex",
                group="Operation",
                unit="%/yr",
                default=2.0,
                min=0.5,
                max=8.0,
                description="O&M as a fraction of capex.",
            ),
            DriverNode(
                name="energy_arbitrage_spread_usd_per_mwh",
                group="Economics",
                unit="$/MWh",
                default=45.0,
                min=10.0,
                max=200.0,
                description="Per-cycle revenue from charging low and discharging high.",
            ),
            DriverNode(
                name="ancillary_revenue_usd_per_kw_year",
                group="Economics",
                unit="$/kW·yr",
                default=15.0,
                min=0.0,
                max=80.0,
                description="Frequency regulation + capacity payments.",
            ),
            DriverNode(
                name="discount_rate_pct",
                group="Economics",
                unit="%",
                default=8.0,
                min=4.0,
                max=20.0,
                description="WACC for NPV.",
            ),
        ],
        intermediates=[
            IntermediateNode(
                name="effective_capacity_mwh",
                unit="MWh",
                description="size × (1 − degradation)^t per year.",
            ),
            IntermediateNode(
                name="annual_revenue",
                unit="USD",
                description="arbitrage + ancillary, scaled by degraded capacity.",
            ),
        ],
        outputs=[
            OutputNode(
                name="lcos_usd_per_mwh",
                kind="scalar",
                unit="$/MWh",
                description="Levelized cost of storage (NPV cost ÷ NPV MWh delivered).",
            ),
            OutputNode(
                name="project_irr_pct",
                kind="scalar",
                unit="%",
                description="Internal rate of return.",
            ),
            OutputNode(
                name="annual_revenue_usd",
                kind="series",
                unit="USD",
                description="Annual revenue trajectory.",
            ),
        ],
    )


# ---- Case list -----------------------------------------------------------


def decomposition_cases() -> list[Case]:
    return [
        Case(
            name="battery-recycling",
            description=(
                "A hydrometallurgical lithium-ion battery recycling sector — "
                "EV pack feedstock, metals recovery (Ni / Co / Li), processing "
                "OPEX, facility CAPEX, and per-pack economics."
            ),
            canned_response=_battery_recycling_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.30),
        ),
        Case(
            name="grid-storage",
            description=(
                "Grid-scale lithium battery storage providing energy arbitrage "
                "and ancillary services. Compute LCOS and IRR over a 15-year "
                "project life given system capex, round-trip efficiency, "
                "degradation, and market prices."
            ),
            canned_response=_grid_storage_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.30),
        ),
    ]
