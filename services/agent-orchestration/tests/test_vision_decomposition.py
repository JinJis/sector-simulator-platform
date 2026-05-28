"""Tests for the M41b VisionDecomposition + DataSourceSelector workflows
+ their HTTP endpoints.

Same posture as the other workflow tests — fake LLM, no network.
Covers:
  - Happy path (workflow returns the parsed schema)
  - Tier verification (opus vs sonnet — the costliest is the right one)
  - Slug pinning (defensive override of agent drift)
  - Hallucinated capability key dropping (data-source-selector)
  - Schema enforcement (weight bounds, ISO country codes, enum literals,
    DAG-shape pre-validation by Pydantic)
  - HTTP envelope (cost_usd + duration_ms + parsed body)
"""

from __future__ import annotations

import pytest
from agent_tools import CostMeter
from pydantic import ValidationError

from agent_orchestration.schemas import (
    ActorDraft,
    CapabilityActorAssignmentDraft,
    CapabilityDependencyDraft,
    CapabilityDraft,
    CapabilityKeywordSet,
    DataSourceConfigDraft,
    DataSourceSelectorRequest,
    RiskDraft,
    VisionDecompositionRequest,
    VisionDecompositionResult,
    VisionFeasibilityDraft,
)
from agent_orchestration.workflows import (
    DataSourceSelectorWorkflow,
    VisionDecompositionWorkflow,
)


# ---- Builders for valid fixtures ----------------------------------------


def _capability(
    key: str = "rad_hard_compute",
    weight: float = 0.20,
    display_order: int = 10,
) -> CapabilityDraft:
    return CapabilityDraft(
        key=key,
        name=key.replace("_", " ").title(),
        description="A long-enough description that satisfies the min_length=20 rule.",
        rationale="A long-enough rationale that satisfies the min_length=20 rule.",
        weight=weight,
        display_order=display_order,
        initial_technical=55,
        initial_economic=40,
        initial_regulatory=60,
        initial_supply=45,
        confidence=0.7,
    )


def _risk(key: str = "itar_export") -> RiskDraft:
    return RiskDraft(
        key=key,
        category="legal",
        name="ITAR export controls",
        description="US export controls on dual-use rad-hard chips constrain deployment partners.",
        severity="medium",
        likelihood="high",
        time_horizon="3y",
        mitigations="License diversification + non-US suppliers.",
        affected_capability_keys=["rad_hard_compute"],
        display_order=10,
    )


def _actor(key: str = "amd") -> ActorDraft:
    return ActorDraft(
        key=key,
        name="Advanced Micro Devices",
        short_name="AMD",
        iso_country="US",
        category="public_corp",
        ticker="AMD",
        exchange="NASDAQ",
        blurb="GPU maker with growing data-center share.",
        stage="commercial",
        signal_keywords=["AMD", "MI300", "Advanced Micro Devices"],
        relevance=80,
        rationale="Primary compute IP holder for rad-hard inference candidates.",
        display_order=10,
    )


def _valid_draft(slug: str = "space-data-center") -> VisionDecompositionResult:
    """Construct a fully-valid decomposition draft."""
    caps = [
        _capability("rad_hard_compute", weight=0.30, display_order=10),
        _capability("orbital_power", weight=0.25, display_order=20),
        _capability("downlink_capacity", weight=0.25, display_order=30),
        _capability("ground_economics", weight=0.20, display_order=40),
    ]
    return VisionDecompositionResult(
        slug=slug,
        name="Orbital Data Centers",
        vision_question="When will orbital data centers become commercially viable?",
        description=(
            "Will GPU-scale compute clusters operate in LEO for AI inference,"
            " benefitting from passive cooling and continuous solar power?"
        ),
        domain_label="Space",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="orbital_power",
                target_key="rad_hard_compute",
                rationale="Compute draws kilowatts continuously.",
            ),
            CapabilityDependencyDraft(
                source_key="downlink_capacity",
                target_key="ground_economics",
                rationale="Per-bit downlink cost dominates the unit economics.",
            ),
        ],
        risks=[_risk("itar_export"), _risk("debris_liability")],
        actors=[_actor("amd"), _actor("starcloud"), _actor("nasa_jpl")],
        capability_actors=[
            CapabilityActorAssignmentDraft(
                capability_key="rad_hard_compute",
                actor_key="amd",
                role="lead",
                rationale="MI300 is the leading rad-hard candidate.",
            ),
            CapabilityActorAssignmentDraft(
                capability_key="orbital_power",
                actor_key="starcloud",
                role="lead",
            ),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=42,
            initial_p10=28,
            initial_p90=58,
            binding_capability_key="rad_hard_compute",
            eta_median_years=8,
            eta_p10_years=5,
            eta_p90_years=15,
            rationale="Rad-hard compute is the binding constraint today.",
        ),
        rationale=(
            "Decomposition is anchored on the Liebig-binding rad-hard compute"
            " capability. Power and downlink are tractable, but the cost story"
            " stays uneconomic until per-GPU radiation tolerance closes."
        ),
        confidence=0.78,
    )


def _decomposition_request(**overrides) -> VisionDecompositionRequest:
    base = dict(
        refined_question="When will orbital data centers be commercial?",
        suggested_name="Orbital Data Centers",
        suggested_slug="space-data-center",
        domain_label="Space",
        scope="balanced",
        target_capability_count=4,
        target_actor_count=8,
        existing_actor_keys=["nasa_jpl", "samsung"],
    )
    base.update(overrides)
    return VisionDecompositionRequest(**base)


# ===== VisionDecompositionWorkflow ========================================


class TestVisionDecompositionWorkflow:
    @pytest.mark.asyncio
    async def test_basic_happy_path(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft()
        wf = VisionDecompositionWorkflow(llm=fake_llm)
        out = await wf.run(_decomposition_request(), cost_meter=CostMeter())
        assert isinstance(out, VisionDecompositionResult)
        assert out.slug == "space-data-center"
        assert len(out.capabilities) == 4
        assert {d.source_key for d in out.dependencies} <= {
            c.key for c in out.capabilities
        }
        assert out.initial_feasibility.binding_capability_key in {
            c.key for c in out.capabilities
        }

    @pytest.mark.asyncio
    async def test_uses_opus_tier(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft()
        wf = VisionDecompositionWorkflow(llm=fake_llm)
        await wf.run(_decomposition_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        assert sent["model"] == "gemini-3.1-pro-preview"

    @pytest.mark.asyncio
    async def test_slug_pinning_overrides_agent_drift(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Even if the agent emits a different slug, the workflow
        force-restores the pinned one to keep FK integrity downstream."""
        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft(
            slug="some-other-slug"
        )
        wf = VisionDecompositionWorkflow(llm=fake_llm)
        out = await wf.run(
            _decomposition_request(suggested_slug="orbital-datacenters"),
            cost_meter=CostMeter(),
        )
        assert out.slug == "orbital-datacenters"

    @pytest.mark.asyncio
    async def test_user_turn_passes_sizing_targets(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft()
        wf = VisionDecompositionWorkflow(llm=fake_llm)
        await wf.run(
            _decomposition_request(
                target_capability_count=7,
                target_actor_count=14,
                research_brief="Background: rad-hard compute is the binding constraint.",
            ),
            cost_meter=CostMeter(),
        )
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "Target capability count: 7" in joined
        assert "Target actor count: 14" in joined
        assert "rad-hard compute is the binding constraint" in joined

    @pytest.mark.asyncio
    async def test_user_turn_includes_existing_actor_keys(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft()
        wf = VisionDecompositionWorkflow(llm=fake_llm)
        await wf.run(
            _decomposition_request(existing_actor_keys=["samsung", "tsmc", "nasa"]),
            cost_meter=CostMeter(),
        )
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "samsung" in joined
        assert "tsmc" in joined
        assert "Existing global actor keys" in joined


# ===== VisionDecompositionResult schema enforcement ======================


class TestDecompositionSchema:
    def test_rejects_bad_iso_country(self) -> None:
        with pytest.raises(ValidationError):
            ActorDraft(
                key="bad_actor",
                name="Bad Actor",
                iso_country="USA",  # alpha-3 — should reject
                category="public_corp",
                blurb="ten chars+",
                stage="commercial",
                signal_keywords=["x"],
                relevance=50,
                rationale="long enough",
                display_order=10,
            )

    def test_rejects_lowercase_iso_country(self) -> None:
        with pytest.raises(ValidationError):
            ActorDraft(
                key="bad_actor",
                name="Bad Actor",
                iso_country="us",
                category="public_corp",
                blurb="ten chars+",
                stage="commercial",
                signal_keywords=["x"],
                relevance=50,
                rationale="long enough",
                display_order=10,
            )

    def test_rejects_capability_weight_above_max(self) -> None:
        with pytest.raises(ValidationError):
            _capability(weight=0.6)

    def test_rejects_capability_weight_below_min(self) -> None:
        with pytest.raises(ValidationError):
            _capability(weight=0.001)

    def test_rejects_invalid_risk_category(self) -> None:
        with pytest.raises(ValidationError):
            RiskDraft(
                key="bad",
                category="made_up",  # type: ignore[arg-type]
                name="x",
                description="long enough description for the bound",
                severity="medium",
                likelihood="medium",
                time_horizon="3y",
                display_order=10,
            )

    def test_rejects_invalid_actor_role(self) -> None:
        with pytest.raises(ValidationError):
            CapabilityActorAssignmentDraft(
                capability_key="x",
                actor_key="y",
                role="invented",  # type: ignore[arg-type]
            )

    def test_rejects_actor_signal_keywords_empty(self) -> None:
        with pytest.raises(ValidationError):
            ActorDraft(
                key="x",
                name="x",
                iso_country="US",
                category="public_corp",
                blurb="ten chars+",
                stage="commercial",
                signal_keywords=[],  # min_length=1
                relevance=50,
                rationale="long enough",
                display_order=10,
            )

    def test_rejects_capability_count_below_3(self) -> None:
        with pytest.raises(ValidationError):
            VisionDecompositionResult(
                slug="s",
                name="n",
                vision_question="q",
                description="x" * 60,
                domain_label="d",
                capabilities=[_capability("a", weight=0.5)],
                risks=[_risk(), _risk("k2")],
                actors=[_actor("a"), _actor("b"), _actor("c")],
                capability_actors=[
                    CapabilityActorAssignmentDraft(
                        capability_key="a", actor_key="a", role="lead"
                    )
                ],
                initial_feasibility=VisionFeasibilityDraft(
                    initial_composite=50,
                    binding_capability_key="a",
                    rationale="long enough rationale here",
                ),
                rationale="x" * 60,
                confidence=0.5,
            )


# ===== DataSourceSelectorWorkflow ========================================


def _selector_request() -> DataSourceSelectorRequest:
    return DataSourceSelectorRequest(
        slug="space-data-center",
        domain_label="Space",
        capabilities=[
            _capability("rad_hard_compute"),
            _capability("orbital_power"),
        ],
    )


def _keyword_set(
    key: str = "rad_hard_compute",
    arxiv: list[str] | None = None,
) -> CapabilityKeywordSet:
    return CapabilityKeywordSet(
        capability_key=key,
        arxiv_keywords=arxiv or ["radiation hardened processor"],
        uspto_keywords=["rad-hard semiconductor"],
        news_keywords=["rad-hard chip"],
    )


class TestDataSourceSelectorWorkflow:
    @pytest.mark.asyncio
    async def test_basic_happy_path(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[
                _keyword_set("rad_hard_compute"),
                _keyword_set("orbital_power", arxiv=["space solar"]),
            ],
            rationale="One keyword set per capability.",
        )
        wf = DataSourceSelectorWorkflow(llm=fake_llm)
        out = await wf.run(_selector_request(), cost_meter=CostMeter())
        assert isinstance(out, DataSourceConfigDraft)
        assert len(out.keywords_by_capability) == 2
        keys = {kws.capability_key for kws in out.keywords_by_capability}
        assert keys == {"rad_hard_compute", "orbital_power"}

    @pytest.mark.asyncio
    async def test_uses_sonnet_tier(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[_keyword_set("rad_hard_compute")]
        )
        wf = DataSourceSelectorWorkflow(llm=fake_llm)
        await wf.run(_selector_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        assert sent["model"] == "gemini-3.5-flash"

    @pytest.mark.asyncio
    async def test_drops_hallucinated_capability_keys(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Agent may emit keyword sets for capabilities that don't exist
        in the input. The workflow drops them before returning."""
        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[
                _keyword_set("rad_hard_compute"),
                _keyword_set("orbital_power"),
                _keyword_set("invented_capability"),  # not in input
            ]
        )
        wf = DataSourceSelectorWorkflow(llm=fake_llm)
        out = await wf.run(_selector_request(), cost_meter=CostMeter())
        keys = {kws.capability_key for kws in out.keywords_by_capability}
        assert keys == {"rad_hard_compute", "orbital_power"}
        assert "invented_capability" not in keys

    @pytest.mark.asyncio
    async def test_raises_when_all_sets_hallucinated(
        self, fake_llm, fake_anthropic
    ) -> None:
        """If EVERY keyword set is for a hallucinated capability, we'd
        end up persisting nothing — that's a hard failure."""
        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[
                _keyword_set("ghost_one"),
                _keyword_set("ghost_two"),
            ]
        )
        wf = DataSourceSelectorWorkflow(llm=fake_llm)
        with pytest.raises(RuntimeError, match="zero keyword sets"):
            await wf.run(_selector_request(), cost_meter=CostMeter())

    @pytest.mark.asyncio
    async def test_user_turn_lists_capabilities(
        self, fake_llm, fake_anthropic
    ) -> None:
        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[
                _keyword_set("rad_hard_compute"),
                _keyword_set("orbital_power"),
            ]
        )
        wf = DataSourceSelectorWorkflow(llm=fake_llm)
        await wf.run(_selector_request(), cost_meter=CostMeter())
        sent = fake_anthropic.models.requests[-1]
        joined = repr(sent.get("contents") or sent.get("messages"))
        assert "rad_hard_compute" in joined
        assert "orbital_power" in joined


# ===== CapabilityKeywordSet schema enforcement ===========================


class TestKeywordSetSchema:
    def test_arxiv_keywords_required_non_empty(self) -> None:
        with pytest.raises(ValidationError):
            CapabilityKeywordSet(
                capability_key="x",
                arxiv_keywords=[],
                uspto_keywords=["x"],
                news_keywords=["x"],
            )

    def test_arxiv_keywords_max_length(self) -> None:
        with pytest.raises(ValidationError):
            CapabilityKeywordSet(
                capability_key="x",
                arxiv_keywords=["x"] * 21,
            )

    def test_uspto_and_news_can_be_empty(self) -> None:
        # Some capabilities don't have patent / news flow.
        kws = CapabilityKeywordSet(
            capability_key="x",
            arxiv_keywords=["x"],
        )
        assert kws.uspto_keywords == []
        assert kws.news_keywords == []


# ===== HTTP endpoints ====================================================


class TestVisionDecompositionEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_draft_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = lambda **_: _valid_draft()
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/vision-builder/decompose",
                json={
                    "refined_question": "When will orbital DCs be commercial?",
                    "suggested_name": "Orbital Data Centers",
                    "suggested_slug": "space-data-center",
                    "domain_label": "Space",
                    "scope": "balanced",
                    "target_capability_count": 4,
                    "target_actor_count": 8,
                    "existing_actor_keys": ["samsung", "tsmc"],
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["draft"]["slug"] == "space-data-center"
        assert len(body["draft"]["capabilities"]) == 4
        assert "cost_usd" in body
        assert body["cost_usd"] >= 0.0
        assert "duration_ms" in body


class TestDataSourceSelectorEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_config_with_cost(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = lambda **_: DataSourceConfigDraft(
            keywords_by_capability=[
                _keyword_set("rad_hard_compute"),
                _keyword_set("orbital_power"),
            ],
        )
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        cap_payload = [
            {
                "key": "rad_hard_compute",
                "name": "Rad-hard compute",
                "description": "A long-enough description that satisfies the bound.",
                "rationale": "A long-enough rationale that satisfies the bound.",
                "weight": 0.30,
                "display_order": 10,
                "initial_technical": 55,
                "initial_economic": 40,
                "initial_regulatory": 60,
                "initial_supply": 45,
                "confidence": 0.7,
            },
            {
                "key": "orbital_power",
                "name": "Orbital power",
                "description": "A long-enough description that satisfies the bound.",
                "rationale": "A long-enough rationale that satisfies the bound.",
                "weight": 0.25,
                "display_order": 20,
                "confidence": 0.7,
            },
        ]
        with TestClient(app) as client:
            resp = client.post(
                "/vision-builder/select-data-sources",
                json={
                    "slug": "space-data-center",
                    "domain_label": "Space",
                    "capabilities": cap_payload,
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["config"]["keywords_by_capability"]) == 2
        keys = {
            kws["capability_key"] for kws in body["config"]["keywords_by_capability"]
        }
        assert keys == {"rad_hard_compute", "orbital_power"}
        assert "cost_usd" in body
        assert "duration_ms" in body
