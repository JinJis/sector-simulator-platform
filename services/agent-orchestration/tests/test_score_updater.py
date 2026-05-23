"""Tests for the M40b CapabilityScoreUpdaterWorkflow + HTTP endpoint.

Same posture as test_signal_extractor.py — fake LLM, no network.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from agent_tools import CostMeter

from agent_orchestration.schemas import (
    CapabilityScoreUpdate,
    CapabilityScoreUpdaterRequest,
    RecentSignal,
)
from agent_orchestration.workflows import CapabilityScoreUpdaterWorkflow


def _make_request(
    *,
    sector_slug: str = "space-data-center",
    capability_key: str = "rad_hard_compute",
    current_technical: float | None = 56,
    current_economic: float | None = 30,
    current_regulatory: float | None = 48,
    current_supply: float | None = 38,
    recent_signals: list[RecentSignal] | None = None,
) -> CapabilityScoreUpdaterRequest:
    return CapabilityScoreUpdaterRequest(
        sector_slug=sector_slug,
        capability_key=capability_key,
        capability_name="Radiation-hard compute",
        capability_description="GPUs surviving LEO radiation.",
        capability_rationale="Binding constraint for orbital DCs.",
        current_technical=current_technical,
        current_economic=current_economic,
        current_regulatory=current_regulatory,
        current_supply=current_supply,
        recent_signals=recent_signals or [],
    )


def _signal(
    *,
    title: str = "Reuters: AMD postpones MI300 rad-test to Q4",
    days_ago: int = 1,
    delta_technical: float | None = -2,
    actor: str | None = "AMD",
) -> RecentSignal:
    return RecentSignal(
        title=title,
        summary="Schedule slip at NASA Pegasus.",
        source_kind="news",
        published_at=datetime.now(UTC) - timedelta(days=days_ago),
        delta_technical=delta_technical,
        actor_short_name=actor,
    )


class TestScoreUpdaterWorkflow:
    @pytest.mark.asyncio
    async def test_basic_call_returns_update(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: CapabilityScoreUpdate(
            technical=54,
            economic=None,  # null = leave unchanged
            regulatory=None,
            supply=None,
            rationale="MI300 slip — tech down 2.",
            confidence=0.85,
        )
        wf = CapabilityScoreUpdaterWorkflow(llm=fake_llm)
        out = await wf.run(_make_request(recent_signals=[_signal()]), cost_meter=CostMeter())
        assert isinstance(out, CapabilityScoreUpdate)
        assert out.technical == 54
        assert out.economic is None
        assert out.confidence == 0.85

    @pytest.mark.asyncio
    async def test_uses_sonnet_tier(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: CapabilityScoreUpdate(
            confidence=0.5
        )
        wf = CapabilityScoreUpdaterWorkflow(llm=fake_llm)
        await wf.run(_make_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        # sonnet tier = gemini-3.5-flash
        assert sent["model"] == "gemini-3.5-flash"

    @pytest.mark.asyncio
    async def test_no_signals_still_emits_update(self, fake_llm, fake_anthropic) -> None:
        """Empty signal feed is valid — agent should emit confidence-low
        null-update meaning 'no change'."""
        fake_anthropic.models.parsed_factory = lambda **_: CapabilityScoreUpdate(
            confidence=0.3, rationale="no signals — leave unchanged"
        )
        wf = CapabilityScoreUpdaterWorkflow(llm=fake_llm)
        out = await wf.run(_make_request(recent_signals=[]), cost_meter=CostMeter())
        assert out.technical is None
        assert out.confidence == 0.3

    @pytest.mark.asyncio
    async def test_user_turn_includes_signal_deltas(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: CapabilityScoreUpdate(confidence=0.6)
        wf = CapabilityScoreUpdaterWorkflow(llm=fake_llm)
        signals = [
            _signal(title="Sig A", delta_technical=-2, actor="AMD"),
            _signal(title="Sig B", delta_technical=1, actor=None),
        ]
        await wf.run(_make_request(recent_signals=signals), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "Sig A" in joined
        assert "Sig B" in joined
        assert "tech=-2" in joined
        assert "AMD" in joined


class TestScoreUpdaterValidation:
    def test_rejects_dim_above_100(self) -> None:
        with pytest.raises(ValueError):
            CapabilityScoreUpdate(technical=101, confidence=0.5)

    def test_rejects_dim_below_0(self) -> None:
        with pytest.raises(ValueError):
            CapabilityScoreUpdate(economic=-1, confidence=0.5)

    def test_all_null_dims_valid(self) -> None:
        # "no change" output is a normal outcome.
        u = CapabilityScoreUpdate(confidence=0.3)
        assert u.technical is None
        assert u.confidence == 0.3


class TestScoreUpdaterEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_update_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = lambda **_: CapabilityScoreUpdate(
            technical=54,
            confidence=0.9,
            rationale="MI300 slip.",
        )
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/capability-score-updater/score",
                json={
                    "sector_slug": "space-data-center",
                    "capability_key": "rad_hard_compute",
                    "capability_name": "Rad-hard compute",
                    "capability_description": "GPUs surviving radiation.",
                    "capability_rationale": "Binding constraint.",
                    "current_technical": 56,
                    "current_economic": 30,
                    "current_regulatory": 48,
                    "current_supply": 38,
                    "recent_signals": [
                        {
                            "title": "MI300 delay",
                            "summary": "Q4 slip",
                            "source_kind": "news",
                            "published_at": datetime.now(UTC).isoformat(),
                            "delta_technical": -2,
                            "actor_short_name": "AMD",
                        }
                    ],
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["update"]["technical"] == 54
        assert body["update"]["confidence"] == 0.9
        assert "cost_usd" in body
        assert "duration_ms" in body
