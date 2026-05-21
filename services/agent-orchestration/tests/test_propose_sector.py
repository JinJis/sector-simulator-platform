"""Tests for the M22a multi-step ProposeSectorWorkflow (Decomposition →
EdgeInference) and the standalone EdgeInferenceWorkflow.

Same posture as test_workflows.py — exercise via the runner directly
(HTTP tests live in test_api.py) and use the conftest's FakeAnthropic
so nothing here hits the network.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from agent_tools import LLMClient

from agent_orchestration.schemas import (
    Decomposition,
    EdgeInferenceRequest,
    EdgeInferenceResult,
    EdgeSpec,
    IntermediateFormula,
    OutputFormula,
    ProposeSectorRequest,
    ProposeSectorResult,
    WorkflowStatus,
)
from agent_orchestration.workflows import (
    EdgeInferenceWorkflow,
    ProposeSectorWorkflow,
    WorkflowRunner,
)


SAMPLE_EDGE_INFERENCE = EdgeInferenceResult(
    edges=[
        EdgeSpec(
            source="ai_dram_demand_pb_y0",
            target="industry_revenue",
            label="× ASP",
        ),
        EdgeSpec(
            source="hbm_premium_x",
            target="industry_revenue",
            label="× HBM mix",
        ),
        EdgeSpec(
            source="industry_revenue",
            target="company_revenue_usd",
            label="× market share",
        ),
    ],
    intermediates=[
        IntermediateFormula(
            name="industry_revenue",
            formula="ai_dram_demand_pb_y0 * hbm_premium_x * 1e6",
            unit="USD",
            description="Annual industry revenue from HBM.",
        ),
    ],
    outputs=[
        OutputFormula(
            name="company_revenue_usd",
            formula="industry_revenue * market_share",
            kind="series",
            depends_on=["industry_revenue"],
        ),
    ],
    assumptions=[
        "ASP held constant in real terms across horizon.",
    ],
)


async def _wait_done(runner: WorkflowRunner, wid: str, timeout: float = 2.0) -> None:
    task = runner._tasks.get(wid)  # noqa: SLF001
    if task is not None:
        try:
            await asyncio.wait_for(task, timeout=timeout)
        except asyncio.CancelledError:
            pass
        return
    for _ in range(int(timeout * 100)):
        rec = await runner.get(wid)
        if rec and rec.status in {
            WorkflowStatus.succeeded,
            WorkflowStatus.failed,
            WorkflowStatus.cancelled,
        }:
            return
        await asyncio.sleep(0.01)


# ---- EdgeInferenceWorkflow ----------------------------------------------


@pytest.mark.asyncio
async def test_edge_inference_workflow_succeeds(
    fake_anthropic: Any, fake_llm: LLMClient, sample_decomposition: Decomposition
) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_EDGE_INFERENCE

    workflow = EdgeInferenceWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = EdgeInferenceRequest(decomposition=sample_decomposition)

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)

    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    assert final.output is not None
    assert final.output["edges"][0]["source"] == "ai_dram_demand_pb_y0"
    # Three edges from the sample → three rows persisted.
    assert len(final.output["edges"]) == 3


@pytest.mark.asyncio
async def test_edge_inference_serializes_decomposition_into_user_turn(
    fake_anthropic: Any, fake_llm: LLMClient, sample_decomposition: Decomposition
) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_EDGE_INFERENCE

    workflow = EdgeInferenceWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = EdgeInferenceRequest(decomposition=sample_decomposition)

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)

    # The fake recorded a parse() call. Inspect the user turn passed in.
    assert fake_anthropic.messages.requests, "agent did not invoke parse()"
    last = fake_anthropic.messages.requests[-1]
    messages = last.get("messages", [])
    user_text = messages[0]["content"] if messages else ""
    # Each driver / intermediate / output name from the decomposition
    # should be surfaced verbatim — that's the contract the prompt relies
    # on for the cross-check.
    assert "ai_dram_demand_pb_y0" in user_text
    assert "industry_revenue" in user_text
    assert "company_revenue_usd" in user_text
    assert "Horizon: 10 years" in user_text


@pytest.mark.asyncio
async def test_edge_inference_fails_when_agent_returns_no_parse(
    fake_anthropic: Any, fake_llm: LLMClient, sample_decomposition: Decomposition
) -> None:
    # parsed_factory = None → the FakeMessages.parse() returns no parsed.
    fake_anthropic.messages.parsed_factory = None

    workflow = EdgeInferenceWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = EdgeInferenceRequest(decomposition=sample_decomposition)

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)

    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.failed
    assert final.error is not None
    assert "unparseable" in final.error


# ---- ProposeSectorWorkflow (chain) --------------------------------------


@pytest.mark.asyncio
async def test_propose_sector_chains_both_stages(
    fake_anthropic: Any, fake_llm: LLMClient, sample_decomposition: Decomposition
) -> None:
    # Toggle the fake's parsed_factory based on the model passed to
    # messages.parse so the same FakeAnthropic answers both stages
    # correctly. LLMClient passes the Pydantic class as `output_format`.
    def factory(**kw: Any) -> Any:
        rm = kw.get("output_format") or kw.get("response_format") or kw.get("response_model")
        rm_name = getattr(rm, "__name__", "")
        if rm_name == "Decomposition":
            return sample_decomposition
        if rm_name == "EdgeInferenceResult":
            return SAMPLE_EDGE_INFERENCE
        raise AssertionError(f"unexpected response_model: {rm_name}")

    fake_anthropic.messages.parsed_factory = factory

    workflow = ProposeSectorWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = ProposeSectorRequest(
        description="AI memory demand driven by HBM and accelerator capex."
    )

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)

    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    assert final.kind == "propose_sector"
    assert final.output is not None

    # Round-trip through the composite Pydantic model — proves the
    # output shape matches what `sector.proposeFromAgent` will read.
    composed = ProposeSectorResult.model_validate(final.output)
    assert composed.decomposition.slug == "ai-memory-demand"
    assert len(composed.edge_inference.edges) == 3
    assert composed.edge_inference.assumptions

    # Cost rolls up across BOTH stages on the same meter — exactly two
    # parse() calls should have been recorded.
    parse_calls = [
        r for r in fake_anthropic.messages.requests
        if "output_format" in r
    ]
    assert len(parse_calls) == 2


@pytest.mark.asyncio
async def test_propose_sector_fails_if_decomposition_stage_fails(
    fake_anthropic: Any, fake_llm: LLMClient
) -> None:
    fake_anthropic.messages.parsed_factory = None

    workflow = ProposeSectorWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = ProposeSectorRequest(
        description="Sector concept that the agent will fail to decompose."
    )

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)

    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.failed
    # Decomposition was the first stage that broke — only one parse
    # call should have happened (chain short-circuits on failure).
    parse_calls = [
        r for r in fake_anthropic.messages.requests
        if "output_format" in r
    ]
    assert len(parse_calls) == 1
