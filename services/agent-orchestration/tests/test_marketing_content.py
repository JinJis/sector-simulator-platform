"""Tests for the MarketingContentWorkflow + HTTP endpoint.

Same posture as test_score_updater.py — fake LLM, no network.
"""

from __future__ import annotations

import pytest
from agent_orchestration.schemas import (
    CapabilitySnapshot,
    MarketingPost,
    MarketingPostSet,
    NotableSignal,
    PostVariant,
    VisionMarketingSnapshot,
)
from agent_orchestration.workflows import MarketingContentWorkflow
from agent_tools import CostMeter


def _post_set() -> MarketingPostSet:
    variant = PostVariant(
        hook="Hook line", body="Body insight.", cta="Explore it free →"
    )
    return MarketingPostSet(
        headline_insight="Rad-hard compute is the bottleneck for orbital DCs.",
        angle="bottleneck reveal",
        posts=[
            MarketingPost(
                platform="threads",
                ko=variant,
                en=variant,
                hashtags=["#deeptech", "#우주데이터센터"],
            ),
            MarketingPost(
                platform="instagram",
                ko=variant,
                en=variant,
                hashtags=["#fusion", "#techinvesting"],
            ),
        ],
        source_refs=["arxiv.org"],
    )


def _make_request(
    *,
    notable_signal: NotableSignal | None = None,
    binding_constraint_score: float | None = 41.0,
) -> VisionMarketingSnapshot:
    return VisionMarketingSnapshot(
        vision_name="Space Data Center",
        vision_slug="space-data-center",
        vision_url="http://localhost:3000/visions/space-data-center",
        binding_constraint_score=binding_constraint_score,
        binding_capability_name="Radiation-hard compute",
        capabilities=[
            CapabilitySnapshot(
                name="Radiation-hard compute", composite=41.0, is_binding=True
            ),
            CapabilitySnapshot(name="Launch cost", composite=72.0),
        ],
        notable_signal=notable_signal,
        lead_actor_name="AMD",
    )


class TestMarketingContentWorkflow:
    @pytest.mark.asyncio
    async def test_basic_call_returns_post_set(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _post_set()
        wf = MarketingContentWorkflow(llm=fake_llm)
        out = await wf.run(_make_request(), cost_meter=CostMeter())
        assert isinstance(out, MarketingPostSet)
        assert len(out.posts) == 2
        assert {p.platform for p in out.posts} == {"threads", "instagram"}
        # bilingual parity — every post has both ko and en.
        assert all(p.ko and p.en for p in out.posts)

    @pytest.mark.asyncio
    async def test_uses_balanced_tier(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _post_set()
        wf = MarketingContentWorkflow(llm=fake_llm)
        await wf.run(_make_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        # balanced tier = gemini-3.5-flash
        assert sent["model"] == "gemini-3.5-flash"

    @pytest.mark.asyncio
    async def test_user_turn_includes_snapshot_facts(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _post_set()
        wf = MarketingContentWorkflow(llm=fake_llm)
        sig = NotableSignal(
            title="AMD MI300 passes rad-test",
            source_kind="news",
            source_domain="reuters.com",
            summary="Milestone at NASA Pegasus.",
            published_at="2026-05-30",
            dominant_delta=4,
        )
        await wf.run(_make_request(notable_signal=sig), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        # binding constraint + CTA url + notable signal + actor all present.
        assert "Radiation-hard compute" in joined
        assert "space-data-center" in joined
        assert "AMD MI300 passes rad-test" in joined
        assert "reuters.com" in joined
        assert "AMD" in joined

    @pytest.mark.asyncio
    async def test_no_signal_does_not_fabricate(
        self, fake_llm, fake_anthropic
    ) -> None:
        """With no notable signal the prompt must explicitly tell the
        agent not to invent one."""
        fake_anthropic.models.parsed_factory = lambda **_: _post_set()
        wf = MarketingContentWorkflow(llm=fake_llm)
        await wf.run(_make_request(notable_signal=None), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "do not invent" in joined.lower()


class TestMarketingContentValidation:
    def test_rejects_more_than_two_posts(self) -> None:
        v = PostVariant(hook="h", body="b", cta="c")
        post = MarketingPost(platform="threads", ko=v, en=v)
        with pytest.raises(ValueError):
            MarketingPostSet(headline_insight="x", posts=[post, post, post])

    def test_score_out_of_range_rejected(self) -> None:
        with pytest.raises(ValueError):
            CapabilitySnapshot(name="x", composite=101)


class TestMarketingContentEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_post_set_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner
        from fastapi.testclient import TestClient

        fake_anthropic.models.parsed_factory = lambda **_: _post_set()
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/marketing-content/generate",
                json={
                    "vision_name": "Space Data Center",
                    "vision_slug": "space-data-center",
                    "vision_url": "http://localhost:3000/visions/space-data-center",
                    "binding_constraint_score": 41.0,
                    "binding_capability_name": "Radiation-hard compute",
                    "capabilities": [
                        {
                            "name": "Radiation-hard compute",
                            "composite": 41.0,
                            "is_binding": True,
                        }
                    ],
                    "notable_signal": {
                        "title": "AMD MI300 passes rad-test",
                        "source_kind": "news",
                        "source_domain": "reuters.com",
                        "dominant_delta": 4,
                    },
                    "lead_actor_name": "AMD",
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["post_set"]["posts"]) == 2
        assert "cost_usd" in body
        assert "duration_ms" in body
