"""Tier 1 — prompt sanity.

Parameterized over every prompt in `prompts/`. No API calls — pure
markdown introspection. The point is to catch the kind of regression
that breaks an agent silently: a missing anti-pattern callout, an
output schema rename that didn't propagate, an authoring slip that
left a prompt body suspiciously short.

Lives in the eval harness rather than the per-package test suite
because the assertions cut across all six prompts and the catalog —
this is the place to add cross-prompt invariants as we learn what
matters.
"""

from __future__ import annotations

import pytest
from agent_orchestration.prompts import (
    clear_prompt_cache,
    load_prompt,
    prompt_catalog,
)


@pytest.fixture(autouse=True)
def _reset_cache() -> None:
    clear_prompt_cache()


def _all_prompts() -> list[tuple[str, str]]:
    """Return (name, body) for every catalogued prompt."""
    return [(name, load_prompt(name)) for name in sorted(prompt_catalog())]


@pytest.mark.parametrize(
    "name,body", _all_prompts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_body_mentions_declared_output_schema(name: str, body: str) -> None:
    """A prompt that doesn't name its output type can't anchor the agent
    to the schema. The catalog declares the type; the body must reference
    it at least once."""
    meta = prompt_catalog()[name]
    assert meta.outputs in body, (
        f"{name}: body never mentions output schema {meta.outputs!r} — "
        f"the agent has no way to know what to return"
    )


@pytest.mark.parametrize(
    "name,body", _all_prompts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_body_has_principles_section(name: str, body: str) -> None:
    """Every authored prompt should have an explicit `## Principles`
    section. Drift here usually means someone started a new prompt by
    copy-pasting and forgot to fill it in."""
    assert "## Principles" in body, f"{name}: missing `## Principles` section"


@pytest.mark.parametrize(
    "name,body", _all_prompts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_body_has_anti_patterns_section(name: str, body: str) -> None:
    """Anti-patterns are the most-useful part of an agent prompt and the
    easiest to drop during refactors. Require them explicitly."""
    assert "## Anti-patterns" in body, f"{name}: missing `## Anti-patterns` section"


@pytest.mark.parametrize(
    "name,body", _all_prompts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_body_does_not_contain_volatile_data(name: str, body: str) -> None:
    """Prompt bodies are the cached prefix — they must stay byte-stable
    across runs. Catch interpolation markers; we don't catch function-name
    citations like `datetime.now()` because they legitimately appear in
    prompts as examples of what generated code must AVOID (see
    code-review.md). The relevant signal is *placeholder syntax*."""
    interpolation_markers = ["{{ ", " }}", "%(", "${"]
    for marker in interpolation_markers:
        assert marker not in body, (
            f"{name}: body contains likely-volatile marker {marker!r} — "
            f"interpolating per-request data breaks the prompt cache"
        )


@pytest.mark.parametrize(
    "name,body", _all_prompts(), ids=lambda v: v if isinstance(v, str) else ""
)
def test_body_loads_deterministically(name: str, body: str) -> None:
    """Two reads of the same prompt in the same process must return the
    same bytes — otherwise `cache_control` is meaningless."""
    clear_prompt_cache()
    first = load_prompt(name)
    clear_prompt_cache()
    second = load_prompt(name)
    assert first == second, f"{name}: load is non-deterministic"
    assert first == body


def test_catalog_covers_known_pipeline_agents() -> None:
    """The pipeline has six named agents; if one disappears from the
    catalog something has gone wrong with packaging or front-matter."""
    expected = {
        "research",
        "decomposition",
        "driver-inference",
        "edge-inference",
        "code-gen",
        "code-review",
    }
    catalog = prompt_catalog()
    missing = expected - catalog.keys()
    assert not missing, f"agents missing from catalog: {sorted(missing)}"


def test_no_two_agents_share_a_role_string() -> None:
    """Role strings show up in the orchestrator's audit logs. Two agents
    with the same role would make traces ambiguous."""
    roles: dict[str, str] = {}
    for name, meta in prompt_catalog().items():
        prior = roles.get(meta.role)
        assert prior is None, (
            f"role conflict: {prior!r} and {name!r} both declare role={meta.role!r}"
        )
        roles[meta.role] = name
