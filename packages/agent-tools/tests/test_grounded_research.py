"""Tests for GroundedResearchClient — gemini + google_search grounding.

Replaces the legacy test_deep_research.py (DR Interactions API removed
in the grounded migration). Coverage:

- model id resolution per tier + env override
- happy path: completed response → cost metered + cache populated
- cache hit short-circuits the API call
- error path: SDK raises → error result, no cache, no cost
- empty response → status="empty"
- citations extracted from grounding_metadata
- usage_metadata mapped to raw_usage
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any
from unittest import mock

import pytest

from agent_tools import CostMeter
from agent_tools.grounded_research import (
    GroundedCitation,
    GroundedResearchClient,
    grounded_model_for,
)


# --------------------------------------------------------------------------
# Fakes — minimal SDK surface (.models.generate_content + response shape)
# --------------------------------------------------------------------------


@dataclass
class _FakeWeb:
    uri: str
    title: str


@dataclass
class _FakeChunk:
    web: _FakeWeb


@dataclass
class _FakeGroundingMeta:
    grounding_chunks: list[_FakeChunk] = field(default_factory=list)


@dataclass
class _FakeCandidate:
    content: Any = None
    grounding_metadata: _FakeGroundingMeta | None = None


@dataclass
class _FakeUsage:
    prompt_token_count: int = 1500
    candidates_token_count: int = 800
    total_token_count: int = 2300


@dataclass
class _FakeResponse:
    text: str = "synthesized output text"
    candidates: list[_FakeCandidate] = field(default_factory=list)
    usage_metadata: _FakeUsage | None = field(default_factory=_FakeUsage)


@dataclass
class _FakeModels:
    next: _FakeResponse = field(default_factory=_FakeResponse)
    raise_with: Exception | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)

    def generate_content(self, **kwargs: Any) -> _FakeResponse:
        self.calls.append(kwargs)
        if self.raise_with is not None:
            raise self.raise_with
        return self.next


@dataclass
class _FakeClient:
    models: _FakeModels = field(default_factory=_FakeModels)


# --------------------------------------------------------------------------
# Model resolution
# --------------------------------------------------------------------------


def test_default_fast_model() -> None:
    """Grounded research shares LLM_FAST_MODEL with the agent LLMClient;
    default falls through to llm_client._DEFAULT_MODEL_BY_TIER['fast']."""
    with mock.patch.dict(os.environ, {}, clear=False):
        for k in ("LLM_FAST_MODEL", "GROUNDED_MODEL_FAST"):
            os.environ.pop(k, None)
        assert grounded_model_for("fast") == "gemini-3.1-flash-lite"


def test_default_deep_model() -> None:
    with mock.patch.dict(os.environ, {}, clear=False):
        for k in ("LLM_DEEP_MODEL", "GROUNDED_MODEL_DEEP"):
            os.environ.pop(k, None)
        assert grounded_model_for("deep") == "gemini-3.1-pro-preview"


def test_max_is_alias_for_deep() -> None:
    """`tier='max'` is accepted as a back-compat alias for `deep` —
    same model gets picked."""
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("LLM_DEEP_MODEL", None)
        assert grounded_model_for("max") == grounded_model_for("deep")


def test_env_overrides_fast_model() -> None:
    with mock.patch.dict(os.environ, {"LLM_FAST_MODEL": "gemini-3-flash"}):
        assert grounded_model_for("fast") == "gemini-3-flash"


def test_env_overrides_deep_model() -> None:
    with mock.patch.dict(os.environ, {"LLM_DEEP_MODEL": "gemini-3-pro-ga"}):
        assert grounded_model_for("deep") == "gemini-3-pro-ga"
        assert grounded_model_for("max") == "gemini-3-pro-ga"


def test_legacy_grounded_model_env_is_ignored() -> None:
    """Pre-unification GROUNDED_MODEL_FAST / GROUNDED_MODEL_DEEP are no
    longer read — the operator's override flows through LLM_*_MODEL."""
    with mock.patch.dict(
        os.environ,
        {
            "GROUNDED_MODEL_FAST": "should-be-ignored",
            "GROUNDED_MODEL_DEEP": "should-be-ignored",
        },
    ):
        os.environ.pop("LLM_FAST_MODEL", None)
        os.environ.pop("LLM_DEEP_MODEL", None)
        assert grounded_model_for("fast") == "gemini-3.1-flash-lite"
        assert grounded_model_for("deep") == "gemini-3.1-pro-preview"


# --------------------------------------------------------------------------
# Happy path
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_research_completed_meters_cost() -> None:
    meter = CostMeter()
    client = GroundedResearchClient(
        genai_client=_FakeClient(),
        cost_meter=meter,
    )
    result = await client.research(
        prompt="What changed in fusion energy this week?",
        surface="digest",
        vision_slug="fusion-power-grid-parity",
        tier="deep",
    )

    assert result.status == "completed"
    assert result.output_text == "synthesized output text"
    assert result.cost_usd > 0.0
    assert result.cached is False
    assert result.tier == "deep"
    assert result.raw_usage["prompt_token_count"] == 1500
    assert result.raw_usage["candidates_token_count"] == 800
    # Meter recorded the call.
    assert meter.total_usd == pytest.approx(result.cost_usd)


@pytest.mark.asyncio
async def test_cache_hit_skips_api_call() -> None:
    fake = _FakeClient()
    client = GroundedResearchClient(genai_client=fake, cache_ttl_seconds=60)
    kw = dict(
        prompt="cache me",
        surface="capability",
        vision_slug="alpha",
        tier="fast",
    )
    first = await client.research(**kw)
    second = await client.research(**kw)
    assert first.cached is False
    assert second.cached is True
    assert second.cost_usd == 0.0
    # SDK was hit exactly once.
    assert len(fake.models.calls) == 1


# --------------------------------------------------------------------------
# Error + edge paths
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_error_returns_structured_result() -> None:
    meter = CostMeter()
    client = GroundedResearchClient(
        genai_client=_FakeClient(models=_FakeModels(raise_with=RuntimeError("vertex 500"))),
        cost_meter=meter,
    )
    result = await client.research(
        prompt="boom",
        surface="risk",
        vision_slug="alpha",
    )
    assert result.status == "error"
    assert result.error and "vertex 500" in result.error
    assert result.cost_usd == 0.0
    assert meter.total_usd == 0.0


@pytest.mark.asyncio
async def test_empty_response_status() -> None:
    """Model returned no text — neither error nor success."""
    client = GroundedResearchClient(
        genai_client=_FakeClient(
            models=_FakeModels(next=_FakeResponse(text=""))
        ),
    )
    result = await client.research(
        prompt="empty",
        surface="signal",
        vision_slug="alpha",
    )
    assert result.status == "empty"
    assert result.cost_usd == 0.0


# --------------------------------------------------------------------------
# Citations
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_citations_extracted_from_grounding_metadata() -> None:
    cand = _FakeCandidate(
        grounding_metadata=_FakeGroundingMeta(
            grounding_chunks=[
                _FakeChunk(_FakeWeb("https://nature.com/x", "Nature: fusion")),
                _FakeChunk(_FakeWeb("https://nrel.gov/y", "NREL bulletin")),
            ]
        )
    )
    client = GroundedResearchClient(
        genai_client=_FakeClient(
            models=_FakeModels(
                next=_FakeResponse(text="grounded", candidates=[cand])
            )
        ),
    )
    result = await client.research(
        prompt="cite stuff",
        surface="digest",
        vision_slug="fusion-power-grid-parity",
        tier="deep",
    )
    assert result.status == "completed"
    assert result.citations == (
        GroundedCitation(url="https://nature.com/x", title="Nature: fusion"),
        GroundedCitation(url="https://nrel.gov/y", title="NREL bulletin"),
    )


@pytest.mark.asyncio
async def test_missing_genai_client_raises() -> None:
    client = GroundedResearchClient(genai_client=None)
    with pytest.raises(RuntimeError, match="no genai_client wired"):
        await client.research(
            prompt="x",
            surface="capability",
            vision_slug="alpha",
        )
