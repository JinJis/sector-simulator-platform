"""Pydantic schemas — Vision Builder conductor steps + commit payload drafts.

Extracted from the monolithic ``schemas.py`` in slice 7. Imports the
union of Pydantic + stdlib helpers; ruff --fix --select F401 strips
per-file orphans after extraction.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class VisionBuilderPromptRequest(BaseModel):
    """Raw user prompt + optional context. The validator does the
    sanity check before any expensive deep-tier call burns budget."""

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


# ---- Stage 3: Vision decomposition (deep tier — biggest call) ----------

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


# ---- Stage 5 (F8a-2): Investment thesis + catalysts drafter (balanced) ---
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

    # `expected_at` was previously declared with `pattern=r"^\d{4}-\d{2}
    # -\d{2}$"`. Vertex/Gemini compiles every response_schema regex into
    # the FST constraint for structured output, and that one pattern by
    # itself adds several hundred FST states — combined with the rest
    # of the ThesisCatalystsDraft schema it routinely blew past Gemini's
    # 5888-state hard cap and the call failed with "Constraint is too
    # tall" at prefill. Validate the format via a field_validator
    # instead; runs client-side, costs zero FST states.
    expected_at: str = Field(
        ..., description="ISO date (YYYY-MM-DD) the event is projected for",
    )
    label: str = Field(..., min_length=5, max_length=200)
    capability_key: str | None = Field(default=None, max_length=64)
    side: Literal["bull", "bear", "neutral"]
    note: str | None = Field(default=None, max_length=400)
    source_url: str | None = Field(default=None, max_length=500)

    @field_validator("expected_at")
    @classmethod
    def _check_iso_date(cls, v: str) -> str:
        # The model frequently emits ISO datetimes ("2027-06-01T00:00:00Z")
        # or month-only strings. Be permissive: accept anything starting
        # with YYYY-MM-DD and trim the rest.
        head = v[:10]
        try:
            date.fromisoformat(head)
        except ValueError as exc:
            raise ValueError(
                f"expected_at must start with ISO date YYYY-MM-DD; got {v!r}"
            ) from exc
        return head

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


# ---- Stage 4: Data source selector (balanced) ----------------------------

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
    """One row in the per-stage cost / latency table. ``output_summary``
    is a short one-line description of what the stage produced — used
    by the admin real-time progress panel + the post-completion review
    timeline ("validator accepted prompt", "12 capabilities · 8 risks
    · 15 actors", "gate passed: 14 capabilities normalized"). Optional
    so legacy callers still parse."""

    name: str
    cost_usd: float
    duration_ms: int
    output_summary: str | None = None

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
# Light fast-tier agent that fills in the `proposed_payload` JSON for a
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
