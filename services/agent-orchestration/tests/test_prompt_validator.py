"""Tests for the M41 PromptValidatorWorkflow + HTTP endpoint.

Same posture as the other workflow tests — fake LLM, no network.
Verifies:
  - Basic accept / reject paths
  - Duplicate detection is forced server-side when agent misses it
  - Schema enforcement (slug regex, capability/actor count bounds)
  - HTTP endpoint returns cost + duration
"""

from __future__ import annotations

import pytest
from agent_tools import CostMeter
from pydantic import ValidationError

from agent_orchestration.schemas import (
    PromptValidationResult,
    VisionBuilderPromptRequest,
)
from agent_orchestration.workflows import PromptValidatorWorkflow


def _valid_result(**overrides) -> PromptValidationResult:
    """Construct a valid PromptValidationResult with sane defaults so
    tests can override one field at a time."""
    base = dict(
        is_valid=True,
        rejection_kind=None,
        rejection_reason=None,
        refined_question="Will commercial fusion reach grid parity by 2040?",
        suggested_name="Commercial Fusion",
        suggested_slug="fusion-power-grid-parity",
        domain_label="Energy",
        scope="balanced",
        suggested_capability_count=8,
        suggested_actor_count=12,
        review_notes=[],
        confidence=0.85,
    )
    base.update(overrides)
    return PromptValidationResult(**base)


# ----- Workflow direct ----------------------------------------------------


class TestPromptValidatorWorkflow:
    @pytest.mark.asyncio
    async def test_basic_accept(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_result()
        wf = PromptValidatorWorkflow(llm=fake_llm)
        out = await wf.run(
            VisionBuilderPromptRequest(
                prompt="Will commercial fusion reach grid parity by 2040?"
            ),
            cost_meter=CostMeter(),
        )
        assert out.is_valid is True
        assert out.suggested_slug == "fusion-power-grid-parity"
        assert out.scope == "balanced"
        assert out.suggested_capability_count == 8

    @pytest.mark.asyncio
    async def test_off_topic_rejection(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_result(
            is_valid=False,
            rejection_kind="off_topic",
            rejection_reason="Not a technology vision.",
            confidence=0.95,
        )
        wf = PromptValidatorWorkflow(llm=fake_llm)
        out = await wf.run(
            VisionBuilderPromptRequest(prompt="What's the weather tomorrow?"),
            cost_meter=CostMeter(),
        )
        assert out.is_valid is False
        assert out.rejection_kind == "off_topic"
        # Even on rejection, refined_question + suggested_* still come back.
        assert out.refined_question
        assert out.suggested_slug

    @pytest.mark.asyncio
    async def test_uses_haiku_tier(self, fake_llm, fake_anthropic) -> None:
        """Calls the fast tier (gemini-3.1-flash-lite). Test name
        preserved for `pytest -k` continuity through the F9b rename."""
        fake_anthropic.models.parsed_factory = lambda **_: _valid_result()
        wf = PromptValidatorWorkflow(llm=fake_llm)
        await wf.run(
            VisionBuilderPromptRequest(prompt="Will fusion reach grid parity by 2040?"),
            cost_meter=CostMeter(),
        )
        sent = fake_anthropic.models.requests[-1]
        assert sent["model"] == "gemini-3.1-flash-lite"

    @pytest.mark.asyncio
    async def test_user_turn_includes_existing_slugs(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_result()
        wf = PromptValidatorWorkflow(llm=fake_llm)
        await wf.run(
            VisionBuilderPromptRequest(
                prompt="Will fusion reach grid parity by 2040?",
                existing_vision_slugs=["space-data-center", "memory-semi", "sofc"],
            ),
            cost_meter=CostMeter(),
        )
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "space-data-center" in joined
        assert "memory-semi" in joined

    @pytest.mark.asyncio
    async def test_force_duplicate_rejection_when_agent_misses(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Defensive guard — even if the agent returns is_valid=True for
        an existing slug, the workflow forces a duplicate rejection."""
        fake_anthropic.models.parsed_factory = lambda **_: _valid_result(
            is_valid=True, suggested_slug="space-data-center"
        )
        wf = PromptValidatorWorkflow(llm=fake_llm)
        out = await wf.run(
            VisionBuilderPromptRequest(
                prompt="Orbital data centers — when?",
                existing_vision_slugs=["space-data-center"],
            ),
            cost_meter=CostMeter(),
        )
        assert out.is_valid is False
        assert out.rejection_kind == "duplicate"
        assert "space-data-center" in (out.rejection_reason or "")


# ----- Schema enforcement -------------------------------------------------


class TestPromptValidationResultValidation:
    def test_rejects_bad_slug(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(suggested_slug="Bad_Slug")  # underscore + caps

    def test_rejects_capability_count_below_3(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(suggested_capability_count=2)

    def test_rejects_capability_count_above_15(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(suggested_capability_count=20)

    def test_rejects_actor_count_above_30(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(suggested_actor_count=50)

    def test_rejects_confidence_out_of_range(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(confidence=1.5)

    def test_rejects_invalid_scope(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(scope="ridiculous")  # type: ignore[arg-type]

    def test_rejects_invalid_rejection_kind(self) -> None:
        with pytest.raises(ValidationError):
            _valid_result(rejection_kind="made_up_reason")  # type: ignore[arg-type]


class TestVisionBuilderPromptRequestValidation:
    def test_prompt_min_length_enforced(self) -> None:
        with pytest.raises(ValidationError):
            VisionBuilderPromptRequest(prompt="too short")

    def test_prompt_max_length_enforced(self) -> None:
        with pytest.raises(ValidationError):
            VisionBuilderPromptRequest(prompt="X" * 5000)


# ----- HTTP endpoint ------------------------------------------------------


class TestPromptValidatorEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_validation_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = lambda **_: _valid_result(
            suggested_slug="bci-mass-market",
            suggested_name="Brain-Computer Interface",
            scope="broad",
            suggested_capability_count=12,
            suggested_actor_count=20,
        )
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/vision-builder/validate-prompt",
                json={
                    "prompt": "By when will BCI implants reach mass market?",
                    "existing_vision_slugs": ["space-data-center"],
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["validation"]["is_valid"] is True
        assert body["validation"]["suggested_slug"] == "bci-mass-market"
        assert "cost_usd" in body
        assert body["cost_usd"] >= 0.0
        assert "duration_ms" in body
