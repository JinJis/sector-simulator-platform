"""agent-orchestration — FastAPI service that runs agent workflows.

Today: in-memory `WorkflowRunner` + one `DecompositionWorkflow`.
Tomorrow: same `Workflow` protocol, Temporal-backed runner. The HTTP
surface stays the same; only the runner swaps.
"""

from agent_orchestration.schemas import (
    Decomposition,
    DecompositionRequest,
    DriverNode,
    IntermediateNode,
    OutputNode,
    WorkflowRecord,
    WorkflowStatus,
)
from agent_orchestration.workflows import (
    DecompositionWorkflow,
    Workflow,
    WorkflowRunner,
)

__all__ = [
    "Decomposition",
    "DecompositionRequest",
    "DecompositionWorkflow",
    "DriverNode",
    "IntermediateNode",
    "OutputNode",
    "Workflow",
    "WorkflowRecord",
    "WorkflowRunner",
    "WorkflowStatus",
]
