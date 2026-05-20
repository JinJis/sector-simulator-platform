"""Tier 2 — DecompositionWorkflow behavior evals.

Runs the workflow end-to-end against realistic sector descriptions. In
offline mode (default) the agent's response is replayed from a canned
`Decomposition`; in live mode (`ANTHROPIC_EVAL_LIVE=1`) the real Opus
4.7 call is made and the same assertions run against the actual output.

Each assertion checks an *invariant* — something that must hold for any
valid Decomposition. Per-case content checks belong inline in the case
definition.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from agent_orchestration.schemas import Decomposition, DecompositionRequest
from agent_orchestration.workflows import DecompositionWorkflow

# Cases live in a sibling cases/ directory — pytest's conftest already
# added the tests/agent_evals dir to sys.path, but the cases sub-package
# needs an additional hop.
_CASES_DIR = Path(__file__).parent / "cases"
if str(_CASES_DIR) not in sys.path:
    sys.path.insert(0, str(_CASES_DIR))

from decomposition_cases import decomposition_cases  # noqa: E402
from harness import Case  # noqa: E402


@pytest.mark.parametrize("case", decomposition_cases(), ids=lambda c: c.name)
def test_decomposition_case(case: Case, llm_for_case, eval_mode: str) -> None:
    """End-to-end: kick the workflow, run every baseline assertion against
    the parsed `Decomposition`, then check the cost budget."""
    from agent_tools import CostMeter

    llm = llm_for_case(case)
    workflow = DecompositionWorkflow(llm=llm)
    meter = CostMeter()

    async def run() -> Decomposition:
        return await workflow.run(
            DecompositionRequest(description=case.description),
            cost_meter=meter,
        )

    decomp = asyncio.run(run())

    # In live mode the offline meter doesn't capture anything (the
    # LLMClient builds a new internal meter when given a fresh client),
    # so we read off the workflow's own meter via the runner. Here we
    # bypass the runner and ran the workflow directly — the cost meter
    # passed in IS the source of truth.
    assert decomp is not None, f"{case.name} in {eval_mode} mode returned no decomposition"

    for assertion in case.assertions:
        assertion(decomp)

    case.budget.assert_within(meter.total_usd, case.name)
