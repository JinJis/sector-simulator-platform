"""Pydantic request/response shapes for the data-pipeline HTTP endpoints.

Extracted from `data_pipeline.main` so route handlers stay thin and
adding a field to a request body doesn't require touching the 1900-LOC
app factory. Wire format is owned here; the route handlers in `main.py`
import these by name.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from data_pipeline.crawl_run_repo import CrawlRunRow


class SignalIngestScopeRequest(BaseModel):
    """M49c — scoped trigger body for /jobs/signal-ingest/scope.

    The crawler orchestrator picks one (vision × capability) per tick
    based on its binding × stale × cost ranking; this request lets it
    push exactly that scope into the existing M39 pipeline without
    waiting on the full-vision daily sweep.
    """

    sector_slug: str = Field(..., min_length=1, max_length=128)
    capability_keys: list[str] | None = Field(default=None, max_length=50)
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


class CrawlRunOut(BaseModel):
    id: str
    vision_slug: str
    fetcher_kind: str
    status: str
    plan: dict[str, Any]
    result_summary: dict[str, Any] | None
    cost_usd: float | None
    signals_written: int
    proposals_written: int
    error: str | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def from_row(cls, row: CrawlRunRow) -> CrawlRunOut:
        return cls(
            id=row.id,
            vision_slug=row.vision_slug,
            fetcher_kind=row.fetcher_kind,
            status=row.status,
            plan=row.plan,
            result_summary=row.result_summary,
            cost_usd=row.cost_usd,
            signals_written=row.signals_written,
            proposals_written=row.proposals_written,
            error=row.error,
            started_at=row.started_at,
            ended_at=row.ended_at,
        )


class HelloWorldTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = None


class HelloWorldTriggerOut(BaseModel):
    run: CrawlRunOut
    cached: bool


class CapabilityTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    capability_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class CapabilityTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None


class ActorTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    actor_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class ActorTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None
    matched_actor_key: str | None
    primary_capability_key: str | None


class SignalTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    capability_key: str = Field(..., min_length=1, max_length=128)
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


class SignalTriggerOut(BaseModel):
    run: CrawlRunOut
    raw_signals_fetched: int
    signals_written: int
    extractor_failures: int
    extractor_total_cost_usd: float


class RiskTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    risk_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class RiskTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None
    primary_capability_key: str | None
    risk_severity: str
    risk_likelihood: str


class OrchestratorCandidateOut(BaseModel):
    vision_slug: str
    fetcher_kind: str
    key: str
    anchor_composite: float | None
    stale_hours: float
    estimated_cost_usd: float
    ranking_score: float


class OrchestratorTickBody(BaseModel):
    pinned_visions: list[str] | None = Field(default=None, max_length=50)


class OrchestratorTickOut(BaseModel):
    dry_run: bool
    total_candidates: int
    over_budget_skipped: int
    picked: list[OrchestratorCandidateOut]
    per_vision_remaining_usd: dict[str, float]
    dispatch_summary: dict[str, Any] | None = None


class DigestRunBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class DigestRunOut(BaseModel):
    run: CrawlRunOut
    anchor_capability_key: str | None
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None


class DiscoveryRunBody(BaseModel):
    vision_slugs: list[str] | None = Field(default=None, max_length=50)
    min_signal_count: int = Field(default=2, ge=1, le=20)
    lookback_days: int = Field(default=7, ge=1, le=30)
    fuzzy_threshold: float = Field(default=0.92, ge=0.5, le=1.0)


class DiscoveryRunOut(BaseModel):
    summary: dict[str, Any]
