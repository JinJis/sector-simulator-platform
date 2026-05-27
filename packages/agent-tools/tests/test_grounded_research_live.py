"""Live smoke test for GroundedResearchClient against real Gemini.

Default-skipped. Run with `GROUNDED_LIVE=1` plus either:
  - GEMINI_API_KEY=...  (AI Studio path — easiest for local dev)
  - GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_APPLICATION_CREDENTIALS=...
    (Vertex path — matches the production data-pipeline auth)

Purpose: catch model-name + grounding-tool drift before the cockpit
operator hits it. The previous DR migration broke because
`deep-research-max-preview-04-2026` was de-listed silently; this
keeps `gemini-2.5-flash` and `gemini-3.1-pro-preview` honest.

Two cases — one per tier. Each:
  - Makes ONE real call (small prompt, low token budget).
  - Asserts status="completed", non-empty output, cost > 0.
  - For grounded prompts, asserts at least one citation URL came back.

Cost envelope: ~$0.001 (FAST) + ~$0.03 (DEEP) per full run.
"""

from __future__ import annotations

import os

import pytest

from agent_tools.grounded_research import (
    GroundedResearchClient,
    grounded_model_for,
)


LIVE = os.environ.get("GROUNDED_LIVE", "").strip().lower() in {"1", "true", "yes"}

pytestmark = pytest.mark.skipif(
    not LIVE,
    reason="GROUNDED_LIVE not set — live grounded research tests are opt-in",
)


def _build_real_client() -> GroundedResearchClient:
    """Construct a real `google.genai.Client` from env. Vertex preferred
    (matches production), AI Studio as fallback for local dev."""
    from google import genai  # noqa: PLC0415

    if os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        client = genai.Client(
            vertexai=True,
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
        )
    else:
        api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
        if not api_key:
            pytest.skip(
                "GROUNDED_LIVE=1 but neither GOOGLE_GENAI_USE_VERTEXAI nor "
                "GEMINI_API_KEY is set"
            )
        client = genai.Client(api_key=api_key)
    return GroundedResearchClient(genai_client=client)


@pytest.mark.asyncio
async def test_live_fast_tier_grounded_response() -> None:
    """FAST tier (gemini-2.5-flash by default). A grounding-required
    question — model can't answer from training cutoff alone, so the
    grounding tool MUST fire and citations MUST populate."""
    client = _build_real_client()
    result = await client.research(
        prompt=(
            "In one sentence, name the current CEO of NVIDIA Corporation. "
            "Cite an official source URL."
        ),
        surface="actor",
        vision_slug="memory-semi",
        tier="fast",
    )

    assert result.status == "completed", f"got status={result.status} err={result.error}"
    assert result.output_text, "empty output_text"
    assert result.cost_usd > 0, "FAST tier call should meter > 0 USD"
    assert result.model == grounded_model_for("fast")
    # Grounding actually fired — at least one web citation came back.
    assert len(result.citations) >= 1, (
        f"expected citations from grounding tool, got 0. "
        f"raw_usage={result.raw_usage}"
    )
    # First citation has a real URL.
    assert result.citations[0].url.startswith("http"), result.citations[0]


@pytest.mark.asyncio
async def test_live_deep_tier_synthesis() -> None:
    """DEEP tier (gemini-3.1-pro-preview by default) with
    Heavier synthesis prompt — confirms the DEEP-tier model + grounding
    work end-to-end. This is the same path the daily digest cron uses.
    ThinkingConfig was removed (Vertex rejects it on some preview
    models); the DEEP tier still thinks more than FAST because the
    underlying model is heavier."""
    client = _build_real_client()
    result = await client.research(
        prompt=(
            "Summarize one specific regulatory or program announcement "
            "from the United States in the last 30 days that materially "
            "affects the fusion energy sector. Cite the primary source."
        ),
        surface="digest",
        vision_slug="fusion-power-grid-parity",
        tier="deep",
    )

    assert result.status == "completed", f"got status={result.status} err={result.error}"
    assert result.output_text, "empty output_text"
    assert result.cost_usd > 0, "DEEP tier call should meter > 0 USD"
    assert result.model == grounded_model_for("deep")
    # DEEP tier tends to spend more output tokens — heavier model
    # writes more for the same prompt.
    out_tokens = result.raw_usage.get("candidates_token_count", 0)
    assert out_tokens > 30, f"DEEP synthesis should write >30 tokens, got {out_tokens}"
    # Grounding fired.
    assert len(result.citations) >= 1, (
        f"expected ≥1 citation from grounding tool, got 0. "
        f"raw_usage={result.raw_usage}"
    )
