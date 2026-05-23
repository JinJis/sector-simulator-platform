"""Capability composite scoring (M40).

Combines 4-dim readiness scores (technical / economic / regulatory /
supply) into a single 0-100 composite with optional binding-constraint
softening — a Liebig's-law-of-the-minimum nudge that prevents averaging
from masking a single-dim choke.

Math:
  - present_dims = dims with non-null scores
  - weighted_mean = Σ(score_i × weight_i) / Σ(weight_i) over present_dims
  - lowest_dim = min(present scores)
  - composite = min(weighted_mean, lowest_dim + softening × (weighted_mean - lowest_dim))
  - softening default 0.6 — i.e. composite is 60% of the way from lowest
    to weighted_mean. Lower softening = more Liebig (lowest dominates).

P10/P90 band: approximates uncertainty from dim score dispersion.
  - half_band = (max - min) / 4 (heuristic; tighter for converged
    dims, wider when dims disagree)
  - composite_p10 = max(0, composite - half_band)
  - composite_p90 = min(100, composite + half_band)

When all 4 dims are null: returns CompositeOutput(composite=None, …).
Score updater (M40b) writes the null row so the time series still has
a record of "we couldn't score this capability today".
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CapabilityScoreInput:
    """4-dim score input. Any field can be None (not assessed)."""

    technical: float | None
    economic: float | None
    regulatory: float | None
    supply: float | None


@dataclass(frozen=True, slots=True)
class CompositeOutput:
    """Aggregated composite + uncertainty band. All fields nullable so
    the consumer (DB write) can preserve "not assessed" state."""

    composite: float | None
    composite_p10: float | None
    composite_p90: float | None


# Default per-dim weights when caller doesn't override. Equal weight =
# any single dim accounts for 25% of weighted mean.
_DEFAULT_WEIGHTS: dict[str, float] = {
    "technical": 0.25,
    "economic": 0.25,
    "regulatory": 0.25,
    "supply": 0.25,
}


def aggregate_capability(
    scores: CapabilityScoreInput,
    *,
    weights: dict[str, float] | None = None,
    softening: float = 0.6,
) -> CompositeOutput:
    """Compute the capability composite.

    Args:
        scores: 4-dim score input. Each dim 0-100 or None.
        weights: Per-dim weights; defaults to equal 0.25 each. Caller
            can override to e.g. emphasize tech for early-stage caps.
        softening: 0..1. 0 = pure Liebig (composite = lowest dim);
            1 = pure weighted mean (no Liebig). Default 0.6.

    Returns:
        CompositeOutput. All fields None when all dims are None.
    """
    if not 0.0 <= softening <= 1.0:
        raise ValueError(f"softening must be in [0, 1], got {softening}")

    weights = weights or _DEFAULT_WEIGHTS
    dims: list[tuple[str, float | None, float]] = [
        ("technical", scores.technical, weights.get("technical", 0.0)),
        ("economic", scores.economic, weights.get("economic", 0.0)),
        ("regulatory", scores.regulatory, weights.get("regulatory", 0.0)),
        ("supply", scores.supply, weights.get("supply", 0.0)),
    ]
    present = [(name, v, w) for (name, v, w) in dims if v is not None and w > 0]
    if not present:
        return CompositeOutput(composite=None, composite_p10=None, composite_p90=None)

    total_w = sum(w for _, _, w in present)
    if total_w <= 0:
        return CompositeOutput(composite=None, composite_p10=None, composite_p90=None)
    weighted_mean = sum(v * w for _, v, w in present) / total_w  # type: ignore[misc]
    present_values: list[float] = [v for _, v, _ in present]  # type: ignore[misc]
    lowest = min(present_values)
    highest = max(present_values)

    # Liebig softening: composite is `softening` fraction of the way
    # from lowest to weighted_mean. lowest <= composite <= weighted_mean.
    composite = lowest + softening * (weighted_mean - lowest)
    composite = max(0.0, min(100.0, composite))

    # Uncertainty band from dim disagreement. Tight when dims converged.
    half_band = (highest - lowest) / 4.0
    p10 = max(0.0, composite - half_band)
    p90 = min(100.0, composite + half_band)

    return CompositeOutput(
        composite=round(composite, 2),
        composite_p10=round(p10, 2),
        composite_p90=round(p90, 2),
    )
