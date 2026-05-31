"""Read-only SQLAlchemy mirror of the Prisma schema.

Prisma owns migrations (packages/db/prisma/schema.prisma). These classes
exist only so SQLAdmin can introspect tables / columns / relationships
for its UI. Never write through these classes — go through the existing
asyncpg repos (CrawlRunRepository / SignalRepository / ...) so the
Prisma-managed validation + cascade behavior stays the source of truth.

Drift risk: when Prisma schema changes, this file may need a manual
update (column add/remove/rename). The acceptance pattern is: ship the
Prisma migration, run `pnpm db:migrate dev`, then either
  - update the SQLAlchemy class for the column change, or
  - leave the column off the ModelView if it's not interesting to surface

SQLAdmin tolerates extra DB columns (just won't show them); it does NOT
tolerate a model column that doesn't exist in DB (500 on render).

Only the 14 tables surfaced in the M55 cockpit are mirrored. Add new
ones as needed — the Prisma schema has ~33 tables total but most are
either user-facing only or Phase-3 legacy.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ─── Sector (= Vision) ────────────────────────────────────────────────


class Sector(Base):
    __tablename__ = "sectors"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    vision_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_vision_eligible: Mapped[bool] = mapped_column(Boolean, default=True)
    source_module: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="live")
    agent_workflow_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    capabilities: Mapped[list["Capability"]] = relationship(back_populates="sector")
    signals: Mapped[list["Signal"]] = relationship(back_populates="sector")
    risks: Mapped[list["Risk"]] = relationship(back_populates="sector")

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"


# ─── User ─────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    locale: Mapped[str | None] = mapped_column(String, nullable=True)
    theme: Mapped[str | None] = mapped_column(String, nullable=True)
    tier: Mapped[str] = mapped_column(String, default="free")
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)
    bot_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    def __str__(self) -> str:
        return self.email


# ─── Capability ───────────────────────────────────────────────────────


class Capability(Base):
    __tablename__ = "capabilities"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    key: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    short_name: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(Integer, default=100)
    weight: Mapped[float] = mapped_column(Numeric, default=0.1)
    primary_driver_name: Mapped[str | None] = mapped_column(String, nullable=True)
    signal_keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sector: Mapped[Sector] = relationship(back_populates="capabilities")
    scores: Mapped[list["CapabilityScore"]] = relationship(back_populates="capability")

    def __str__(self) -> str:
        return f"{self.name} [{self.sector_slug}/{self.key}]"


class CapabilityScore(Base):
    __tablename__ = "capability_scores"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    capability_id: Mapped[str] = mapped_column(String, ForeignKey("capabilities.id"))
    technical: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    economic: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    regulatory: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    supply: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    composite: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    composite_p10: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    composite_p90: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    capability: Mapped[Capability] = relationship(back_populates="scores")

    def __str__(self) -> str:
        return f"score@{self.as_of:%Y-%m-%d} composite={self.composite}"


# ─── Signal ───────────────────────────────────────────────────────────


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    capability_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("capabilities.id"), nullable=True
    )
    actor_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("actors.id"), nullable=True
    )
    source_kind: Mapped[str] = mapped_column(String)
    source_url: Mapped[str] = mapped_column(String)
    source_id_ext: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delta_technical: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    delta_economic: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    delta_regulatory: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    delta_supply: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    is_highlight: Mapped[bool] = mapped_column(Boolean, default=False)
    citations: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sector: Mapped[Sector] = relationship(back_populates="signals")
    # Surfaces the joined Capability / Actor `__str__` in admin lists
    # so an operator sees "Radiation-hard compute [space-data-center/
    # rad_hard_compute]" instead of an opaque id. Lazy-loaded by
    # SQLAdmin's async session.
    capability: Mapped["Capability | None"] = relationship(
        "Capability", foreign_keys=[capability_id]
    )
    actor: Mapped["Actor | None"] = relationship(
        "Actor", foreign_keys=[actor_id]
    )

    def __str__(self) -> str:
        return self.title[:80]


# ─── Risk ─────────────────────────────────────────────────────────────


class Risk(Base):
    __tablename__ = "risks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    key: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String)
    likelihood: Mapped[str] = mapped_column(String)
    time_horizon: Mapped[str] = mapped_column(String)
    mitigations: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_capability_keys: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list
    )
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    source_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    source_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sector: Mapped[Sector] = relationship(back_populates="risks")

    def __str__(self) -> str:
        return f"[{self.severity}] {self.name}"


# ─── Actor + join tables ──────────────────────────────────────────────


class Actor(Base):
    __tablename__ = "actors"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    key: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    short_name: Mapped[str | None] = mapped_column(String, nullable=True)
    name_local: Mapped[str | None] = mapped_column(String, nullable=True)
    iso_country: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    ticker: Mapped[str | None] = mapped_column(String, nullable=True)
    exchange: Mapped[str | None] = mapped_column(String, nullable=True)
    blurb: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage: Mapped[str] = mapped_column(String)
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    signal_keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    def __str__(self) -> str:
        return f"{self.name} [{self.key}]"


class VisionActor(Base):
    __tablename__ = "vision_actors"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor_id: Mapped[str] = mapped_column(String, ForeignKey("actors.id"))
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    relevance: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Operator-facing list shows actor name + sector name alongside the
    # opaque IDs (same rationale as Signal above).
    actor: Mapped[Actor] = relationship("Actor", foreign_keys=[actor_id])
    sector: Mapped[Sector] = relationship("Sector", foreign_keys=[sector_slug])


class CapabilityActor(Base):
    __tablename__ = "capability_actors"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    capability_id: Mapped[str] = mapped_column(String, ForeignKey("capabilities.id"))
    actor_id: Mapped[str] = mapped_column(String, ForeignKey("actors.id"))
    role: Mapped[str] = mapped_column(String, default="competitor")
    stage: Mapped[str | None] = mapped_column(String, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    capability: Mapped[Capability] = relationship(
        "Capability", foreign_keys=[capability_id]
    )
    actor: Mapped[Actor] = relationship("Actor", foreign_keys=[actor_id])


# ─── Economics + Feasibility ──────────────────────────────────────────


class EconomicsDatapoint(Base):
    __tablename__ = "economics_datapoints"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    metric_key: Mapped[str] = mapped_column(String)
    value: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    unit: Mapped[str] = mapped_column(String)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source_url: Mapped[str] = mapped_column(String)
    source_kind: Mapped[str] = mapped_column(String)
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class VisionFeasibility(Base):
    __tablename__ = "vision_feasibility"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_slug: Mapped[str] = mapped_column(String, ForeignKey("sectors.slug"))
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    composite: Mapped[float] = mapped_column(Numeric)
    composite_p10: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    composite_p90: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    binding_capability_key: Mapped[str | None] = mapped_column(String, nullable=True)
    eta_median_years: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    eta_p10_years: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    eta_p90_years: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    delta_90d: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ─── CrawlRun (ARQ job status board) ──────────────────────────────────


class CrawlRun(Base):
    __tablename__ = "crawl_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    vision_slug: Mapped[str] = mapped_column(String)
    fetcher_kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")
    plan: Mapped[dict] = mapped_column(JSONB)
    result_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    signals_written: Mapped[int] = mapped_column(Integer, default=0)
    proposals_written: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __str__(self) -> str:
        return f"{self.fetcher_kind}/{self.vision_slug} {self.status}"


# ─── Community proposals ──────────────────────────────────────────────


class CommunityProposal(Base):
    __tablename__ = "community_proposals"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    author_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    sector_slug: Mapped[str] = mapped_column(String)
    target_kind: Mapped[str] = mapped_column(String)
    target_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    proposed_payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String, default="open")
    vote_score: Mapped[int] = mapped_column(Integer, default=0)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id"), nullable=True
    )
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    def __str__(self) -> str:
        return f"[{self.status}] {self.title[:60]}"


# ─── AuditLog ─────────────────────────────────────────────────────────


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    action: Mapped[str] = mapped_column(String)
    sector_slug: Mapped[str | None] = mapped_column(String, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    author_label: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ─── AgentWorkflow (Orchestrated Workflows) ───────────────────────────


class AgentWorkflow(Base):
    __tablename__ = "agent_workflows"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    input: Mapped[dict] = mapped_column(JSONB)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Numeric, default=0.0)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ─── JobConfig (Scheduler dynamic configurations) ──────────────────────


class JobConfig(Base):
    __tablename__ = "job_configs"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(String(2048))
    kind: Mapped[str] = mapped_column(String(32))
    group: Mapped[str] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(String(128), nullable=True)

    def __str__(self) -> str:
        return f"{self.key} = {self.value}"

