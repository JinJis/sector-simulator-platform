"""ETA estimation from vision composite trajectory (M40).

Takes a time series of vision composites and projects when the vision
will cross a target feasibility threshold (default 80) — i.e. "when
will this realistically be ready?"

v1 math: linear regression on the most-recent slice (default last 90
days), extrapolate slope forward.

Edge cases:
  - Composite already ≥ target → ETA = 0 (median + bounds)
  - Slope ≤ 0 (trending down or flat) → ETA = None (caller renders
    "trending away" or "unknown")
  - Slope very small → ETA caps at `max_years` (default 30) so
    we don't surface "ETA 2317"

P10/P90 bounds via P10/P90 trajectory series when available; otherwise
± 30% of median (rough heuristic until M40 has more data history).

M40 v2 (deferred) could fit a logistic curve for visions approaching
saturation, but linear is fine for the demo gate.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class TrajectoryPoint:
    """One historical composite snapshot. p10/p90 optional."""

    as_of: datetime
    composite: float
    composite_p10: float | None = None
    composite_p90: float | None = None


@dataclass(frozen=True, slots=True)
class EtaEstimate:
    """Years from now until composite crosses target. None values mean
    "unknown" (insufficient data or trending wrong way)."""

    median_years: float | None
    p10_years: float | None
    p90_years: float | None


def _linear_slope_per_year(points: list[TrajectoryPoint]) -> float | None:
    """Least-squares slope of composite vs time (in years).

    Returns None when fewer than 2 distinct timestamps."""
    if len(points) < 2:
        return None
    t0 = points[0].as_of
    # x in years.
    xs = [(p.as_of - t0).total_seconds() / (365.25 * 86400.0) for p in points]
    ys = [p.composite for p in points]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=False))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0:
        return None
    return num / den


def estimate_eta(
    trajectory: list[TrajectoryPoint],
    *,
    target: float = 80.0,
    window_days: int = 90,
    max_years: float = 30.0,
) -> EtaEstimate:
    """Project when the composite crosses `target`.

    Args:
        trajectory: Sorted by as_of asc (we tolerate unsorted — we sort
            internally). Each point composite 0-100.
        target: Threshold the composite needs to reach. Default 80.
        window_days: Look back this far to fit the slope.
        max_years: Cap on output. ETAs beyond this clamp to max_years.

    Returns:
        EtaEstimate. median_years=0 when already at target.
        median_years=None when slope is non-positive or trajectory too
        short.
    """
    if not trajectory:
        return EtaEstimate(median_years=None, p10_years=None, p90_years=None)

    sorted_traj = sorted(trajectory, key=lambda p: p.as_of)
    current = sorted_traj[-1]

    if current.composite >= target:
        return EtaEstimate(median_years=0.0, p10_years=0.0, p90_years=0.0)

    cutoff = current.as_of.timestamp() - window_days * 86400.0
    recent = [p for p in sorted_traj if p.as_of.timestamp() >= cutoff]
    if len(recent) < 2:
        recent = sorted_traj[-min(len(sorted_traj), 10) :]

    slope = _linear_slope_per_year(recent)
    if slope is None or slope <= 0:
        return EtaEstimate(median_years=None, p10_years=None, p90_years=None)

    gap = target - current.composite
    median_years = min(max_years, gap / slope)

    # P10/P90 via the trajectory bands (when present). Wider gap on
    # p10 side → longer ETA → p90 of ETA. (Inverse relationship.)
    p10_eta: float | None = None
    p90_eta: float | None = None
    if current.composite_p10 is not None and current.composite_p90 is not None:
        # ETA for p10 composite: longer to reach target.
        p10_gap = max(0.0, target - current.composite_p10)
        p90_gap = max(0.0, target - current.composite_p90)
        # Note p10 of *composite* → p90 of *ETA* (longer).
        p90_eta = min(max_years, p10_gap / slope)
        p10_eta = min(max_years, p90_gap / slope)
    else:
        # Fallback: ±30% of median.
        p10_eta = max(0.0, median_years * 0.7)
        p90_eta = min(max_years, median_years * 1.3)

    return EtaEstimate(
        median_years=round(median_years, 2),
        p10_years=round(p10_eta, 2) if p10_eta is not None else None,
        p90_years=round(p90_eta, 2) if p90_eta is not None else None,
    )
