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


# =====================================================================
# M40b — CapabilityScoreUpdater (sonnet tier)
# =====================================================================


class RecentSignal(BaseModel):
    """One scored signal to feed the score updater. Trimmed to the
    fields that matter for re-scoring — the actual Signal row carries
    more (source_url, ingested_at, etc.) but we don't need those here."""

    title: str
    summary: str | None = None
    source_kind: str
    published_at: datetime
    delta_technical: float | None = None
    delta_economic: float | None = None
    delta_regulatory: float | None = None
    delta_supply: float | None = None
    actor_short_name: str | None = None


class CapabilityScoreUpdaterRequest(BaseModel):
    """Input to the ScoreUpdater agent. Carries the current capability
    state + the recent signal feed so the agent can reason over the
    delta + apply temporal decay."""

    sector_slug: str
    capability_key: str
    capability_name: str
    capability_description: str = Field(..., max_length=2000)
    capability_rationale: str = Field(..., max_length=2000)
    # Current scores — None when not assessed yet.
    current_technical: float | None = Field(default=None, ge=0, le=100)
    current_economic: float | None = Field(default=None, ge=0, le=100)
    current_regulatory: float | None = Field(default=None, ge=0, le=100)
    current_supply: float | None = Field(default=None, ge=0, le=100)
    # Recent signals — trimmed to ≤50 for context budget. Caller
    # orders newest-first.
    recent_signals: list[RecentSignal] = Field(default_factory=list, max_length=50)


class CapabilityScoreUpdate(BaseModel):
    """Output of the ScoreUpdater agent.

    All 4 dims are nullable — agent leaves a dim unchanged by returning
    None for it. Caller (recompute cron) preserves the prior value via
    COALESCE when writing.
    """

    technical: float | None = Field(default=None, ge=0, le=100)
    economic: float | None = Field(default=None, ge=0, le=100)
    regulatory: float | None = Field(default=None, ge=0, le=100)
    supply: float | None = Field(default=None, ge=0, le=100)
    # Free-text agent-written explanation of what moved + why.
    rationale: str = Field(default="", max_length=1000)
    # Confidence in this update overall (0..1). Caller can skip writing
    # when below threshold.
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class CapabilityScoreUpdaterRunResult(BaseModel):
    """HTTP envelope for /capability-score-updater/score."""

    update: CapabilityScoreUpdate
    cost_usd: float
    duration_ms: int


# =====================================================================
# M41 — Vision Builder pipeline schemas
#
# Six-stage flow:
#   1. PromptValidator (haiku)        — sanity-check user prompt
#   2. VisionResearch (sonnet)        — context gathering (existing
#                                       ResearchWorkflow reused)
#   3. VisionDecomposition (opus)     — full vision draft
#   4. DataSourceSelector (sonnet)    — per-capability keyword sets
#   5. ValidationGate (pure Python)   — DAG + uniqueness + FK checks
#   6. Conductor → admin → persist    — atomic create
#
# Every LLM stage outputs a Pydantic schema. Each schema enforces
# bounds (0-100 for scores, ≤enum values for categories) so the
# downstream validation gate has less to do.
# =====================================================================


# ---- Stage 1: Prompt validation ----------------------------------------


class VisionBuilderPromptRequest(BaseModel):
    """Raw user prompt + optional context. The validator does the
    sanity check before any expensive opus call burns budget."""

    prompt: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="User's natural-language vision request.",
    )
    # Existing slugs the validator should check for duplicate framing.
    existing_vision_slugs: list[str] = Field(default_factory=list, max_length=200)


class PromptValidationResult(BaseModel):
    """Stage-1 output. is_valid=False short-circuits the pipeline; the
    admin UI surfaces the rejection_reason + the refined_question as a
    "try this instead" suggestion."""

    is_valid: bool
    rejection_kind: (
        Literal[
            "off_topic",
            "too_vague",
            "too_narrow",
            "policy_violation",
            "duplicate",
        ]
        | None
    ) = None
    rejection_reason: str | None = Field(
        default=None,
        max_length=500,
        description="Plain-language explanation for the user.",
    )

    # Even on rejection, the refined_question gives the user a hint at
    # what kind of question would have worked.
    refined_question: str = Field(
        ...,
        max_length=240,
        description="Canonical 'By when will X happen?' framing.",
    )
    suggested_name: str = Field(..., max_length=80)
    suggested_slug: str = Field(
        ...,
        pattern=r"^[a-z0-9][a-z0-9-]*[a-z0-9]$",
        max_length=64,
        description="Lowercase kebab-case URL slug.",
    )

    # Sizing guidance for the downstream decomposition.
    domain_label: str = Field(
        ...,
        max_length=40,
        description="Coarse category: Space, Energy, Compute, Bio, ...",
    )
    scope: Literal["narrow", "balanced", "broad"]
    suggested_capability_count: int = Field(..., ge=3, le=15)
    suggested_actor_count: int = Field(..., ge=3, le=30)

    # Things the admin should double-check at the review step.
    review_notes: list[str] = Field(default_factory=list, max_length=10)

    # Confidence in the validation itself. <0.5 → admin should pay
    # extra attention to review_notes before approving.
    confidence: float = Field(..., ge=0.0, le=1.0)


class PromptValidatorRunResult(BaseModel):
    """HTTP envelope for /vision-builder/validate-prompt."""

    validation: PromptValidationResult
    cost_usd: float
    duration_ms: int


# ---- Stage 3: Vision decomposition (opus tier — biggest call) ----------


class CapabilityDraft(BaseModel):
    """One capability proposal. Pydantic enforces every field's bounds
    so the validation gate has less to do. `key` follows the DB layer's
    snake_case rule."""

    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    name: str = Field(..., min_length=2, max_length=120)
    short_name: str | None = Field(default=None, max_length=40)
    description: str = Field(..., min_length=20, max_length=600)
    rationale: str = Field(..., min_length=20, max_length=600)
    weight: float = Field(..., ge=0.02, le=0.50)
    display_order: int = Field(..., ge=10, le=10_000)
    primary_driver_name: str | None = Field(default=None, max_length=80)
    initial_technical: float | None = Field(default=None, ge=0, le=100)
    initial_economic: float | None = Field(default=None, ge=0, le=100)
    initial_regulatory: float | None = Field(default=None, ge=0, le=100)
    initial_supply: float | None = Field(default=None, ge=0, le=100)
    confidence: float = Field(default=0.7, ge=0.0, le=1.0)


class CapabilityDependencyDraft(BaseModel):
    """One DAG edge between capabilities."""

    source_key: str = Field(..., max_length=64)
    target_key: str = Field(..., max_length=64)
    rationale: str = Field(..., min_length=10, max_length=400)


class RiskDraft(BaseModel):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    category: Literal[
        "political",
        "legal",
        "supply",
        "safety",
        "environmental",
        "financial",
        "social",
    ]
    name: str = Field(..., min_length=2, max_length=120)
    description: str = Field(..., min_length=20, max_length=600)
    severity: Literal["low", "medium", "high", "critical"]
    likelihood: Literal["low", "medium", "high"]
    time_horizon: Literal["immediate", "1y", "3y", "5y", "10y"]
    mitigations: str | None = Field(default=None, max_length=600)
    affected_capability_keys: list[str] = Field(default_factory=list, max_length=10)
    display_order: int = Field(..., ge=10, le=10_000)


class ActorDraft(BaseModel):
    """Global actor — company / lab / govt body. Fresh keys go to the
    Actor table; matches by `key` on existing rows."""

    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$", max_length=64)
    name: str = Field(..., min_length=2, max_length=160)
    short_name: str | None = Field(default=None, max_length=80)
    name_local: str | None = Field(default=None, max_length=160)
    iso_country: str = Field(..., pattern=r"^[A-Z]{2}$")
    category: Literal[
        "public_corp",
        "private_startup",
        "government_lab",
        "national_lab",
        "academic_lab",
        "standards_body",
        "ngo",
    ]
    ticker: str | None = Field(default=None, max_length=20)
    exchange: str | None = Field(default=None, max_length=20)
    blurb: str = Field(..., min_length=10, max_length=280)
    description: str | None = Field(default=None, max_length=2000)
    stage: Literal["research", "pilot", "commercial", "scaling"]
    website: str | None = Field(default=None, max_length=300)
    signal_keywords: list[str] = Field(..., min_length=1, max_length=20)
    relevance: float = Field(..., ge=0, le=100)
    rationale: str = Field(..., min_length=10, max_length=600)
    display_order: int = Field(..., ge=10, le=10_000)


class CapabilityActorAssignmentDraft(BaseModel):
    """Wiring between one capability and one actor with a role."""

    capability_key: str = Field(..., max_length=64)
    actor_key: str = Field(..., max_length=64)
    role: Literal["lead", "competitor", "supplier", "customer", "regulator"]
    rationale: str | None = Field(default=None, max_length=400)


class VisionFeasibilityDraft(BaseModel):
    """Agent's initial vision-level feasibility estimate.

    The M40 recompute cron will overwrite it the next day from real
    capability scores — this is just a Day-0 placeholder."""

    initial_composite: float = Field(..., ge=0, le=100)
    initial_p10: float | None = Field(default=None, ge=0, le=100)
    initial_p90: float | None = Field(default=None, ge=0, le=100)
    binding_capability_key: str = Field(..., max_length=64)
    eta_median_years: float | None = Field(default=None, ge=0, le=50)
    eta_p10_years: float | None = Field(default=None, ge=0, le=50)
    eta_p90_years: float | None = Field(default=None, ge=0, le=50)
    rationale: str = Field(..., min_length=20, max_length=600)


class VisionDecompositionRequest(BaseModel):
    """Input to stage-3 decomposition. Carries the validator output so
    the agent doesn't re-derive question / slug / sizing."""

    refined_question: str = Field(..., max_length=240)
    suggested_name: str = Field(..., max_length=80)
    suggested_slug: str = Field(
        ..., pattern=r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", max_length=64
    )
    domain_label: str = Field(..., max_length=40)
    scope: Literal["narrow", "balanced", "broad"]
    target_capability_count: int = Field(..., ge=3, le=15)
    target_actor_count: int = Field(..., ge=3, le=30)
    research_brief: str | None = Field(default=None, max_length=20_000)
    existing_actor_keys: list[str] = Field(default_factory=list, max_length=500)


class VisionDecompositionResult(BaseModel):
    """The full vision draft — output of stage 3."""

    slug: str = Field(
        ..., pattern=r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", max_length=64
    )
    name: str = Field(..., max_length=80)
    vision_question: str = Field(..., max_length=240)
    description: str = Field(..., min_length=50, max_length=2000)
    domain_label: str = Field(..., max_length=40)

    capabilities: list[CapabilityDraft] = Field(..., min_length=3, max_length=15)
    dependencies: list[CapabilityDependencyDraft] = Field(default_factory=list, max_length=50)
    risks: list[RiskDraft] = Field(..., min_length=2, max_length=12)
    actors: list[ActorDraft] = Field(..., min_length=3, max_length=30)
    capability_actors: list[CapabilityActorAssignmentDraft] = Field(
        ..., min_length=1, max_length=100
    )
    initial_feasibility: VisionFeasibilityDraft

    rationale: str = Field(..., min_length=50, max_length=4000)
    confidence: float = Field(..., ge=0.0, le=1.0)


class VisionDecompositionRunResult(BaseModel):
    """HTTP envelope for /vision-builder/decompose."""

    draft: VisionDecompositionResult
    cost_usd: float
    duration_ms: int


# ---- Stage 5 (F8a-2): Investment thesis + catalysts drafter (sonnet) ---
#
# Produces the editorial-overlay rows persisted into InvestmentThesis +
# Catalyst tables. Optional stage — if the LLM call fails or the gate
# rejected the decomposition, commit still succeeds with thesis=null.
# ------------------------------------------------------------------------


class ThesisBulletDraft(BaseModel):
    """One bullet in bull_case or bear_case. `source_urls` is optional;
    the apps/web SourceRef shape is richer (`url + kind + published_at`)
    but the LLM only knows URLs reliably — the UI degrades cleanly."""

    text: str = Field(..., min_length=10, max_length=400)
    source_urls: list[str] = Field(default_factory=list, max_length=5)


class InvestmentThesisDraft(BaseModel):
    """1:1 with the InvestmentThesis row. `conviction` is a string enum
    kept loose so the admin can broaden later without a migration."""

    the_bet: str = Field(..., min_length=20, max_length=400)
    bull_case: list[ThesisBulletDraft] = Field(..., min_length=2, max_length=6)
    bear_case: list[ThesisBulletDraft] = Field(..., min_length=2, max_length=6)
    conviction: Literal["high", "medium", "low", "exploratory"]


class CatalystDraft(BaseModel):
    """One row in `catalysts`. `expected_at` is an ISO date string; the
    Pydantic side keeps it as `str` so the JSON round-trip across the
    sector-service / agent-orchestration HTTP boundary stays free of
    timezone gotchas (sector-service parses to Date)."""

    expected_at: str = Field(
        ..., pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="ISO date (YYYY-MM-DD) the event is projected for",
    )
    label: str = Field(..., min_length=5, max_length=200)
    capability_key: str | None = Field(default=None, max_length=64)
    side: Literal["bull", "bear", "neutral"]
    note: str | None = Field(default=None, max_length=400)
    source_url: str | None = Field(default=None, max_length=500)


class ThesisDrafterRequest(BaseModel):
    """Inputs the drafter sees — the validated draft summary minus the
    actor + dependency wiring (the drafter doesn't need them to write a
    thesis)."""

    slug: str = Field(..., max_length=64)
    name: str = Field(..., max_length=80)
    refined_question: str = Field(..., max_length=240)
    domain_label: str = Field(..., max_length=40)
    description: str = Field(..., min_length=50, max_length=2000)
    capabilities: list[CapabilityDraft] = Field(..., min_length=1, max_length=15)
    risks: list[RiskDraft] = Field(..., min_length=1, max_length=12)
    binding_capability_key: str = Field(..., max_length=64)
    initial_composite: float = Field(..., ge=0, le=100)


class ThesisCatalystsDraft(BaseModel):
    """Workflow output. Persisted into InvestmentThesis + Catalyst[] by
    sector-service.visionBuilder.commit."""

    thesis: InvestmentThesisDraft
    catalysts: list[CatalystDraft] = Field(..., min_length=2, max_length=10)
    rationale: str = Field(default="", max_length=2000)


# ---- Stage 4: Data source selector (sonnet) ----------------------------


class CapabilityKeywordSet(BaseModel):
    """Per-capability keyword set for the signal ingest pipeline.
    Three lists because arXiv (academic), USPTO (patent vocab), and
    NewsAPI (business news) idioms differ enough that one flat list
    misses material. Adapters OR-join within their list."""

    capability_key: str = Field(..., max_length=64)
    arxiv_keywords: list[str] = Field(..., min_length=1, max_length=20)
    uspto_keywords: list[str] = Field(default_factory=list, max_length=20)
    news_keywords: list[str] = Field(default_factory=list, max_length=20)


class DataSourceSelectorRequest(BaseModel):
    """Input to stage 4 — the decomposition output for context."""

    slug: str = Field(..., max_length=64)
    domain_label: str = Field(..., max_length=40)
    capabilities: list[CapabilityDraft] = Field(..., min_length=1, max_length=15)


class DataSourceConfigDraft(BaseModel):
    """Per-capability keyword sets. The Conductor persists these into
    Capability.signal_keywords so the signal_ingest cron picks them
    up on next run."""

    keywords_by_capability: list[CapabilityKeywordSet] = Field(
        ..., min_length=1, max_length=15
    )
    rationale: str = Field(default="", max_length=2000)


class DataSourceSelectorRunResult(BaseModel):
    """HTTP envelope for /vision-builder/select-data-sources."""

    config: DataSourceConfigDraft
    cost_usd: float
    duration_ms: int


# ---- Conductor: full end-to-end pipeline -------------------------------


class VisionBuilderRequest(BaseModel):
    """Single-call entry point — admin posts a natural-language prompt
    and we run all four stages."""

    prompt: str = Field(..., min_length=15, max_length=4000)
    existing_vision_slugs: list[str] = Field(default_factory=list, max_length=500)
    existing_actor_keys: list[str] = Field(default_factory=list, max_length=2000)
    research_brief: str | None = Field(default=None, max_length=20_000)


class StageMetricDto(BaseModel):
    """One row in the per-stage cost / latency table."""

    name: str
    cost_usd: float
    duration_ms: int


class ValidationGateDto(BaseModel):
    """Serialized ValidationGateResult for HTTP wire."""

    ok: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class VisionBuilderRunResult(BaseModel):
    """HTTP envelope for /vision-builder/build.

    Failure cases:
      - validation.is_valid=False → stage-1 rejection; draft/gate null
      - gate.ok=False → stages ran but relational checks failed;
        draft is the RAW agent output (un-normalized) so admin can see
        what to fix
      - success=True → use draft + signal_config for persistence
    """

    success: bool
    validation: PromptValidationResult
    draft: VisionDecompositionResult | None
    signal_config: DataSourceConfigDraft | None
    gate: ValidationGateDto | None
    # F8a-2: editorial overlay produced by ThesisDrafter. Null when the
    # gate failed (skipped) or the drafter raised (commit continues
    # without it; sector-service inserts no InvestmentThesis/Catalyst
    # rows in that case).
    thesis_catalysts: ThesisCatalystsDraft | None = None
    stages: list[StageMetricDto]
    total_cost_usd: float
    total_duration_ms: int


# ====================================================================
# M55 follow-up — Community Proposal Payload Drafter
#
# Light haiku agent that fills in the `proposed_payload` JSON for a
# user-filed CommunityProposal, given the kind + sector + title + body.
# The user reviews the draft and either confirms or regenerates. Each
# target_kind has its own field set — we use per-kind Pydantic models
# rather than a single dict-of-Any so Gemini's response_schema gets
# real structure to fill in.
# ====================================================================


# ---- per-kind payload schemas ----

class AddCapabilityPayload(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=20, max_length=600)
    rationale: str = Field(min_length=20, max_length=600)
    weight: float = Field(ge=0.02, le=0.5, default=0.10)
    initial_technical: int = Field(ge=0, le=100, default=50)
    initial_economic: int = Field(ge=0, le=100, default=50)
    initial_regulatory: int = Field(ge=0, le=100, default=50)
    initial_supply: int = Field(ge=0, le=100, default=50)


class AddRiskPayload(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=2, max_length=120)
    category: Literal[
        "political",
        "legal",
        "supply",
        "safety",
        "environmental",
        "financial",
        "social",
    ]
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    likelihood: Literal["low", "medium", "high"] = "medium"
    time_horizon: Literal["immediate", "1y", "3y", "5y", "10y"] = "3y"
    description: str = Field(min_length=20, max_length=600)
    affected_capability_keys: list[str] = Field(default_factory=list, max_length=10)


class AddActorPayload(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=2, max_length=160)
    iso_country: str = Field(pattern=r"^[A-Z]{2}$")
    category: Literal[
        "public_corp",
        "private_startup",
        "government_lab",
        "national_lab",
        "academic_lab",
        "standards_body",
        "ngo",
    ]
    stage: Literal["research", "pilot", "commercial", "scaling"] = "commercial"
    relevance: int = Field(ge=0, le=100, default=70)
    blurb: str = Field(min_length=20, max_length=400)
    signal_keywords: list[str] = Field(default_factory=list, max_length=12)


class AddDriverPayload(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    group: str = Field(min_length=1, max_length=40)
    unit: str = Field(min_length=1, max_length=40)
    default: float
    min: float
    max: float
    description: str = Field(min_length=20, max_length=600)


class AddEquityPayload(BaseModel):
    ticker: str = Field(min_length=1, max_length=16)
    exchange: str = Field(min_length=2, max_length=20)
    company_name: str = Field(min_length=2, max_length=120)
    iso_country: str = Field(pattern=r"^[A-Z]{2}$")
    sector_exposure_pct: int = Field(ge=0, le=100, default=50)
    rationale: str = Field(min_length=20, max_length=600)


class AddSignalSourcePayload(BaseModel):
    capability_key: str = Field(min_length=2, max_length=64)
    arxiv_keywords: list[str] = Field(default_factory=list, max_length=10)
    uspto_keywords: list[str] = Field(default_factory=list, max_length=10)
    news_keywords: list[str] = Field(default_factory=list, max_length=10)


# ---- request / response envelopes ----


# Discriminates which Pydantic schema the workflow asks the LLM to fill.
# `edit` / `other` are intentionally not in this list — those payloads are
# free-form prose; the wizard keeps the manual textarea for them.
ProposalDrafterKind = Literal[
    "add_capability",
    "add_risk",
    "add_actor",
    "add_driver",
    "add_equity",
    "add_signal_source",
]


class ProposalPayloadDraftRequest(BaseModel):
    """Inputs the drafter sees. `sector_name` is human-readable context
    (the LLM uses it to keep terminology consistent); `sector_slug` is
    the canonical id used elsewhere."""

    target_kind: ProposalDrafterKind
    sector_slug: str = Field(min_length=1, max_length=120)
    sector_name: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)


class ProposalPayloadDraftResult(BaseModel):
    """Workflow output. `payload` is the per-kind model dumped to a dict
    — it's typed `dict[str, Any]` here because the union of all six
    kind schemas isn't worth modeling as a discriminated union just to
    bounce out of the HTTP boundary. The Node side re-validates with
    the existing Zod schemas in `community-proposal.ts` before write."""

    target_kind: ProposalDrafterKind
    payload: dict[str, Any]
    cost_usd: float
    duration_ms: int
