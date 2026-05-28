"""Tests for the M41c VisionBuilderConductor + /vision-builder/build
endpoint.

This is the most-exercised orchestration path in M41: it runs all
three LLM stages (PromptValidator → Decomposition → DataSourceSelector)
and the pure-Python validation gate, returning a final draft + verdict.

The fake LLM here uses parsed_factory's request-keyword args to figure
out which stage is calling — Decomposition asks for
VisionDecompositionResult, Selector asks for DataSourceConfigDraft,
Validator asks for PromptValidationResult.
"""

from __future__ import annotations

from typing import Any

import pytest

from agent_orchestration.conductor import VisionBuilderConductor
from agent_orchestration.schemas import (
    ActorDraft,
    CapabilityActorAssignmentDraft,
    CapabilityDependencyDraft,
    CapabilityDraft,
    CapabilityKeywordSet,
    CatalystDraft,
    DataSourceConfigDraft,
    InvestmentThesisDraft,
    PromptValidationResult,
    RiskDraft,
    ThesisBulletDraft,
    ThesisCatalystsDraft,
    VisionDecompositionResult,
    VisionFeasibilityDraft,
)


# ---- builders ------------------------------------------------------------


def _valid_validation(
    *,
    is_valid: bool = True,
    suggested_slug: str = "fusion-power-grid-parity",
    suggested_capability_count: int = 4,
    suggested_actor_count: int = 8,
) -> PromptValidationResult:
    return PromptValidationResult(
        is_valid=is_valid,
        rejection_kind=None if is_valid else "off_topic",
        rejection_reason=None if is_valid else "Not a tech vision.",
        refined_question="Will commercial fusion reach grid parity by 2040?",
        suggested_name="Commercial Fusion",
        suggested_slug=suggested_slug,
        domain_label="Energy",
        scope="balanced",
        suggested_capability_count=suggested_capability_count,
        suggested_actor_count=suggested_actor_count,
        confidence=0.85,
    )


def _capability(key: str, weight: float = 0.25, display_order: int = 10) -> CapabilityDraft:
    return CapabilityDraft(
        key=key,
        name=f"Capability {key.replace('_', ' ').title()}",
        description="Description that satisfies the min length bound for capability.",
        rationale="Rationale that satisfies the min length bound for capability.",
        weight=weight,
        display_order=display_order,
        confidence=0.7,
    )


def _actor(key: str) -> ActorDraft:
    return ActorDraft(
        key=key,
        name=key.title(),
        iso_country="US",
        category="public_corp",
        blurb="ten chars min",
        stage="commercial",
        signal_keywords=["x"],
        relevance=70,
        rationale="Long enough rationale here.",
        display_order=10,
    )


def _valid_draft(slug: str = "fusion-power-grid-parity") -> VisionDecompositionResult:
    caps = [
        _capability("cap_a", weight=0.30, display_order=10),
        _capability("cap_b", weight=0.25, display_order=20),
        _capability("cap_c", weight=0.25, display_order=30),
        _capability("cap_d", weight=0.20, display_order=40),
    ]
    return VisionDecompositionResult(
        slug=slug,
        name="Commercial Fusion",
        vision_question="Will fusion reach grid parity by 2040?",
        description="Long enough description satisfying the field bound.",
        domain_label="Energy",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="cap_a", target_key="cap_b", rationale="x" * 20
            )
        ],
        risks=[
            RiskDraft(
                key=f"r{i}",
                category="legal",
                name=f"Risk {i}",
                description="Description that satisfies the field minimum bound here.",
                severity="medium",
                likelihood="medium",
                time_horizon="3y",
                display_order=10,
            )
            for i in range(2)
        ],
        actors=[_actor("alpha"), _actor("beta"), _actor("gamma")],
        capability_actors=[
            CapabilityActorAssignmentDraft(
                capability_key=k, actor_key="alpha", role="lead"
            )
            for k in ["cap_a", "cap_b", "cap_c", "cap_d"]
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=50,
            binding_capability_key="cap_a",
            rationale="Long enough rationale field for the feasibility object.",
        ),
        rationale="Long enough rationale for the decomposition itself field.",
        confidence=0.78,
    )


def _valid_signal_config() -> DataSourceConfigDraft:
    return DataSourceConfigDraft(
        keywords_by_capability=[
            CapabilityKeywordSet(capability_key=k, arxiv_keywords=["x"])
            for k in ["cap_a", "cap_b", "cap_c", "cap_d"]
        ]
    )


def _valid_thesis_catalysts() -> ThesisCatalystsDraft:
    return ThesisCatalystsDraft(
        thesis=InvestmentThesisDraft(
            the_bet="If fusion crosses LCOE parity with combined-cycle gas by 2035 the megaproject pipeline lights up.",
            bull_case=[
                ThesisBulletDraft(text="CFS / Helion are tape-out adjacent on tritium-breeder loops in 2027."),
                ThesisBulletDraft(text="Microsoft + Google have already signed 500MW PPAs anchoring the demand side."),
            ],
            bear_case=[
                ThesisBulletDraft(text="Tritium supply remains the binding upstream constraint."),
                ThesisBulletDraft(text="No reactor has demonstrated Q>2 sustained over hours."),
            ],
            conviction="medium",
        ),
        catalysts=[
            CatalystDraft(
                expected_at="2027-06-01",
                label="CFS Sparc first plasma demonstration",
                capability_key="cap_a",
                side="bull",
            ),
            CatalystDraft(
                expected_at="2028-12-01",
                label="EU regulatory framework for fusion siting",
                capability_key=None,
                side="neutral",
            ),
        ],
    )


# ---- fake-LLM factory builders ------------------------------------------


def _make_stage_factory(
    *,
    validation: PromptValidationResult,
    draft: VisionDecompositionResult,
    signal_config: DataSourceConfigDraft,
    thesis_catalysts: ThesisCatalystsDraft | None = None,
) -> Any:
    """Dispatch the parsed_factory based on which response_model the
    LLMClient is asking for. The fake stores the request in kwargs."""
    if thesis_catalysts is None:
        thesis_catalysts = _valid_thesis_catalysts()

    def factory(**kwargs: Any) -> Any:
        # The fake passes response_format / response_model info via the
        # request body — but cleanest is to look at the schema name in
        # tool definitions if present. As a robust fallback, peek at
        # the user turn content.
        contents = kwargs.get("contents") or kwargs.get("messages") or []
        text = ""
        for block in contents:
            if isinstance(block, dict):
                content_field = block.get("content") or block.get("parts")
                if isinstance(content_field, str):
                    text += " " + content_field
                elif isinstance(content_field, list):
                    for p in content_field:
                        if isinstance(p, dict):
                            text += " " + str(p.get("text", ""))
                        else:
                            text += " " + str(p)
        if "User prompt" in text or "user prompt" in text.lower():
            return validation
        if "Anchor at least one catalyst" in text or "ThesisCatalystsDraft" in text:
            return thesis_catalysts
        if "CapabilityKeywordSet" in text or "keyword sets" in text.lower():
            return signal_config
        # Default: decomposition stage.
        return draft

    return factory


# ===== Conductor =========================================================


class TestVisionBuilderConductor:
    @pytest.mark.asyncio
    async def test_full_success_pipeline(self, fake_llm, fake_anthropic) -> None:
        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(),
            draft=_valid_draft(),
            signal_config=_valid_signal_config(),
        )
        conductor = VisionBuilderConductor(llm=fake_llm)
        out = await conductor.run(prompt="Will commercial fusion reach grid parity?")
        assert out.success is True
        assert out.validation.is_valid is True
        assert out.draft is not None
        assert out.draft.slug == "fusion-power-grid-parity"
        assert out.signal_config is not None
        assert out.gate is not None and out.gate.ok is True
        assert len(out.stages) == 5
        assert [s.name for s in out.stages] == [
            "prompt_validator",
            "vision_decomposition",
            "data_source_selector",
            "validation_gate",
            "thesis_drafter",
        ]
        # Pure-Python gate stage has zero LLM cost.
        gate_stage = next(s for s in out.stages if s.name == "validation_gate")
        assert gate_stage.cost_usd == 0.0
        assert out.total_cost_usd >= 0.0
        # F8a-2: gate-passed run produces thesis + catalysts.
        assert out.thesis_catalysts is not None
        assert len(out.thesis_catalysts.catalysts) >= 2
        assert out.thesis_catalysts.thesis.conviction in {
            "high", "medium", "low", "exploratory",
        }

    @pytest.mark.asyncio
    async def test_prompt_rejected_short_circuits(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Stage 1 rejection → stages 2-4 don't run."""
        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(is_valid=False),
            draft=_valid_draft(),
            signal_config=_valid_signal_config(),
        )
        conductor = VisionBuilderConductor(llm=fake_llm)
        out = await conductor.run(prompt="What's the weather today?")
        assert out.success is False
        assert out.validation.is_valid is False
        assert out.draft is None
        assert out.signal_config is None
        assert out.gate is None
        assert len(out.stages) == 1
        assert out.stages[0].name == "prompt_validator"

    @pytest.mark.asyncio
    async def test_duplicate_slug_short_circuits(
        self, fake_llm, fake_anthropic
    ) -> None:
        """The validator's defensive duplicate guard rejects → conductor
        stops before deep-tier call."""
        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(suggested_slug="space-data-center"),
            draft=_valid_draft(),
            signal_config=_valid_signal_config(),
        )
        conductor = VisionBuilderConductor(llm=fake_llm)
        out = await conductor.run(
            prompt="orbital data centers",
            existing_vision_slugs=["space-data-center"],
        )
        assert out.success is False
        assert out.validation.is_valid is False
        assert out.validation.rejection_kind == "duplicate"
        assert out.draft is None

    @pytest.mark.asyncio
    async def test_gate_failure_returns_raw_draft(
        self, fake_llm, fake_anthropic
    ) -> None:
        """Decomposition returns a draft with a cycle → gate fails →
        conductor returns success=False but still surfaces the draft."""
        cyclic_draft = _valid_draft()
        # Inject a cycle: cap_b → cap_a (cap_a → cap_b already exists).
        cyclic_draft = cyclic_draft.model_copy(
            update={
                "dependencies": list(cyclic_draft.dependencies)
                + [
                    CapabilityDependencyDraft(
                        source_key="cap_b", target_key="cap_a", rationale="x" * 20
                    )
                ]
            }
        )
        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(),
            draft=cyclic_draft,
            signal_config=_valid_signal_config(),
        )
        conductor = VisionBuilderConductor(llm=fake_llm)
        out = await conductor.run(prompt="Will fusion work?")
        assert out.success is False
        assert out.draft is not None  # raw draft preserved for admin visibility
        assert out.gate is not None and out.gate.ok is False
        assert any("cycle" in e for e in out.gate.errors)


# ===== HTTP endpoint =====================================================


class TestVisionBuilderEndpoint:
    @pytest.mark.asyncio
    async def test_post_returns_success_envelope(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(),
            draft=_valid_draft(),
            signal_config=_valid_signal_config(),
        )
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/vision-builder/build",
                json={
                    "prompt": "Will commercial fusion reach grid parity by 2040?",
                    "existing_vision_slugs": ["space-data-center"],
                    "existing_actor_keys": ["samsung", "tsmc"],
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["success"] is True
        assert body["validation"]["is_valid"] is True
        assert body["draft"]["slug"] == "fusion-power-grid-parity"
        assert body["signal_config"] is not None
        assert body["gate"]["ok"] is True
        assert len(body["stages"]) == 5
        # F8a-2: stage 5 is the thesis drafter; envelope carries the
        # drafted bundle so sector-service.visionBuilder.commit can
        # persist it without a second HTTP hop.
        assert body["thesis_catalysts"] is not None
        assert "the_bet" in body["thesis_catalysts"]["thesis"]
        assert "total_cost_usd" in body
        assert "total_duration_ms" in body

    @pytest.mark.asyncio
    async def test_post_returns_failure_envelope_on_rejection(
        self, fake_llm, fake_anthropic
    ) -> None:
        from fastapi.testclient import TestClient

        from agent_orchestration.main import create_app
        from agent_orchestration.repo import InMemoryWorkflowRepository
        from agent_orchestration.workflows import WorkflowRunner

        fake_anthropic.models.parsed_factory = _make_stage_factory(
            validation=_valid_validation(is_valid=False),
            draft=_valid_draft(),
            signal_config=_valid_signal_config(),
        )
        app = create_app()
        app.state.llm = fake_llm
        app.state.repo = InMemoryWorkflowRepository()
        app.state.runner = WorkflowRunner(repo=app.state.repo)

        with TestClient(app) as client:
            resp = client.post(
                "/vision-builder/build",
                json={"prompt": "What's the weather tomorrow?"},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["success"] is False
        assert body["validation"]["is_valid"] is False
        assert body["draft"] is None
        assert body["gate"] is None
        assert len(body["stages"]) == 1
