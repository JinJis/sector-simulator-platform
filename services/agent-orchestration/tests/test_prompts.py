"""Tests for the prompt loader + front-matter catalog.

The catalog is enforced as the single source of truth for which agents
ship: every .md in `prompts/` (except README.md) must parse cleanly,
declare a valid tier, and round-trip through `prompt_catalog()`.
"""

from __future__ import annotations

import pytest

from agent_orchestration.prompts import (
    clear_prompt_cache,
    load_prompt,
    prompt_catalog,
    prompt_metadata,
)


# Refresh the cache between tests so a test that registers a temporary
# `PROMPTS_DIR` won't leak state into the next case.
@pytest.fixture(autouse=True)
def _reset() -> None:
    clear_prompt_cache()


# Expected catalog members + their tier. Update when adding / removing
# prompts; this is the test that catches "I forgot to ship a prompt".
_EXPECTED_PROMPTS = {
    "research": "sonnet",
    "decomposition": "opus",
    "driver-inference": "sonnet",
    "edge-inference": "opus",
    "code-gen": "sonnet",
    "code-review": "sonnet",
}


def test_catalog_contains_every_authored_prompt() -> None:
    catalog = prompt_catalog()
    missing = set(_EXPECTED_PROMPTS) - catalog.keys()
    assert not missing, f"missing prompts: {missing}"


def test_catalog_tiers_match_expected_routing() -> None:
    catalog = prompt_catalog()
    for name, expected_tier in _EXPECTED_PROMPTS.items():
        assert name in catalog, f"prompt missing: {name}"
        assert catalog[name].tier == expected_tier, (
            f"{name}: expected tier {expected_tier}, got {catalog[name].tier}"
        )


def test_catalog_skips_readme_and_files_without_front_matter() -> None:
    catalog = prompt_catalog()
    # README.md is a special case — always present, never an agent.
    assert "README" not in catalog


def test_metadata_required_keys_are_present() -> None:
    meta = prompt_metadata("decomposition")
    assert meta.name == "decomposition"
    assert meta.role.endswith("Agent") or "Agent" in meta.role
    assert meta.inputs and meta.outputs
    assert meta.version >= 1


def test_load_prompt_strips_front_matter_from_body() -> None:
    body = load_prompt("decomposition")
    # Body should not start with the front-matter delimiter — that's the
    # signal that stripping worked. It should start with the H1 instead.
    assert not body.lstrip().startswith("---")
    assert body.lstrip().startswith("# Decomposition Agent")


def test_load_prompt_body_is_substantial() -> None:
    """Catch the case where someone accidentally truncates a prompt to
    just a heading. Each authored prompt should run several hundred
    characters past the title."""
    for name in _EXPECTED_PROMPTS:
        body = load_prompt(name)
        assert len(body) > 500, f"{name}: body suspiciously short ({len(body)} chars)"


def test_invalid_tier_in_front_matter_raises(tmp_path, monkeypatch) -> None:
    bad = tmp_path / "bogus.md"
    bad.write_text(
        "---\n"
        "role: Bogus Agent\n"
        "tier: warlock\n"  # not a valid tier
        "inputs: X\n"
        "outputs: Y\n"
        "version: 1\n"
        "---\n\n"
        "# body\n"
    )
    # README sentinel so _find_prompts_dir() accepts the tmp directory.
    (tmp_path / "README.md").write_text("# tmp")
    monkeypatch.setenv("PROMPTS_DIR", str(tmp_path))
    clear_prompt_cache()
    with pytest.raises(ValueError, match="tier"):
        prompt_metadata("bogus")


def test_missing_front_matter_keys_raises(tmp_path, monkeypatch) -> None:
    incomplete = tmp_path / "incomplete.md"
    incomplete.write_text(
        "---\n"
        "role: Incomplete\n"
        "tier: opus\n"
        # missing inputs/outputs/version
        "---\n\n"
        "# body\n"
    )
    (tmp_path / "README.md").write_text("# tmp")
    monkeypatch.setenv("PROMPTS_DIR", str(tmp_path))
    clear_prompt_cache()
    with pytest.raises(ValueError, match="missing keys"):
        prompt_metadata("incomplete")


def test_unclosed_front_matter_raises(tmp_path, monkeypatch) -> None:
    bad = tmp_path / "unclosed.md"
    # Only valid key:value lines + a markdown-comment line — never sees
    # the closing `---`, so the parser falls off the end.
    bad.write_text(
        "---\n"
        "role: X\n"
        "tier: opus\n"
        "# this is a comment, not the close\n"
    )
    (tmp_path / "README.md").write_text("# tmp")
    monkeypatch.setenv("PROMPTS_DIR", str(tmp_path))
    clear_prompt_cache()
    with pytest.raises(ValueError, match="never closed"):
        prompt_metadata("unclosed")


def test_malformed_front_matter_line_raises(tmp_path, monkeypatch) -> None:
    """A bare non-comment line inside the front-matter block (no `:`)
    is a typo, not a body delimiter — surface it explicitly."""
    bad = tmp_path / "malformed.md"
    bad.write_text(
        "---\n"
        "role: X\n"
        "this is not a key value pair\n"
        "---\n\n"
        "body\n"
    )
    (tmp_path / "README.md").write_text("# tmp")
    monkeypatch.setenv("PROMPTS_DIR", str(tmp_path))
    clear_prompt_cache()
    with pytest.raises(ValueError, match="missing ':'"):
        prompt_metadata("malformed")


def test_file_without_front_matter_still_loads_but_omitted_from_catalog(
    tmp_path, monkeypatch
) -> None:
    """Legacy / WIP files should not crash the catalog — they're just
    skipped. `load_prompt` still returns their body so a workflow that
    knows the file name can use it."""
    legacy = tmp_path / "legacy.md"
    legacy.write_text("# Legacy prompt\n\nNo front-matter here.\n")
    (tmp_path / "README.md").write_text("# tmp")
    monkeypatch.setenv("PROMPTS_DIR", str(tmp_path))
    clear_prompt_cache()
    assert "legacy" not in prompt_catalog()
    body = load_prompt("legacy")
    assert "Legacy prompt" in body


def test_decomposition_workflow_still_works_after_front_matter_refactor(
    fake_llm,
) -> None:
    """Regression guard: the existing DecompositionWorkflow loads the
    body and uses it as the system prompt. After adding front-matter, the
    body must still start with the H1, not with `---`. (Mirrors the
    workflow test, but pinned to the post-refactor invariant.)"""
    import asyncio

    from agent_tools import CostMeter

    from agent_orchestration.schemas import DecompositionRequest
    from agent_orchestration.workflows import DecompositionWorkflow

    workflow = DecompositionWorkflow(llm=fake_llm)

    async def run() -> None:
        await workflow.run(
            DecompositionRequest(description="A small sector for regression testing"),
            cost_meter=CostMeter(),
        )

    asyncio.run(run())
    # If the body had retained the front-matter, the fake's request
    # capture would show the system prompt starting with `---` and the
    # subsequent existing workflow tests would have caught it.
    body = load_prompt("decomposition")
    assert body.startswith("# Decomposition Agent")
