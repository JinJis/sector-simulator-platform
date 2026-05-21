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


# ---- Domain: edge-inference output ---------------------------------------


class EdgeSpec(BaseModel):
    """One edge in the causal DAG. `label` is the math step the edge
    represents (e.g. "× duty cycle", "÷ η") — surfaces on hover in the
    Graph view and feeds the Code Gen Agent."""

    source: str = Field(..., description="snake_case source node name")
    target: str = Field(..., description="snake_case target node name")
    label: str = Field("", description="Operation label, e.g. '× duty cycle'")


class IntermediateFormula(BaseModel):
    """Closed-form formula for an intermediate node, expressed against
    drivers and earlier intermediates."""

    name: str
    formula: str
    unit: str = ""
    description: str = ""


class OutputFormula(BaseModel):
    """Final-output formula. `depends_on` lists the upstream node names
    (drivers + intermediates) so a downstream graph can be drawn without
    parsing the formula string."""

    name: str
    formula: str
    kind: Literal["scalar", "series"]
    depends_on: list[str] = Field(default_factory=list)


class EdgeInferenceResult(BaseModel):
    """Structured output of the Edge Inference Agent — the causal DAG
    that connects drivers → intermediates → outputs, plus the math
    formulas for each non-driver node, plus any modelling assumptions
    the agent had to make to close ambiguities."""

    edges: list[EdgeSpec] = Field(..., min_length=1)
    intermediates: list[IntermediateFormula] = Field(default_factory=list)
    outputs: list[OutputFormula] = Field(..., min_length=1)
    assumptions: list[str] = Field(default_factory=list)


# ---- Domain: propose-sector composite ------------------------------------


class ProposeSectorResult(BaseModel):
    """Composite output of the multi-step ProposeSectorWorkflow.

    Stage 1 (`decomposition`) produces the sector's node schema.
    Stage 2 (`edge_inference`) produces the causal edges + formulas.

    Persisting both stages on one workflow record means the admin
    `proposeFromAgent` mutation has a single source of truth — no
    cross-workflow joins.
    """

    decomposition: Decomposition
    edge_inference: EdgeInferenceResult


# ---- Workflow inputs -----------------------------------------------------


class DecompositionRequest(BaseModel):
    """User-facing input to the decomposition workflow.

    Reference data is optional — when present, the orchestrator interpolates
    it into the user turn so the agent can compare against existing sectors.
    """

    description: str = Field(..., min_length=10, max_length=4000)
    reference_data: str | None = Field(default=None, max_length=20000)


class EdgeInferenceRequest(BaseModel):
    """Input to the EdgeInferenceWorkflow. The orchestrator passes the
    full Decomposition so the agent can cross-check driver units +
    intermediate / output names."""

    decomposition: Decomposition


class ProposeSectorRequest(BaseModel):
    """Multi-step entry point — same surface as DecompositionRequest
    plus the same reference_data passthrough. The orchestrator chains
    Decomposition → EdgeInference internally."""

    description: str = Field(..., min_length=10, max_length=4000)
    reference_data: str | None = Field(default=None, max_length=20000)
