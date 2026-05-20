"""Pydantic schemas for the orchestration service.

Two layers here:

1. **Domain output schemas** (`DriverNode`, `IntermediateNode`, `OutputNode`,
   `Decomposition`) — what the decomposition agent must produce. They
   intentionally mirror `SimulationBase` so the result can later be
   persisted as a class file with minimal transformation.
2. **Workflow envelope schemas** (`WorkflowStatus`, `WorkflowRecord`,
   `DecompositionRequest`) — what the HTTP API exposes. These are
   independent of the agent's output so a future workflow can plug in
   without disturbing them.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---- Domain: decomposition output ----------------------------------------


class DriverNode(BaseModel):
    """One slider on the future workspace. Mirrors `platform_sdk.Driver`."""

    name: str = Field(..., description="snake_case identifier")
    group: str = Field(..., description="Display group e.g. 'Demand', 'Supply'")
    unit: str = ""
    default: float
    min: float
    max: float
    description: str = ""


class IntermediateNode(BaseModel):
    """A calculated quantity that fans out from drivers — for the graph view."""

    name: str
    unit: str = ""
    description: str = ""


class OutputNode(BaseModel):
    name: str
    kind: Literal["scalar", "series"]
    unit: str = ""
    description: str = ""


class Decomposition(BaseModel):
    """Full output of the decomposition agent. Same shape regardless of which
    user query produced it — the structured-output contract."""

    name: str = Field(..., description="Human-readable sector name")
    slug: str = Field(..., description="kebab-case, lowercase, ascii")
    description: str
    horizon_years: int = Field(..., ge=1, le=50)
    drivers: list[DriverNode] = Field(..., min_length=1)
    intermediates: list[IntermediateNode] = Field(default_factory=list)
    outputs: list[OutputNode] = Field(..., min_length=1)


# ---- Workflow envelope ---------------------------------------------------


class WorkflowStatus(str, Enum):
    """Mirrors Temporal's transitions so the swap to Temporal-backed
    is a renaming exercise, not a re-architecture."""

    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class WorkflowRecord(BaseModel):
    """The HTTP-facing view of a workflow. Excludes the per-call usage detail
    that lives on the runner — `cost_usd` is the rolled-up total."""

    id: str
    kind: str
    """Workflow type identifier, e.g. 'decomposition'."""
    status: WorkflowStatus
    created_at: datetime
    updated_at: datetime
    input: dict[str, Any]
    output: dict[str, Any] | None = None
    error: str | None = None
    cost_usd: float = 0.0


# ---- Workflow inputs -----------------------------------------------------


class DecompositionRequest(BaseModel):
    """User-facing input to the decomposition workflow.

    Reference data is optional — when present, the orchestrator interpolates
    it into the user turn so the agent can compare against existing sectors.
    """

    description: str = Field(..., min_length=10, max_length=4000)
    reference_data: str | None = Field(default=None, max_length=20000)
