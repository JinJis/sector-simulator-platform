"""90-day delta computation (M40).

Simple but used in two places: the hero gauge's `delta_90d` and the
trajectory comparison footers. Pulled into its own module so the
formula is canonical + testable.
"""

from __future__ import annotations

from datetime import timedelta

from .eta import TrajectoryPoint


def compute_delta_90d(trajectory: list[TrajectoryPoint]) -> float | None:
    """Return current_composite - composite_90d_ago.

    Picks the snapshot CLOSEST to 90 days before the latest snapshot
    as the "90d ago" anchor — robust to irregular cron timing.

    Returns None when the trajectory has < 2 points or no anchor within
    [60d, 120d] window (i.e. we'd be extrapolating too far).
    """
    if len(trajectory) < 2:
        return None
    sorted_traj = sorted(trajectory, key=lambda p: p.as_of)
    latest = sorted_traj[-1]
    target_anchor = latest.as_of - timedelta(days=90)
    # Constrain anchor selection to a ±30d window around 90d-ago.
    window_lo = latest.as_of - timedelta(days=120)
    window_hi = latest.as_of - timedelta(days=60)
    candidates = [p for p in sorted_traj[:-1] if window_lo <= p.as_of <= window_hi]
    if not candidates:
        return None
    # Closest to exactly 90d ago.
    anchor = min(candidates, key=lambda p: abs((p.as_of - target_anchor).total_seconds()))
    return round(latest.composite - anchor.composite, 2)
