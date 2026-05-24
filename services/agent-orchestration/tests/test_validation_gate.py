"""Tests for the M41c ValidationGate — pure-Python relational checks
on a VisionDecompositionResult + DataSourceConfigDraft.

No LLM, no network; this is the cheapest and most-run code path in the
M41 pipeline, so it needs strong coverage."""

from __future__ import annotations

import pytest

from agent_orchestration.schemas import (
    ActorDraft,
    CapabilityActorAssignmentDraft,
    CapabilityDependencyDraft,
    CapabilityDraft,
    CapabilityKeywordSet,
    DataSourceConfigDraft,
    RiskDraft,
    VisionDecompositionResult,
    VisionFeasibilityDraft,
)
from agent_orchestration.validation_gate import run_validation_gate


# ---- builders ----------------------------------------------------------


def _cap(
    key: str,
    *,
    weight: float = 0.25,
    display_order: int = 10,
) -> CapabilityDraft:
    return CapabilityDraft(
        key=key,
        name=f"Capability {key.replace('_', ' ').title()}",
        description="Description that satisfies the min length bound for capability.",
        rationale="Rationale that satisfies the min length bound for capability.",
        weight=weight,
        display_order=display_order,
        confidence=0.7,
    )


def _actor(key: str, iso: str = "US") -> ActorDraft:
    return ActorDraft(
        key=key,
        name=key.title(),
        iso_country=iso,
        category="public_corp",
        blurb="ten chars min",
        stage="commercial",
        signal_keywords=["x"],
        relevance=70,
        rationale="Long enough rationale ok.",
        display_order=10,
    )


def _risk(key: str, affected: list[str] | None = None) -> RiskDraft:
    return RiskDraft(
        key=key,
        category="legal",
        name=f"Risk {key}",
        description="A long enough risk description that passes the 20-char bound.",
        severity="medium",
        likelihood="medium",
        time_horizon="3y",
        affected_capability_keys=affected or [],
        display_order=10,
    )


def _ca(cap: str, actor: str, role: str = "lead") -> CapabilityActorAssignmentDraft:
    return CapabilityActorAssignmentDraft(
        capability_key=cap, actor_key=actor, role=role  # type: ignore[arg-type]
    )


def _draft(
    *,
    capabilities: list[CapabilityDraft] | None = None,
    dependencies: list[CapabilityDependencyDraft] | None = None,
    risks: list[RiskDraft] | None = None,
    actors: list[ActorDraft] | None = None,
    capability_actors: list[CapabilityActorAssignmentDraft] | None = None,
    binding_key: str = "cap_a",
    slug: str = "fusion-grid-parity",
) -> VisionDecompositionResult:
    capabilities = capabilities or [
        _cap("cap_a", weight=0.4, display_order=10),
        _cap("cap_b", weight=0.3, display_order=20),
        _cap("cap_c", weight=0.3, display_order=30),
    ]
    return VisionDecompositionResult(
        slug=slug,
        name="Test Vision",
        vision_question="When will X happen?",
        description="Long enough description for the field bound on the result.",
        domain_label="Energy",
        capabilities=capabilities,
        dependencies=dependencies or [],
        risks=risks or [_risk("r1"), _risk("r2")],
        actors=actors or [_actor("alpha"), _actor("beta"), _actor("gamma")],
        capability_actors=capability_actors
        or [_ca("cap_a", "alpha"), _ca("cap_b", "beta"), _ca("cap_c", "gamma")],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=50,
            binding_capability_key=binding_key,
            rationale="Long enough rationale field for feasibility.",
        ),
        rationale="Decomposition rationale long enough to satisfy the bound here.",
        confidence=0.75,
    )


def _signal_config(cap_keys: list[str]) -> DataSourceConfigDraft:
    return DataSourceConfigDraft(
        keywords_by_capability=[
            CapabilityKeywordSet(capability_key=k, arxiv_keywords=["x"])
            for k in cap_keys
        ]
    )


# ---- happy path --------------------------------------------------------


def test_happy_path_passes() -> None:
    draft = _draft()
    result = run_validation_gate(
        draft=draft, signal_config=_signal_config(["cap_a", "cap_b", "cap_c"])
    )
    assert result.ok is True
    assert result.errors == []
    assert result.normalized_draft is not None


def test_signal_config_optional_at_gate() -> None:
    """signal_config can be None for visions where the admin is skipping
    automated ingest at first build."""
    draft = _draft()
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is True


# ---- slug duplication --------------------------------------------------


def test_slug_duplication_is_error() -> None:
    draft = _draft(slug="space-data-center")
    result = run_validation_gate(
        draft=draft,
        signal_config=None,
        existing_vision_slugs=["space-data-center", "memory-semi"],
    )
    assert result.ok is False
    assert any("already exists" in e for e in result.errors)


# ---- key uniqueness ----------------------------------------------------


def test_duplicate_capability_keys_is_error() -> None:
    caps = [
        _cap("cap_dup", weight=0.4),
        _cap("cap_dup", weight=0.3, display_order=20),
        _cap("cap_other", weight=0.3, display_order=30),
    ]
    draft = _draft(
        capabilities=caps,
        binding_key="cap_dup",
        capability_actors=[_ca("cap_dup", "alpha")],
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("Duplicate capability keys" in e for e in result.errors)


def test_duplicate_actor_keys_is_error() -> None:
    draft = _draft(
        actors=[_actor("alpha"), _actor("alpha"), _actor("beta")],
        capability_actors=[
            _ca("cap_a", "alpha"),
            _ca("cap_b", "alpha"),
            _ca("cap_c", "beta"),
        ],
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("Duplicate actor keys" in e for e in result.errors)


# ---- FK integrity ------------------------------------------------------


def test_unknown_capability_in_capability_actor_is_error() -> None:
    draft = _draft(
        capability_actors=[
            _ca("ghost_cap", "alpha"),
            _ca("cap_b", "beta"),
            _ca("cap_c", "gamma"),
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("unknown capability 'ghost_cap'" in e for e in result.errors)


def test_unknown_actor_in_capability_actor_is_error() -> None:
    draft = _draft(
        capability_actors=[
            _ca("cap_a", "ghost_actor"),
            _ca("cap_b", "beta"),
            _ca("cap_c", "gamma"),
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("unknown actor 'ghost_actor'" in e for e in result.errors)


def test_existing_actor_key_resolves() -> None:
    """If the agent references an actor by key that's NOT in
    draft.actors but IS in the existing global keys, that's valid."""
    draft = _draft(
        capability_actors=[
            _ca("cap_a", "samsung"),  # exists in DB, not in draft.actors
            _ca("cap_b", "beta"),
            _ca("cap_c", "gamma"),
        ],
    )
    result = run_validation_gate(
        draft=draft, signal_config=None, existing_actor_keys=["samsung", "tsmc"]
    )
    assert result.ok is True


def test_unknown_capability_in_risk_is_error() -> None:
    draft = _draft(
        risks=[
            _risk("r1", affected=["cap_a"]),
            _risk("r2", affected=["ghost"]),
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("risk 'r2' references unknown" in e for e in result.errors)


def test_unknown_binding_capability_is_error() -> None:
    draft = _draft(binding_key="ghost_binding")
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("binding_capability_key" in e for e in result.errors)


# ---- dependency / DAG --------------------------------------------------


def test_dependency_unknown_source_is_error() -> None:
    draft = _draft(
        dependencies=[
            CapabilityDependencyDraft(
                source_key="ghost", target_key="cap_a", rationale="x" * 20
            )
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("source_key 'ghost'" in e for e in result.errors)


def test_dependency_self_loop_is_error() -> None:
    draft = _draft(
        dependencies=[
            CapabilityDependencyDraft(
                source_key="cap_a", target_key="cap_a", rationale="x" * 20
            )
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("self-loop" in e for e in result.errors)


def test_cycle_detection_simple() -> None:
    """A → B → A cycle."""
    draft = _draft(
        dependencies=[
            CapabilityDependencyDraft(
                source_key="cap_a", target_key="cap_b", rationale="x" * 20
            ),
            CapabilityDependencyDraft(
                source_key="cap_b", target_key="cap_a", rationale="x" * 20
            ),
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("cycle" in e for e in result.errors)


def test_cycle_detection_three_node() -> None:
    """A → B → C → A cycle."""
    draft = _draft(
        dependencies=[
            CapabilityDependencyDraft(
                source_key="cap_a", target_key="cap_b", rationale="x" * 20
            ),
            CapabilityDependencyDraft(
                source_key="cap_b", target_key="cap_c", rationale="x" * 20
            ),
            CapabilityDependencyDraft(
                source_key="cap_c", target_key="cap_a", rationale="x" * 20
            ),
        ]
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("cycle" in e for e in result.errors)


def test_dag_no_false_positive_on_diamond() -> None:
    """A → B, A → C, B → D, C → D — valid DAG (diamond), no cycle."""
    caps = [
        _cap("a", weight=0.25, display_order=10),
        _cap("b", weight=0.25, display_order=20),
        _cap("c", weight=0.25, display_order=30),
        _cap("d", weight=0.25, display_order=40),
    ]
    deps = [
        CapabilityDependencyDraft(source_key="a", target_key="b", rationale="x" * 20),
        CapabilityDependencyDraft(source_key="a", target_key="c", rationale="x" * 20),
        CapabilityDependencyDraft(source_key="b", target_key="d", rationale="x" * 20),
        CapabilityDependencyDraft(source_key="c", target_key="d", rationale="x" * 20),
    ]
    draft = _draft(
        capabilities=caps,
        dependencies=deps,
        binding_key="a",
        capability_actors=[
            _ca("a", "alpha"),
            _ca("b", "beta"),
            _ca("c", "gamma"),
            _ca("d", "alpha"),
        ],
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is True


# ---- weight sum + normalization ----------------------------------------


def test_weight_sum_inside_soft_band_no_warn() -> None:
    """0.99 is acceptable — no warning, no normalization."""
    caps = [
        _cap("cap_a", weight=0.33, display_order=10),
        _cap("cap_b", weight=0.33, display_order=20),
        _cap("cap_c", weight=0.33, display_order=30),
    ]
    draft = _draft(capabilities=caps)
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is True
    assert not any("normalized" in w for w in result.warnings)


def test_weight_sum_soft_band_normalizes() -> None:
    """Sum = 0.93 is within hard band → warning + normalize to 1.0."""
    caps = [
        _cap("cap_a", weight=0.31, display_order=10),
        _cap("cap_b", weight=0.31, display_order=20),
        _cap("cap_c", weight=0.31, display_order=30),
    ]
    draft = _draft(capabilities=caps)
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is True
    assert any("normalized" in w for w in result.warnings)
    assert result.normalized_draft is not None
    total = sum(c.weight for c in result.normalized_draft.capabilities)
    assert abs(total - 1.0) < 0.001


def test_weight_sum_outside_hard_band_is_error() -> None:
    """Sum = 0.6 → error, no normalization."""
    caps = [
        _cap("cap_a", weight=0.20, display_order=10),
        _cap("cap_b", weight=0.20, display_order=20),
        _cap("cap_c", weight=0.20, display_order=30),
    ]
    draft = _draft(capabilities=caps)
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("weights sum to 0.60" in e or "weights sum to 0.600" in e for e in result.errors)
    assert result.normalized_draft is None


# ---- signal coverage --------------------------------------------------


def test_missing_signal_keywords_is_warning() -> None:
    draft = _draft()
    # signal config missing cap_c
    result = run_validation_gate(
        draft=draft, signal_config=_signal_config(["cap_a", "cap_b"])
    )
    assert result.ok is True
    assert any("missing keyword sets" in w for w in result.warnings)
    assert any("cap_c" in w for w in result.warnings)


def test_extra_signal_keywords_is_error() -> None:
    """signal_config has a keyword set for a capability not in the draft."""
    draft = _draft()
    result = run_validation_gate(
        draft=draft,
        signal_config=_signal_config(["cap_a", "cap_b", "cap_c", "ghost_cap"]),
    )
    assert result.ok is False
    assert any("unknown capabilities" in e for e in result.errors)


# ---- coverage warnings -------------------------------------------------


def test_uncovered_capability_is_warning() -> None:
    """A capability with no actor assignment should warn (not error)."""
    draft = _draft(
        capability_actors=[_ca("cap_a", "alpha")],  # cap_b + cap_c uncovered
    )
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is True
    assert any("no actor assignment" in w for w in result.warnings)


# ---- duplicate risk keys ----------------------------------------------


def test_duplicate_risk_keys_is_error() -> None:
    draft = _draft(risks=[_risk("dup"), _risk("dup"), _risk("ok")])
    result = run_validation_gate(draft=draft, signal_config=None)
    assert result.ok is False
    assert any("Duplicate risk keys" in e for e in result.errors)
