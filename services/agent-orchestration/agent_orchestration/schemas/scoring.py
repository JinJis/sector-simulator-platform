"""Pydantic schemas — scoring + extraction (SignalExtractor, CapabilityScoreUpdater).

Extracted from the monolithic ``schemas.py`` in slice 7. Imports the
union of Pydantic + stdlib helpers; ruff --fix --select F401 strips
per-file orphans after extraction.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


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
    # to tag a single best actor. Keep ≤25 to fit in fast-tier context.
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
# M40b — CapabilityScoreUpdater (balanced tier)
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
#   1. PromptValidator (fast)        — sanity-check user prompt
#   2. VisionResearch (balanced)        — context gathering (existing
#                                       ResearchWorkflow reused)
#   3. VisionDecomposition (deep)     — full vision draft
#   4. DataSourceSelector (balanced)    — per-capability keyword sets
#   5. ValidationGate (pure Python)   — DAG + uniqueness + FK checks
#   6. Conductor → admin → persist    — atomic create
#
# Every LLM stage outputs a Pydantic schema. Each schema enforces
# bounds (0-100 for scores, ≤enum values for categories) so the
# downstream validation gate has less to do.
# =====================================================================


# ---- Stage 1: Prompt validation ----------------------------------------
