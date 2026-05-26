"""HTTP clients for the agent-orchestration service.

Crawler fetchers don't reason — they fetch + delegate scoring to the
existing agents (SignalExtractor, ScoreUpdater) over HTTP. Keeping the
agent surface inside `agent-orchestration` means M39's prompt
versioning + cost-meter rollup stays the single source of truth.

This module is a typed thin wrapper around the relevant endpoints.
The request/response shapes are duplicated here (instead of imported
from `agent-orchestration`) because crawler shouldn't take a workspace
dep on a sibling service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, Field


# --------------------------------------------------------------------------
# SignalExtractor — mirrors agent_orchestration.schemas
# --------------------------------------------------------------------------


class ActorKeywordSet(BaseModel):
    actor_key: str
    aliases: list[str] = Field(default_factory=list)


class SignalExtractorRequest(BaseModel):
    sector_slug: str
    capability_key: str
    capability_name: str
    capability_description: str
    capability_rationale: str
    signal_title: str
    signal_summary: str | None = None
    source_kind: str
    actor_keywords: list[ActorKeywordSet] = Field(default_factory=list)


class SignalScoring(BaseModel):
    delta_technical: float | None = None
    delta_economic: float | None = None
    delta_regulatory: float | None = None
    delta_supply: float | None = None
    confidence: float
    is_highlight: bool = False
    matched_actor_key: str | None = None
    rationale: str = ""


class SignalExtractorRunResult(BaseModel):
    scoring: SignalScoring
    cost_usd: float
    duration_ms: int


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


def default_agent_orchestration_url() -> str | None:
    base = os.environ.get("AGENT_ORCHESTRATION_URL", "").strip()
    return base or None


class AgentClient(Protocol):
    async def score_signal(
        self, req: SignalExtractorRequest
    ) -> SignalExtractorRunResult: ...


@dataclass
class HttpAgentClient:
    """Production client. Tests inject a fake `AgentClient`."""

    base_url: str
    timeout_seconds: float = 30.0

    async def score_signal(
        self, req: SignalExtractorRequest
    ) -> SignalExtractorRunResult:
        url = f"{self.base_url.rstrip('/')}/signal-extractor/score"
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            resp = await client.post(url, json=req.model_dump(mode="json"))
            resp.raise_for_status()
            payload: Any = resp.json()
        return SignalExtractorRunResult.model_validate(payload)
