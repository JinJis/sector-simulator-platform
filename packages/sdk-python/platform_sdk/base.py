from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar


@dataclass(frozen=True)
class Driver:
    default: float
    range: tuple[float, float]
    unit: str = ""
    description: str = ""
    group: str = ""

    def __post_init__(self) -> None:
        low, high = self.range
        if low > high:
            raise ValueError(f"Driver range invalid: {self.range}")
        if not low <= self.default <= high:
            raise ValueError(f"Driver default {self.default} outside range {self.range}")


@dataclass(frozen=True)
class Output:
    series: list[float] | None = None
    scalar: float | None = None
    unit: str = ""
    description: str = ""


@dataclass(frozen=True)
class Source:
    """Citation for a driver value or historical data point."""

    title: str
    url: str = ""
    excerpt: str = ""  # short justification snippet
    as_of: str = ""  # ISO date or quarter, e.g. "2024-Q4"
    # One of: paper, vendor_doc, analyst, benchmark, gov_report, dataset,
    # news, filing. Empty = unclassified. Drives kind-badges + ingest grouping
    # in the Live dashboard so users can see *what kind* of evidence backs
    # each driver, not just that "a source exists".
    kind: str = ""


@dataclass(frozen=True)
class HistoryPoint:
    date: str  # ISO date or year, e.g. "2020" or "2024-06"
    value: float


@dataclass(frozen=True)
class Provenance:
    """Where a driver's current value came from + how it's evolved."""

    history: tuple[HistoryPoint, ...] = field(default_factory=tuple)
    sources: tuple[Source, ...] = field(default_factory=tuple)
    note: str = ""  # one-line summary shown next to driver


class SimulationBase:
    slug: ClassVar[str] = ""
    name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    drivers: ClassVar[dict[str, Driver]] = {}
    horizon_years: ClassVar[int] = 10
    # Named driver-override bundles surfaced to the UI as one-click scenarios.
    # Each value is a partial driver override; missing keys fall back to defaults.
    presets: ClassVar[dict[str, dict[str, float]]] = {}
    # Per-driver provenance (history + citations). Missing entries = no provenance.
    provenance: ClassVar[dict[str, Provenance]] = {}

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        raise NotImplementedError

    def monte_carlo(self, n: int = 1000) -> dict[str, list[Output]]:
        raise NotImplementedError

    def sensitivity(self) -> dict[str, dict[str, float]]:
        """One-at-a-time elasticity per scalar output.

        For each driver: sweep to its min and max while holding others at defaults,
        record the resulting scalar outputs, and report the *range* (high − low)
        in the output's units. Sorting these gives a tornado chart.

        Returns {output_name: {driver_name: signed_swing}}. Sign is (high − low)
        in driver-direction (positive driver delta → positive swing).
        """
        cls = type(self)
        defaults = {name: d.default for name, d in cls.drivers.items()}
        baseline = self.simulate(**defaults)
        scalar_outputs = [name for name, out in baseline.items() if out.scalar is not None]
        if not scalar_outputs:
            return {}

        result: dict[str, dict[str, float]] = {name: {} for name in scalar_outputs}
        for driver_name, driver in cls.drivers.items():
            low_args = {**defaults, driver_name: driver.range[0]}
            high_args = {**defaults, driver_name: driver.range[1]}
            low_outs = self.simulate(**low_args)
            high_outs = self.simulate(**high_args)
            for out_name in scalar_outputs:
                lo = low_outs[out_name].scalar
                hi = high_outs[out_name].scalar
                if lo is None or hi is None:
                    continue
                result[out_name][driver_name] = float(hi - lo)
        return result

    @classmethod
    def resolve_drivers(cls, supplied: dict[str, float]) -> dict[str, float]:
        unknown = set(supplied) - set(cls.drivers)
        if unknown:
            raise ValueError(f"Unknown drivers: {sorted(unknown)}")
        return {name: supplied.get(name, d.default) for name, d in cls.drivers.items()}
