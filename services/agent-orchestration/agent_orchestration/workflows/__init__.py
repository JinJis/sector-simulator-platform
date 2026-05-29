"""Re-export shim. Concrete workflow classes live in
:mod:`agent_orchestration.workflows.legacy`,
:mod:`agent_orchestration.workflows.scoring`, and
:mod:`agent_orchestration.workflows.vision_builder`. The
:class:`Workflow` protocol + :class:`WorkflowRunner` live in
:mod:`agent_orchestration.runner`.

Every existing ``from agent_orchestration.workflows import <Name>``
keeps working through this shim; new code is free to import from the
sub-modules directly.
"""

from agent_orchestration.runner import InputT, OutputT, Workflow, WorkflowRunner
from agent_orchestration.workflows.legacy import (
    CodeGenWorkflow,
    CodeReviewWorkflow,
    DecompositionWorkflow,
    DriverInferenceWorkflow,
    EdgeInferenceWorkflow,
    FullPipelineWorkflow,
    ProposeSectorWorkflow,
    ResearchWorkflow,
)
from agent_orchestration.workflows.scoring import (
    CapabilityScoreUpdaterWorkflow,
    SignalExtractorWorkflow,
)
from agent_orchestration.workflows.vision_builder import (
    DataSourceSelectorWorkflow,
    PromptValidatorWorkflow,
    ProposalPayloadDrafterWorkflow,
    ThesisDrafterWorkflow,
    VisionDecompositionWorkflow,
)

__all__ = [
    # protocol + runner (re-exported for back-compat — new code should
    # import these from agent_orchestration.runner)
    "InputT",
    "OutputT",
    "Workflow",
    "WorkflowRunner",
    # legacy / phase-3
    "CodeGenWorkflow",
    "CodeReviewWorkflow",
    "DecompositionWorkflow",
    "DriverInferenceWorkflow",
    "EdgeInferenceWorkflow",
    "FullPipelineWorkflow",
    "ProposeSectorWorkflow",
    "ResearchWorkflow",
    # scoring
    "CapabilityScoreUpdaterWorkflow",
    "SignalExtractorWorkflow",
    # vision builder
    "DataSourceSelectorWorkflow",
    "ProposalPayloadDrafterWorkflow",
    "PromptValidatorWorkflow",
    "ThesisDrafterWorkflow",
    "VisionDecompositionWorkflow",
]
