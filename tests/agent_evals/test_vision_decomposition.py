"""Tier-2 eval — VisionDecompositionWorkflow behavior (M41e).

Runs the M41 opus-tier decomposition workflow against five canonical
vision prompts (SDC-class fusion / quantum / humanoid / mRNA-cancer /
direct-to-cell). In offline mode the canned response replays; in
`GEMINI_EVAL_LIVE=1` mode the real opus call runs and the same
assertions check the actual output.

Each assertion is an invariant the platform MUST hold for any valid
vision draft — snake_case keys, ISO alpha-2 country codes, weights
summing to ~1.0, validation gate passes, FK integrity, DAG-shape,
etc. Per-case content checks live inline in the case definition.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from agent_orchestration.schemas import (
    VisionDecompositionRequest,
    VisionDecompositionResult,
)
from agent_orchestration.workflows import VisionDecompositionWorkflow

# Cases live in cases/ — pytest's conftest already inserts
# tests/agent_evals/, the cases sub-dir needs an extra hop.
_CASES_DIR = Path(__file__).parent / "cases"
if str(_CASES_DIR) not in sys.path:
    sys.path.insert(0, str(_CASES_DIR))

from harness import Case  # noqa: E402
from vision_decomposition_cases import vision_decomposition_cases  # noqa: E402


@pytest.mark.parametrize(
    "case", vision_decomposition_cases(), ids=lambda c: c.name
)
def test_vision_decomposition_case(
    case: Case, llm_for_case, eval_mode: str
) -> None:
    """End-to-end: VisionDecompositionWorkflow on a canonical prompt,
    then the M41c ValidationGate as the final invariant check. Cost
    budget guards against runaway opus spend."""
    from agent_tools import CostMeter

    llm = llm_for_case(case)
    workflow = VisionDecompositionWorkflow(llm=llm)
    meter = CostMeter()

    # Mirror what the conductor would pass after a clean prompt validator
    # run. In live mode this exercises the real opus call path; in
    # offline mode the canned response is returned regardless of these
    # field values, so we set sensible defaults.
    request = VisionDecompositionRequest(
        refined_question=case.description,
        suggested_name=case.canned_response.name,
        suggested_slug=case.canned_response.slug,
        domain_label=case.canned_response.domain_label,
        scope="balanced",
        target_capability_count=len(case.canned_response.capabilities),
        target_actor_count=len(case.canned_response.actors),
        existing_actor_keys=[],
    )

    async def run() -> VisionDecompositionResult:
        return await workflow.run(request, cost_meter=meter)

    draft = asyncio.run(run())

    assert draft is not None, (
        f"{case.name} in {eval_mode} mode returned no decomposition"
    )

    for assertion in case.assertions:
        assertion(draft)

    case.budget.assert_within(meter.total_usd, case.name)
