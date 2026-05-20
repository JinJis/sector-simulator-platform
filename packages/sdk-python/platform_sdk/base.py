from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar


@dataclass(frozen=True)
class Driver:
    default: float
    range: tuple[float, float]
    unit: str = ""
    description: str = ""

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


class SimulationBase:
    slug: ClassVar[str] = ""
    name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    drivers: ClassVar[dict[str, Driver]] = {}
    horizon_years: ClassVar[int] = 10

    def simulate(self, **kwargs: float) -> dict[str, Output]:
        raise NotImplementedError

    def monte_carlo(self, n: int = 1000) -> dict[str, list[Output]]:
        raise NotImplementedError

    def sensitivity(self) -> dict[str, float]:
        raise NotImplementedError

    @classmethod
    def resolve_drivers(cls, supplied: dict[str, float]) -> dict[str, float]:
        unknown = set(supplied) - set(cls.drivers)
        if unknown:
            raise ValueError(f"Unknown drivers: {sorted(unknown)}")
        return {name: supplied.get(name, d.default) for name, d in cls.drivers.items()}
