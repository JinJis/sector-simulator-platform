"""Offline tests for the Deep Research wrapper. The Gemini SDK is
faked end-to-end — these tests never touch the network."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from agent_tools import (
    CostMeter,
    DeepResearchClient,
    deep_research_model_for,
    deep_research_price_usd,
)


# --------------------------------------------------------------------------
# Fake SDK
# --------------------------------------------------------------------------


@dataclass
class _FakeUsage:
    prompt_token_count: int = 0
    candidates_token_count: int = 0
    thoughts_token_count: int = 0


@dataclass
class _FakeInteraction:
    id: str
    status: str
    output_text: str = ""
    error: str | None = None
    usage_metadata: _FakeUsage | None = None


@dataclass
class _FakeInteractions:
    # Queue of statuses each `get()` call should return, in order.
    # First entry simulates the response from `create()`.
    statuses: list[str] = field(default_factory=lambda: ["completed"])
    output_text: str = "TPUs are tensor processing units…"
    error: str | None = None
    usage: _FakeUsage | None = None

    # Recording of inputs.
    create_calls: list[dict[str, Any]] = field(default_factory=list)
    get_calls: list[str] = field(default_factory=list)

    _next_status_idx: int = 0

    def _take_next_status(self) -> str:
        idx = min(self._next_status_idx, len(self.statuses) - 1)
        self._next_status_idx += 1
        return self.statuses[idx]

    def create(self, **kwargs: Any) -> _FakeInteraction:
        self.create_calls.append(kwargs)
        return _FakeInteraction(
            id="int_fake_1",
            status=self._take_next_status(),
            output_text=self.output_text,
            error=self.error,
            usage_metadata=self.usage,
        )

    def get(self, id: str) -> _FakeInteraction:  # noqa: A002
        self.get_calls.append(id)
        return _FakeInteraction(
            id=id,
            status=self._take_next_status(),
            output_text=self.output_text,
            error=self.error,
            usage_metadata=self.usage,
        )


@dataclass
class _FakeClient:
    interactions: _FakeInteractions = field(default_factory=_FakeInteractions)


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------


def test_model_id_per_tier() -> None:
    assert deep_research_model_for("fast") == "deep-research-preview-04-2026"
    assert deep_research_model_for("max") == "deep-research-max-preview-04-2026"


def test_research_completed_one_shot_meters_cost() -> None:
    fake = _FakeClient(
        interactions=_FakeInteractions(
            statuses=["completed"],
            output_text="hello",
            usage=_FakeUsage(prompt_token_count=12, candidates_token_count=34),
        )
    )
    meter = CostMeter()
    client = DeepResearchClient(
        genai_client=fake,
        cost_meter=meter,
        poll_interval_seconds=0.0,
    )
    result = asyncio.run(
        client.research(
            prompt="research orbital data centers",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    assert result.status == "completed"
    assert result.cached is False
    assert result.output_text == "hello"
    assert result.tier == "fast"
    assert result.model == "deep-research-preview-04-2026"
    assert result.cost_usd == deep_research_price_usd(result.model)
    assert result.raw_usage == {
        "prompt_token_count": 12,
        "candidates_token_count": 34,
        "thoughts_token_count": 0,
    }
    # Meter recorded exactly one synthetic row.
    assert len(meter.calls) == 1
    assert meter.calls[0].cost_usd == result.cost_usd
    # `create` got the right shape; no `get` because create already returned
    # a terminal status.
    assert fake.interactions.create_calls[0]["input"] == "research orbital data centers"
    assert fake.interactions.create_calls[0]["agent"] == result.model
    assert fake.interactions.create_calls[0]["background"] is True
    assert fake.interactions.create_calls[0]["agent_config"]["collaborative_planning"] is False
    assert fake.interactions.get_calls == []


def test_research_polls_until_completed() -> None:
    fake = _FakeClient(
        interactions=_FakeInteractions(
            statuses=["running", "running", "completed"],
            output_text="done",
        )
    )
    client = DeepResearchClient(
        genai_client=fake,
        poll_interval_seconds=0.0,
    )
    result = asyncio.run(
        client.research(
            prompt="p",
            surface="hello_world",
            vision_slug="space-data-center",
        )
    )
    assert result.status == "completed"
    # 1 create (status=running) + 2 gets (running, completed).
    assert len(fake.interactions.create_calls) == 1
    assert len(fake.interactions.get_calls) == 2


def test_research_cache_hit_skips_api() -> None:
    fake = _FakeClient(interactions=_FakeInteractions(statuses=["completed"]))
    meter = CostMeter()
    client = DeepResearchClient(
        genai_client=fake,
        cost_meter=meter,
        poll_interval_seconds=0.0,
    )
    first = asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    second = asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    assert first.cached is False
    assert first.cost_usd > 0
    assert second.cached is True
    assert second.cost_usd == 0.0
    # Only one create call total.
    assert len(fake.interactions.create_calls) == 1
    # Meter records only the first.
    assert len(meter.calls) == 1


def test_research_failed_does_not_cache_and_no_cost() -> None:
    fake = _FakeClient(
        interactions=_FakeInteractions(
            statuses=["failed"],
            error="rate limited",
        )
    )
    meter = CostMeter()
    client = DeepResearchClient(
        genai_client=fake,
        cost_meter=meter,
        poll_interval_seconds=0.0,
    )
    first = asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    assert first.status == "failed"
    assert first.error == "rate limited"
    assert first.cost_usd == 0.0
    assert len(meter.calls) == 0
    # A retry should NOT be served from cache.
    fake.interactions = _FakeInteractions(statuses=["completed"], output_text="ok now")
    second = asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    assert second.status == "completed"
    assert second.cached is False
    assert second.output_text == "ok now"


def test_research_collaborative_planning_flag_propagates() -> None:
    fake = _FakeClient(interactions=_FakeInteractions(statuses=["completed"]))
    client = DeepResearchClient(
        genai_client=fake,
        poll_interval_seconds=0.0,
    )
    asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
            collaborative_planning=True,
        )
    )
    assert (
        fake.interactions.create_calls[0]["agent_config"]["collaborative_planning"]
        is True
    )


def test_research_max_tier_routes_to_max_model() -> None:
    fake = _FakeClient(interactions=_FakeInteractions(statuses=["completed"]))
    client = DeepResearchClient(
        genai_client=fake,
        poll_interval_seconds=0.0,
    )
    result = asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
            tier="max",
        )
    )
    assert result.model == "deep-research-max-preview-04-2026"
    assert (
        fake.interactions.create_calls[0]["agent"]
        == "deep-research-max-preview-04-2026"
    )


def test_research_timeout_yields_timeout_status() -> None:
    fake = _FakeClient(
        interactions=_FakeInteractions(statuses=["running"]),  # always running
    )
    client = DeepResearchClient(
        genai_client=fake,
        poll_interval_seconds=0.01,
        max_wait_seconds=0.0,  # immediate timeout
    )
    result = asyncio.run(
        client.research(
            prompt="p",
            surface="hello_world",
            vision_slug="space-data-center",
        )
    )
    assert result.status == "timeout"
    assert result.cost_usd == 0.0
    assert result.error is not None


def test_research_cache_key_distinguishes_inputs() -> None:
    fake = _FakeClient(interactions=_FakeInteractions(statuses=["completed", "completed"]))
    client = DeepResearchClient(
        genai_client=fake,
        poll_interval_seconds=0.0,
    )
    asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="space-data-center",
        )
    )
    asyncio.run(
        client.research(
            prompt="p",
            surface="capability",
            vision_slug="memory-semi",  # different vision → different cache key
        )
    )
    # Two distinct create calls — no cross-vision cache reuse.
    assert len(fake.interactions.create_calls) == 2


def test_research_requires_client() -> None:
    client = DeepResearchClient(genai_client=None)
    with pytest.raises(RuntimeError, match="no genai_client wired"):
        asyncio.run(
            client.research(
                prompt="p",
                surface="capability",
                vision_slug="space-data-center",
            )
        )
