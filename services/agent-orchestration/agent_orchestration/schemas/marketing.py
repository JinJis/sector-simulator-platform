"""Pydantic schemas — MarketingContent agent.

The marketing agent turns a *live vision snapshot* (binding-constraint
capability, current readiness, the most notable recent signal + its
source, lead actor) into ready-to-post bilingual (ko + en) social copy
for Threads + Instagram. Product-led: every post's CTA points to the
public vision page for a free explore.

Input is assembled by the data-pipeline ``marketing_digest`` job from
the same repository the recompute cron reads, so every number is
source-grounded — the agent is told never to invent figures.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MarketingPlatform = Literal["threads", "instagram"]

_DEFAULT_PLATFORMS: list[MarketingPlatform] = ["threads", "instagram"]


# ---- Input ---------------------------------------------------------------


class CapabilitySnapshot(BaseModel):
    """One capability's current readiness, for context in the post."""

    name: str
    composite: float | None = Field(
        default=None, ge=0, le=100, description="Current 0-100 composite readiness."
    )
    is_binding: bool = Field(
        default=False,
        description="True for the bottleneck capability gating the vision (Liebig).",
    )


class NotableSignal(BaseModel):
    """The most impactful recent signal — the 'what just moved' hook.

    Carries its source so the agent can ground the claim (and never
    fabricate one)."""

    title: str = Field(..., max_length=500)
    source_kind: str = Field(..., description="paper / patent / news / filing / ...")
    source_domain: str | None = Field(
        default=None, description="Host of source_url, e.g. arxiv.org, sec.gov."
    )
    summary: str | None = Field(default=None, max_length=2000)
    published_at: str | None = Field(
        default=None, description="ISO date (YYYY-MM-DD) of the signal."
    )
    dominant_delta: float | None = Field(
        default=None,
        ge=-10,
        le=10,
        description="Largest-magnitude per-dimension delta this signal carried.",
    )


class VisionMarketingSnapshot(BaseModel):
    """Input to the MarketingContent agent — a live read of one vision.

    Assembled from current capability scores + recent signals; the agent
    must only use the facts present here (provenance rule)."""

    vision_name: str
    vision_slug: str
    vision_url: str = Field(..., description="Public page the CTA links to.")
    # Liebig binding constraint = the vision's feasibility-gating score.
    binding_constraint_score: float | None = Field(default=None, ge=0, le=100)
    binding_capability_name: str | None = None
    # A few capabilities for context (binding one flagged via is_binding).
    capabilities: list[CapabilitySnapshot] = Field(
        default_factory=list, max_length=12
    )
    notable_signal: NotableSignal | None = None
    lead_actor_name: str | None = None
    audience: str = Field(
        default="tech-curious investors and researchers tracking the sector top-down",
        max_length=300,
    )
    platforms: list[MarketingPlatform] = Field(
        default_factory=lambda: list(_DEFAULT_PLATFORMS), max_length=2
    )
    custom_guidelines: str | None = Field(
        default=None,
        description="Custom tone, style, or example guidelines to override defaults.",
    )
    campaign_concept: str = Field(
        default="vision_bottleneck",
        description="The marketing funnel / strategy concept to guide the LLM copy generation.",
    )


# ---- Output --------------------------------------------------------------


class PostVariant(BaseModel):
    """One language's copy for one platform."""

    hook: str = Field(..., max_length=300, description="Scroll-stopping first line.")
    body: str = Field(..., max_length=1200)
    cta: str = Field(
        ..., max_length=300, description="Product-led invite linking the vision page."
    )


class MarketingPost(BaseModel):
    """One platform's post, bilingual."""

    platform: MarketingPlatform
    ko: PostVariant
    en: PostVariant
    hashtags: list[str] = Field(default_factory=list, max_length=10)


class MarketingPostSet(BaseModel):
    """Output of the MarketingContent agent — a ready-to-post batch."""

    headline_insight: str = Field(
        ..., max_length=500, description="The hook everything was built around (en)."
    )
    angle: str = Field(
        default="",
        max_length=120,
        description="Framing chosen, e.g. 'bottleneck reveal' / 'signal-just-moved'.",
    )
    posts: list[MarketingPost] = Field(default_factory=list, max_length=2)
    source_refs: list[str] = Field(
        default_factory=list,
        max_length=12,
        description="Source domains / kinds grounded on. Empty when none cited.",
    )


class MarketingContentRunResult(BaseModel):
    """HTTP envelope for /marketing-content/generate."""

    post_set: MarketingPostSet
    cost_usd: float
    duration_ms: int


__all__ = [
    "CapabilitySnapshot",
    "MarketingContentRunResult",
    "MarketingPlatform",
    "MarketingPost",
    "MarketingPostSet",
    "NotableSignal",
    "PostVariant",
    "VisionMarketingSnapshot",
]
