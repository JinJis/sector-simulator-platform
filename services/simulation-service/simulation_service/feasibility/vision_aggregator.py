"""Vision-level feasibility aggregation (M40).

Takes per-capability composites + weights and produces:
  - vision composite (capped by binding constraint)
  - binding_capability_key (the weighted-lowest)
  - P10/P90 band aggregated from per-capability bands
  - identification of which capability is gating the index

Math:
  - normalized_weighted_mean = Σ(score_i × weight_i) / Σ(weight_i)
    over capabilities with non-null composite
  - binding_key = argmin(score × weight contribution) — the capability
    whose low score dragging the most weight against the mean
  - For Liebig at vision level: vision_composite = lowest_score
    + softening × (weighted_mean - lowest_score). Softening defaults
    to 0.5 (slightly stricter than capability-level — the WHOLE vision
    cap'd by the binding capability matters more at the headline).

P10/P90 propagation:
  - Simple variance-weighted mean of per-capability bands
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CapabilityForVision:
    """Per-capability input to vision aggregator."""

    key: str
    weight: float
    composite: float | None
    composite_p10: float | None
    composite_p90: float | None


@dataclass(frozen=True, slots=True)
class VisionFeasibilityOutput:
    """Aggregated output written to the VisionFeasibility table."""

    composite: float
    composite_p10: float | None
    composite_p90: float | None
    binding_capability_key: str | None


def aggregate_vision(
    capabilities: list[CapabilityForVision],
    *,
    softening: float = 0.5,
) -> VisionFeasibilityOutput | None:
    """Roll capability composites into a vision composite.

    Args:
        capabilities: Per-capability composite + weight. Capabilities
            with composite=None are skipped (not "0" — null preserves
            "not assessed").
        softening: 0..1 — same semantics as capability aggregator but
            at vision level. Default 0.5 (slightly more Liebig-strict
            than per-capability default 0.6).

    Returns:
        None when no capabilities have a composite. Otherwise the
        aggregated output.
    """
    if not 0.0 <= softening <= 1.0:
        raise ValueError(f"softening must be in [0, 1], got {softening}")

    rated = [c for c in capabilities if c.composite is not None and c.weight > 0]
    if not rated:
        return None

    total_w = sum(c.weight for c in rated)
    if total_w <= 0:
        return None

    # Weighted mean of capability composites.
    weighted_mean = sum(c.composite * c.weight for c in rated) / total_w  # type: ignore[misc]

    # Binding capability = the one whose score is lowest. (Equal-weight
    # ties resolve to the first declared.)
    binding = min(rated, key=lambda c: c.composite)  # type: ignore[arg-type]
    binding_score = binding.composite
    assert binding_score is not None

    # Liebig softening at vision level.
    composite = binding_score + softening * (weighted_mean - binding_score)
    composite = max(0.0, min(100.0, composite))

    # Variance band: weighted RSS of per-capability half-bands. When
    # band is missing on a capability, fall back to a default 5-pt half
    # (we still want SOMETHING surfaced rather than null at vision
    # level).
    p10s = []
    p90s = []
    for c in rated:
        p10 = c.composite_p10 if c.composite_p10 is not None else (c.composite or 0) - 5
        p90 = c.composite_p90 if c.composite_p90 is not None else (c.composite or 0) + 5
        p10s.append(max(0.0, p10))
        p90s.append(min(100.0, p90))
    weights = [c.weight for c in rated]
    weighted_p10_var = sum(
        w * (p - weighted_mean) ** 2 for w, p in zip(weights, p10s, strict=False)
    ) / total_w
    weighted_p90_var = sum(
        w * (p - weighted_mean) ** 2 for w, p in zip(weights, p90s, strict=False)
    ) / total_w
    band_p10 = max(0.0, composite - math.sqrt(weighted_p10_var))
    band_p90 = min(100.0, composite + math.sqrt(weighted_p90_var))

    return VisionFeasibilityOutput(
        composite=round(composite, 2),
        composite_p10=round(band_p10, 2),
        composite_p90=round(band_p90, 2),
        binding_capability_key=binding.key,
    )
