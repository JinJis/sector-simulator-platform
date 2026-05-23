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


# ---- Domain: research-brief output (M28) ---------------------------------


SourceKind = Literal[
    "paper",
    "vendor_doc",
    "analyst",
    "benchmark",
    "gov_report",
    "dataset",
    "news",
    "filing",
]


class ResearchSourceCitation(BaseModel):
    """One citation backing a research anchor. Same `kind` taxonomy as
    `platform_sdk.Source` so downstream agents can pass it through
    unchanged."""

    title: str
    url: str = ""
    kind: SourceKind
    excerpt: str = ""


class ResearchAnchor(BaseModel):
    """One numeric anchor extracted by the Research Agent. The
    `value_range` is a human-readable string ("$200–$2700/kg LEO") —
    Driver Inference parses it into a concrete `default`/`min`/`max`."""

    concept: str = Field(..., description="Short noun phrase")
    value_range: str = Field(
        ..., description="Numeric range with unit, e.g. '$200-$2700 per kg LEO'"
    )
    as_of: str = Field(..., description="ISO date or year, e.g. '2024-Q4'")
    sources: list[ResearchSourceCitation] = Field(..., min_length=1)


class ResearchBrief(BaseModel):
    """Structured output of the Research Agent — the sector framing +
    sourced numeric anchors that Decomposition + Driver Inference
    consume."""

    summary: str = Field(..., description="3-5 sentence framing")
    anchors: list[ResearchAnchor] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


# ---- Domain: driver-inference output (M28) -------------------------------


class DriverHistoryPoint(BaseModel):
    """One (date, value) tuple on a driver's history series."""

    date: str = Field(..., description="ISO date or year, e.g. '2024' or '2024-Q1'")
    value: float


class DriverSourceRef(BaseModel):
    """Per-driver source citation. Same `kind` taxonomy as
    `platform_sdk.Source`."""

    title: str
    url: str = ""
    as_of: str = ""
    kind: SourceKind
    excerpt: str = ""


class CalibratedDriver(BaseModel):
    """Output of Driver Inference — one driver with full provenance.
    Mirrors `platform_sdk.Provenance` shape so the code-gen agent can
    transcribe it verbatim into the generated `provenance = {...}` dict."""

    name: str = Field(..., description="snake_case — must match the Decomposition")
    default: float
    min: float
    max: float
    unit: str = ""
    description: str = ""
    history: list[DriverHistoryPoint] = Field(default_factory=list)
    sources: list[DriverSourceRef] = Field(..., min_length=1)
    note: str = Field(
        default="",
        description="1 sentence — direction, certainty, what's likely to change",
    )


class DriverInferenceResult(BaseModel):
    """Structured output of the Driver Inference Agent — calibrated
    drivers with provenance + a list of names the agent couldn't
    confidently calibrate (so admin can flag them)."""

    drivers: list[CalibratedDriver] = Field(..., min_length=1)
    unresolved: list[str] = Field(default_factory=list)


# ---- Domain: code-gen output (M28) ---------------------------------------


class CodeGenResult(BaseModel):
    """Structured output of the Code Gen Agent — a complete Python
    class file as a string, plus the slug/module_name/class_name the
    sandbox will use for filesystem placement and the list of
    self-reported concerns Code Review must triage.

    The `source` field is a full `.py` body — the orchestrator does
    NOT execute it; that happens in the Modal sandbox slice. We only
    persist the string here.
    """

    slug: str = Field(..., description="kebab-case sector slug")
    module_name: str = Field(..., description="snake_case module name")
    class_name: str = Field(..., description="PascalCase class name")
    source: str = Field(..., min_length=1, description="Complete .py file contents")
    concerns: list[str] = Field(default_factory=list)


# ---- Domain: code-review output (M28) ------------------------------------


CodeReviewStatus = Literal["approve", "revise", "reject"]
CodeReviewSeverity = Literal["blocker", "major", "minor", "nit"]
CodeReviewCategory = Literal[
    "spec_mismatch", "logic", "safety", "style", "provenance"
]


class CodeReviewFinding(BaseModel):
    """One finding from the Code Review Agent."""

    severity: CodeReviewSeverity
    category: CodeReviewCategory
    location: str = Field(
        ...,
        description="ClassName.method or attribute name, e.g. 'simulate / capex section'",
    )
    message: str = Field(..., description="1-2 sentences — what's wrong")
    suggestion: str = Field(
        default="", description="What Code Gen should do to fix it"
    )


class CodeReviewRerunInputs(BaseModel):
    """If the review verdict is `revise` / `reject`, which upstream
    agents should the orchestrator rerun vs. preserve."""

    preserve: list[str] = Field(default_factory=list)
    rerun: list[str] = Field(default_factory=list)


class CodeReviewResult(BaseModel):
    """Structured output of the Code Review Agent."""

    status: CodeReviewStatus
    findings: list[CodeReviewFinding] = Field(default_factory=list)
    summary: str = Field(..., description="1-2 sentences — overall verdict")
    rerun_inputs: CodeReviewRerunInputs = Field(default_factory=CodeReviewRerunInputs)


# ---- Domain: full-pipeline composite (M28) -------------------------------


class FullPipelineResult(BaseModel):
    """Composite output of the FullPipelineWorkflow. The orchestrator
    chains:

        Research → Decomposition → DriverInference → EdgeInference
                 → CodeGen → CodeReview

    All six stages share the same `CostMeter`, so the workflow record's
    `cost_usd` is the headline number an admin needs.

    Persisting every stage means an admin can re-run a single stage
    later by supplying the intermediate outputs as input — that's a
    follow-up; today we just persist + render.
    """

    research: ResearchBrief
    decomposition: Decomposition
    driver_inference: DriverInferenceResult
    edge_inference: EdgeInferenceResult
    code_gen: CodeGenResult
    code_review: CodeReviewResult


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


class ResearchRequest(BaseModel):
    """Input to the ResearchWorkflow. `focus_areas` is the list of
    quantitative anchors the orchestrator wants the agent to prioritize
    — empty means 'let the agent pick'."""

    description: str = Field(..., min_length=10, max_length=4000)
    focus_areas: list[str] = Field(default_factory=list)


class DriverInferenceRequest(BaseModel):
    """Input to the DriverInferenceWorkflow. ResearchBrief is optional
    because driver inference can degrade gracefully without one (the
    agent just uses the Decomposition defaults as priors)."""

    decomposition: Decomposition
    research_brief: ResearchBrief | None = None


class CodeGenRequest(BaseModel):
    """Input to the CodeGenWorkflow. The slug picks the filesystem
    location for the eventual file; the three structured upstream
    outputs are the spec the agent transcribes."""

    slug: str = Field(..., min_length=1, max_length=64)
    decomposition: Decomposition
    driver_inference: DriverInferenceResult
    edge_inference: EdgeInferenceResult


class CodeReviewRequest(BaseModel):
    """Input to the CodeReviewWorkflow. `source` is the file body the
    Code Gen Agent produced; the three structured upstream results
    let the reviewer cross-check the file against the spec; concerns
    are anything Code Gen flagged about itself."""

    source: str = Field(..., min_length=1, max_length=200_000)
    decomposition: Decomposition
    driver_inference: DriverInferenceResult
    edge_inference: EdgeInferenceResult
    concerns: list[str] = Field(default_factory=list)


class FullPipelineRequest(BaseModel):
    """Headline workflow entry point. Same surface as
    `ProposeSectorRequest` — the orchestrator picks up the rest of the
    pipeline (research → decomposition → driver_inference →
    edge_inference → code_gen → code_review) internally."""

    description: str = Field(..., min_length=10, max_length=4000)
    reference_data: str | None = Field(default=None, max_length=20000)
    focus_areas: list[str] = Field(default_factory=list)


# =====================================================================
# M39b — SignalExtractor (haiku tier, ~100-1000 calls/day)
# =====================================================================


class ActorKeywordSet(BaseModel):
    """One actor's keyword set for extractor matching. Single Actor can
    match multiple aliases — extractor returns `matched_actor_key` when
    any alias matches with high confidence."""

    actor_key: str
    aliases: list[str] = Field(default_factory=list)


class SignalExtractorRequest(BaseModel):
    """Input to the SignalExtractor agent.

    The agent decides per-dimension deltas (technical / economic /
    regulatory / supply) within -10..+10 based on the signal's content +
    the capability context. Confidence < 0.5 means "don't update the
    score" — caller treats those deltas as null.
    """

    sector_slug: str
    capability_key: str
    capability_name: str = Field(..., description="For agent context.")
    capability_description: str = Field(..., max_length=2000)
    capability_rationale: str = Field(..., max_length=2000)
    signal_title: str = Field(..., max_length=500)
    signal_summary: str | None = Field(default=None, max_length=4000)
    source_kind: str = Field(..., description="paper / patent / news / filing / ...")
    # Actor keyword sets — extractor matches signal text against these
    # to tag a single best actor. Keep ≤25 to fit in haiku context.
    actor_keywords: list[ActorKeywordSet] = Field(default_factory=list, max_length=25)


class SignalScoring(BaseModel):
    """Output of the SignalExtractor agent.

    Deltas are signed; nullable when the agent isn't confident the
    signal moves that dimension. is_highlight=True promotes to the hero
    "Live Signals" panel — reserve for signals with |delta| >= 3 or
    high regulatory/political importance.
    """

    delta_technical: float | None = Field(default=None, ge=-10, le=10)
    delta_economic: float | None = Field(default=None, ge=-10, le=10)
    delta_regulatory: float | None = Field(default=None, ge=-10, le=10)
    delta_supply: float | None = Field(default=None, ge=-10, le=10)
    # Extractor's self-rated confidence in the scoring. Caller can drop
    # all deltas to null when confidence < 0.5.
    confidence: float = Field(..., ge=0.0, le=1.0)
    is_highlight: bool = Field(
        default=False,
        description="Promote to hero 'Live Signals' band. Reserve for high-magnitude signals.",
    )
    # Best-matching actor by key (only if confidence > 0.8 per REFACTOR
    # §18.8). Caller is responsible for resolving to Actor.id.
    matched_actor_key: str | None = None
    # Brief rationale for the scoring — captured for audit/debugging.
    rationale: str = Field(default="", max_length=500)


class SignalExtractorRunResult(BaseModel):
    """Combined result of one extractor run — workflow output + per-
    workflow cost. Returned by `/signal-extractor/score` HTTP endpoint."""

    scoring: SignalScoring
    cost_usd: float
    duration_ms: int


# Re-export ActorKeywordSet from the request module so callers don't
# have to chase the import path.
__all_signal_extractor__ = (
    "ActorKeywordSet",
    "SignalExtractorRequest",
    "SignalScoring",
    "SignalExtractorRunResult",
)
