from __future__ import annotations

from platform_sdk import Driver, Output, SimulationBase


class PlaceholderSim(SimulationBase):
    slug = "placeholder"
    name = "Placeholder simulation"
    description = "Phase 0 toy: compound growth from a base value. 실제 섹터는 추후 교체."
    horizon_years = 10
    drivers = {
        "annual_growth_rate_pct": Driver(
            default=8.0,
            range=(-20.0, 40.0),
            unit="%",
            description="Annual compound growth rate.",
        ),
        "base_value": Driver(
            default=100.0,
            range=(10.0, 1000.0),
            unit="",
            description="Year-0 value.",
        ),
    }

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        values = self.resolve_drivers(kwargs)
        rate = values["annual_growth_rate_pct"] / 100.0
        base = values["base_value"]
        series = [base * (1 + rate) ** year for year in range(self.horizon_years + 1)]
        return {
            "value": Output(
                series=series,
                unit="",
                description="Compound-grown value over the horizon.",
            ),
        }
