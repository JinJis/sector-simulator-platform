"""Tests for the M39b SignalExtractor workflow + HTTP endpoint.

Uses the shared FakeGenAI fixture — no network. Verifies:
  - Workflow shapes the user turn correctly (capability context +
    signal + actor keyword sets all reach the prompt)
  - Pydantic schema enforces -10..+10 bounds + 0..1 confidence
  - Hallucinated actor_key (not in the request's keyword set) is
    silently dropped to None
  - HTTP endpoint returns SignalExtractorRunResult with cost roll-up
"""

from __future__ import annotations

from typing import Any

import pytest
from agent_tools import CostMeter

from agent_orchestration.schemas import (
    ActorKeywordSet,
    SignalExtractorRequest,
    SignalScoring,
)
from agent_orchestration.workflows import SignalExtractorWorkflow


def _make_request(
    *,
    sector_slug: str = "space-data-center",
    capability_key: str = "rad_hard_compute",
    signal_title: str = "Reuters: AMD postpones MI300 radiation campaign to Q4",
    signal_summary: str | None = "AMD's rad-qual program at NASA Pegasus slips one quarter.",
    actor_keywords: list[ActorKeywordSet] | None = None,
) -> SignalExtractorRequest:
    return SignalExtractorRequest(
        sector_slug=sector_slug,
        capability_key=capability_key,
        capability_name="Radiation-hard compute",
        capability_description="GPUs that survive LEO radiation.",
        capability_rationale="Binding constraint for orbital DCs.",
        signal_title=signal_title,
        signal_summary=signal_summary,
        source_kind="news",
        actor_keywords=actor_keywords or [],
    )


# ----- Workflow direct ----------------------------------------------------

class TestSignalExtractorWorkflowDirect:
    @pytest.mark.asyncio
    async def test_basic_call_returns_scoring(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(
            delta_technical=-2,
            delta_economic=None,
            delta_regulatory=None,
            delta_supply=-1,
            confidence=0.85,
            is_highlight=False,
            matched_actor_key=None,
            rationale="MI300 schedule slip — moderate negative on rad-qual.",
        )
        wf = SignalExtractorWorkflow(llm=fake_llm)
        result = await wf.run(_make_request(), cost_meter=CostMeter())
        assert isinstance(result, SignalScoring)
        assert result.delta_technical == -2
        assert result.delta_supply == -1
        assert result.confidence == 0.85

    @pytest.mark.asyncio
    async def test_uses_haiku_tier(self, fake_llm, fake_anthropic) -> None:
        """SignalExtractor must call the haiku tier
        (gemini-3.5-flash-lite). The fake shares the requests list
        across both provider faces so we assert on the recorded
        model id."""
        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(
            confidence=0.5, delta_technical=0
        )
        wf = SignalExtractorWorkflow(llm=fake_llm)
        await wf.run(_make_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        assert sent["model"] == "gemini-3.5-flash-lite"

    @pytest.mark.asyncio
    async def test_drops_hallucinated_actor_key(self, fake_llm, fake_anthropic) -> None:
        """Defensive: extractor sometimes invents actor keys. When the
        returned key isn't in the request's keyword set, drop it."""
        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(
            delta_technical=-2,
            confidence=0.9,
            matched_actor_key="ghost_actor",  # not in actor_keywords below
        )
        wf = SignalExtractorWorkflow(llm=fake_llm)
        req = _make_request(
            actor_keywords=[
                ActorKeywordSet(actor_key="amd", aliases=["AMD", "MI300"]),
            ],
        )
        result = await wf.run(req, cost_meter=CostMeter())
        assert result.matched_actor_key is None

    @pytest.mark.asyncio
    async def test_keeps_valid_actor_key(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(
            delta_technical=-2,
            confidence=0.92,
            matched_actor_key="amd",
        )
        wf = SignalExtractorWorkflow(llm=fake_llm)
        req = _make_request(
            actor_keywords=[
                ActorKeywordSet(actor_key="amd", aliases=["AMD", "MI300"]),
                ActorKeywordSet(actor_key="nvidia", aliases=["NVIDIA"]),
            ],
        )
        result = await wf.run(req, cost_meter=CostMeter())
        assert result.matched_actor_key == "amd"

    @pytest.mark.asyncio
    async def test_user_turn_includes_capability_and_actor_context(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Prompt assembly puts capability + signal + actor keyword set
        all into the user turn. Verify by inspecting the last request."""
        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(confidence=0.6)
        wf = SignalExtractorWorkflow(llm=fake_llm)
        req = _make_request(
            actor_keywords=[
                ActorKeywordSet(actor_key="amd", aliases=["AMD", "MI300"]),
            ],
        )
        await wf.run(req, cost_meter=CostMeter())
        sent: dict[str, Any] = fake_anthropic.models.requests[-1]
        # Gemini-side request has `contents` not `messages`.
        contents = sent.get("contents") or sent.get("messages")
        # The fake compat normalizes everything; user turn ends up as a
        # plain string in some shape. Just join all the strings we can
        # find and grep.
        joined = repr(contents)
        assert "Radiation-hard compute" in joined
        assert "AMD" in joined
        assert "MI300" in joined
        assert "Reuters" in joined


# ----- Schema enforcement -------------------------------------------------

class TestSignalScoringValidation:
    def test_rejects_delta_above_10(self) -> None:
        with pytest.raises(ValueError):
            SignalScoring(delta_technical=11, confidence=0.8)

    def test_rejects_delta_below_neg10(self) -> None:
        with pytest.raises(ValueError):
            SignalScoring(delta_economic=-11, confidence=0.8)

    def test_rejects_confidence_above_1(self) -> None:
        with pytest.raises(ValueError):
            SignalScoring(confidence=1.1)

    def test_rejects_confidence_below_0(self) -> None:
        with pytest.raises(ValueError):
            SignalScoring(confidence=-0.1)

    def test_all_dims_null_is_valid(self) -> None:
        s = SignalScoring(confidence=0.4)
        assert s.delta_technical is None
        assert s.delta_economic is None


# ----- HTTP endpoint ------------------------------------------------------

class TestSignalExtractorEndpoint:
    @pytest.mark.asyncio
    async def test_post_score_returns_result_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        """End-to-end test against the FastAPI ASGI app."""
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = lambda **_: SignalScoring(
            delta_technical=-2,
            confidence=0.9,
            matched_actor_key=None,
            rationale="test",
        )
        app = create_app()
        # Pre-set state for lifespan to pick up.
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/signal-extractor/score",
                json={
                    "sector_slug": "space-data-center",
                    "capability_key": "rad_hard_compute",
                    "capability_name": "Rad-hard compute",
                    "capability_description": "GPUs that survive LEO radiation.",
                    "capability_rationale": "Binding constraint.",
                    "signal_title": "AMD postpones MI300 rad-test",
                    "signal_summary": "Q4 slip",
                    "source_kind": "news",
                    "actor_keywords": [],
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["scoring"]["delta_technical"] == -2
        assert body["scoring"]["confidence"] == 0.9
        assert "cost_usd" in body
        assert body["cost_usd"] >= 0.0
        assert "duration_ms" in body
