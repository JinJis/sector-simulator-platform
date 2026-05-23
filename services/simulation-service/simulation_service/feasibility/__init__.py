"""Feasibility scoring engine (M40).

Three pure-math layers:

  - `aggregator` — per-capability composite from 4 dimensions
    (technical / economic / regulatory / supply) with optional binding-
    constraint softening (Liebig's law).
  - `vision_aggregator` — vision-level composite from capability
    composites, sorted to identify the binding capability.
  - `eta` — linear extrapolation from recent trajectory to a target
    feasibility threshold (default 80). Returns ETA distribution
    (median / P10 / P90) in years from now.
  - `delta` — 90-day delta calculation from a time series.

All math is pure. The orchestrator (data-pipeline cron) loads inputs,
calls these, writes outputs. M40b wires the agent-driven updater that
feeds inputs in.
"""

from .aggregator import CapabilityScoreInput, CompositeOutput, aggregate_capability
from .delta import compute_delta_90d
from .eta import EtaEstimate, estimate_eta
from .vision_aggregator import (
    CapabilityForVision,
    VisionFeasibilityOutput,
    aggregate_vision,
)

__all__ = [
    "CapabilityForVision",
    "CapabilityScoreInput",
    "CompositeOutput",
    "EtaEstimate",
    "VisionFeasibilityOutput",
    "aggregate_capability",
    "aggregate_vision",
    "compute_delta_90d",
    "estimate_eta",
]
