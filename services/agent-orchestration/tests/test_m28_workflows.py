"""M28 — tests for the dormant prompts now wired as live workflows.

Same posture as test_workflows.py / test_propose_sector.py: exercise the
runner directly (HTTP coverage lives in test_api.py) and use the
conftest's FakeAnthropic so no network calls fire.

Each new workflow gets:
- one happy-path test (correct system prompt loaded, structured output
  parsed)
- one failure-path test (parse() returns no parsed → workflow records
  the failure)

The FullPipelineWorkflow gets its own chain test that asserts:
- all six stages fire exactly once
- the composite output round-trips through FullPipelineResult
- failure in any stage short-circuits the chain
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from agent_tools import CostMeter, LLMClient

from agent_orchestration.schemas import (
    CalibratedDriver,
    CodeGenRequest,
    CodeGenResult,
    CodeReviewFinding,
    CodeReviewRequest,
    CodeReviewResult,
    CodeReviewRerunInputs,
    Decomposition,
    DriverInferenceRequest,
    DriverInferenceResult,
    DriverSourceRef,
    EdgeInferenceResult,
    EdgeSpec,
    FullPipelineRequest,
    FullPipelineResult,
    IntermediateFormula,
    OutputFormula,
    ResearchAnchor,
    ResearchBrief,
    ResearchRequest,
    ResearchSourceCitation,
    WorkflowStatus,
)
from agent_orchestration.workflows import (
    CodeGenWorkflow,
    CodeReviewWorkflow,
    DriverInferenceWorkflow,
    FullPipelineWorkflow,
    ResearchWorkflow,
    WorkflowRunner,
)


# ---- Sample outputs (reused across tests) -------------------------------


SAMPLE_RESEARCH = ResearchBrief(
    summary="LEO data centers are an emerging technoeconomic concept.",
    anchors=[
        ResearchAnchor(
            concept="LEO launch cost",
            value_range="$200–$2700 per kg LEO",
            as_of="2024-Q4",
            sources=[
                ResearchSourceCitation(
                    title="FAA Commercial Space Transportation 2024",
                    url="https://faa.gov/...",
                    kind="gov_report",
                    excerpt="Falcon 9 rideshare averages $2.7k/kg LEO.",
                ),
            ],
        ),
    ],
    open_questions=["Refurbishment cycle for orbital DC racks unknown."],
)


SAMPLE_DRIVER_INFERENCE = DriverInferenceResult(
    drivers=[
        CalibratedDriver(
            name="ai_dram_demand_pb_y0",
            default=800.0,
            min=50.0,
            max=5000.0,
            unit="PB",
            description="Year-0 AI/HBM demand.",
            sources=[
                DriverSourceRef(
                    title="TrendForce HBM tracker",
                    url="https://...",
                    as_of="2024-Q4",
                    kind="analyst",
                    excerpt="HBM shipments doubled YoY in 2024.",
                ),
            ],
            note="Direction up; revisit quarterly.",
        ),
        CalibratedDriver(
            name="hbm_premium_x",
            default=5.0,
            min=2.0,
            max=12.0,
            unit="x",
            description="HBM ASP / commodity DRAM ASP.",
            sources=[
                DriverSourceRef(
                    title="Samsung Q4 earnings",
                    kind="filing",
                    excerpt="HBM ASP roughly 5x commodity DRAM.",
                ),
            ],
            note="",
        ),
    ],
    unresolved=[],
)


SAMPLE_EDGE_INFERENCE = EdgeInferenceResult(
    edges=[
        EdgeSpec(
            source="ai_dram_demand_pb_y0",
            target="industry_revenue",
            label="× ASP",
        ),
        EdgeSpec(
            source="industry_revenue",
            target="company_revenue_usd",
            label="× share",
        ),
    ],
    intermediates=[
        IntermediateFormula(
            name="industry_revenue",
            formula="ai_dram_demand_pb_y0 * hbm_premium_x * 1e6",
            unit="USD",
        ),
    ],
    outputs=[
        OutputFormula(
            name="company_revenue_usd",
            formula="industry_revenue * 0.4",
            kind="series",
            depends_on=["industry_revenue"],
        ),
    ],
    assumptions=["ASP held constant in real terms."],
)


SAMPLE_CODE_GEN = CodeGenResult(
    slug="ai-memory-demand",
    module_name="ai_memory_demand",
    class_name="AIMemoryDemandSim",
    source=(
        '"""AI memory demand sim — placeholder generated module."""\n'
        "from platform_sdk import SimulationBase\n\n"
        "class AIMemoryDemandSim(SimulationBase):\n"
        "    slug = 'ai-memory-demand'\n"
        "    name = 'AI Memory Demand'\n"
        "    horizon_years = 10\n"
        "    drivers = {}\n"
        "    def simulate(self, **kwargs):\n"
        "        return {}\n"
    ),
    concerns=["Simplified scaffolding for the test fixture."],
)


SAMPLE_CODE_REVIEW = CodeReviewResult(
    status="revise",
    findings=[
        CodeReviewFinding(
            severity="major",
            category="spec_mismatch",
            location="AIMemoryDemandSim.drivers",
            message="drivers dict is empty but the spec lists two drivers.",
            suggestion="Add Driver(...) entries for the two calibrated drivers.",
        ),
    ],
    summary="Generated source is a stub; flesh out drivers + simulate before approve.",
    rerun_inputs=CodeReviewRerunInputs(preserve=["decomposition"], rerun=["code_gen"]),
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


# ---- ResearchWorkflow ----------------------------------------------------


@pytest.mark.asyncio
async def test_research_workflow_succeeds(
    fake_anthropic: Any, fake_llm: LLMClient
) -> None:
    fake_anthropic.models.parsed_factory = lambda **kw: SAMPLE_RESEARCH
    workflow = ResearchWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = ResearchRequest(
        description="Orbital data centers powered by solar.",
        focus_areas=["launch cost trends", "radiation tolerance"],
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    assert final.output is not None
    parsed = ResearchBrief.model_validate(final.output)
    assert len(parsed.anchors) == 1
    # The user turn must surface the focus areas to the agent.
    last = fake_anthropic.models.requests[-1]
    user_text = last["messages"][-1]["content"]
    assert "launch cost trends" in user_text
    assert "radiation tolerance" in user_text
    # Sonnet tier — adaptive thinking should NOT be set for sonnet calls.
    # (post-M34: Gemini-backed wrapper still routes thinking via budget;
    # the assertion now checks that the *adaptive* mode isn't enabled.)
    assert last.get("thinking") != {"type": "adaptive"}


@pytest.mark.asyncio
async def test_research_workflow_fails_on_unparseable_output(
    fake_anthropic: Any, fake_llm: LLMClient
) -> None:
    fake_anthropic.models.parsed_factory = None
    workflow = ResearchWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = ResearchRequest(description="A sector the agent will fail to research.")

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.failed
    assert final.error and "unparseable" in final.error


# ---- DriverInferenceWorkflow --------------------------------------------


@pytest.mark.asyncio
async def test_driver_inference_workflow_succeeds(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = lambda **kw: SAMPLE_DRIVER_INFERENCE
    workflow = DriverInferenceWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = DriverInferenceRequest(
        decomposition=sample_decomposition, research_brief=SAMPLE_RESEARCH
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    parsed = DriverInferenceResult.model_validate(final.output)
    assert len(parsed.drivers) == 2

    # User turn must mention the driver names AND the research anchors
    # so the agent can match them up.
    last = fake_anthropic.models.requests[-1]
    user_text = last["messages"][-1]["content"]
    assert "ai_dram_demand_pb_y0" in user_text
    assert "LEO launch cost" in user_text


@pytest.mark.asyncio
async def test_driver_inference_workflow_handles_missing_research_brief(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = lambda **kw: SAMPLE_DRIVER_INFERENCE
    workflow = DriverInferenceWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = DriverInferenceRequest(decomposition=sample_decomposition, research_brief=None)

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    # The user turn must say "no research brief was supplied" so the
    # agent knows to fall back to general knowledge.
    last = fake_anthropic.models.requests[-1]
    assert "No research brief" in last["messages"][-1]["content"]


# ---- CodeGenWorkflow -----------------------------------------------------


@pytest.mark.asyncio
async def test_code_gen_workflow_succeeds(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = lambda **kw: SAMPLE_CODE_GEN
    workflow = CodeGenWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = CodeGenRequest(
        slug="ai-memory-demand",
        decomposition=sample_decomposition,
        driver_inference=SAMPLE_DRIVER_INFERENCE,
        edge_inference=SAMPLE_EDGE_INFERENCE,
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    parsed = CodeGenResult.model_validate(final.output)
    assert "AIMemoryDemandSim" in parsed.source

    # User turn carries the calibrated default + the edge formulas —
    # otherwise the agent can't transcribe them.
    last = fake_anthropic.models.requests[-1]
    user_text = last["messages"][-1]["content"]
    assert "default 800.0" in user_text
    assert "formula: ai_dram_demand_pb_y0 * hbm_premium_x * 1e6" in user_text


# ---- CodeReviewWorkflow --------------------------------------------------


@pytest.mark.asyncio
async def test_code_review_workflow_succeeds(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = lambda **kw: SAMPLE_CODE_REVIEW
    workflow = CodeReviewWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = CodeReviewRequest(
        source=SAMPLE_CODE_GEN.source,
        decomposition=sample_decomposition,
        driver_inference=SAMPLE_DRIVER_INFERENCE,
        edge_inference=SAMPLE_EDGE_INFERENCE,
        concerns=SAMPLE_CODE_GEN.concerns,
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    parsed = CodeReviewResult.model_validate(final.output)
    assert parsed.status == "revise"
    # User turn includes the generated source AND the Code Gen concerns.
    last = fake_anthropic.models.requests[-1]
    user_text = last["messages"][-1]["content"]
    assert "AIMemoryDemandSim" in user_text
    assert "Simplified scaffolding" in user_text


# ---- FullPipelineWorkflow ------------------------------------------------


def _full_pipeline_factory(sample_decomp: Decomposition):
    """Returns a parsed_factory that answers each stage with the
    appropriate sample by looking at the response_model class name."""

    def factory(**kw: Any) -> Any:
        rm = (
            kw.get("output_format")
            or kw.get("response_format")
            or kw.get("response_model")
        )
        rm_name = getattr(rm, "__name__", "")
        if rm_name == "ResearchBrief":
            return SAMPLE_RESEARCH
        if rm_name == "Decomposition":
            return sample_decomp
        if rm_name == "DriverInferenceResult":
            return SAMPLE_DRIVER_INFERENCE
        if rm_name == "EdgeInferenceResult":
            return SAMPLE_EDGE_INFERENCE
        if rm_name == "CodeGenResult":
            return SAMPLE_CODE_GEN
        if rm_name == "CodeReviewResult":
            return SAMPLE_CODE_REVIEW
        raise AssertionError(f"unexpected response_model: {rm_name}")

    return factory


@pytest.mark.asyncio
async def test_full_pipeline_chains_all_six_stages(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = _full_pipeline_factory(
        sample_decomposition
    )

    workflow = FullPipelineWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = FullPipelineRequest(
        description="AI memory demand driven by HBM ramp and accelerator capex.",
        focus_areas=["HBM ASP trend"],
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id, timeout=5.0)
    final = await runner.get(rec.id)
    assert final is not None, "workflow vanished"
    assert final.status == WorkflowStatus.succeeded, final.error
    assert final.kind == "full_pipeline"

    composed = FullPipelineResult.model_validate(final.output)
    assert composed.research.anchors[0].concept == "LEO launch cost"
    assert composed.decomposition.slug == sample_decomposition.slug
    assert composed.driver_inference.drivers[0].name == "ai_dram_demand_pb_y0"
    assert len(composed.edge_inference.edges) == 2
    assert composed.code_gen.class_name == "AIMemoryDemandSim"
    assert composed.code_review.status == "revise"

    # Exactly six structured-output calls should have been made.
    parse_calls = [r for r in fake_anthropic.models.requests if "output_format" in r]
    assert len(parse_calls) == 6, f"expected 6 parse() calls, got {len(parse_calls)}"


@pytest.mark.asyncio
async def test_full_pipeline_short_circuits_on_research_failure(
    fake_anthropic: Any,
    fake_llm: LLMClient,
) -> None:
    fake_anthropic.models.parsed_factory = None
    workflow = FullPipelineWorkflow(llm=fake_llm)
    runner = WorkflowRunner()
    req = FullPipelineRequest(
        description="A sector that should fail at the research stage."
    )

    async def run(cm):
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind=workflow.kind, request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.failed
    # Failure on stage 1 — exactly one parse() call before short-circuit.
    parse_calls = [r for r in fake_anthropic.models.requests if "output_format" in r]
    assert len(parse_calls) == 1


@pytest.mark.asyncio
async def test_full_pipeline_shares_cost_meter_across_all_stages(
    fake_anthropic: Any,
    fake_llm: LLMClient,
    sample_decomposition: Decomposition,
) -> None:
    fake_anthropic.models.parsed_factory = _full_pipeline_factory(
        sample_decomposition
    )
    workflow = FullPipelineWorkflow(llm=fake_llm)
    meter = CostMeter()
    result = await workflow.run(
        FullPipelineRequest(description="A sector for cost-meter accounting test."),
        cost_meter=meter,
    )
    assert isinstance(result, FullPipelineResult)
    # The fake usage emits 100 input + 200 output tokens per call. Six
    # stages → 6 entries on the meter, all rolled into the same total.
    summary = meter.summary()
    assert summary["calls"] == 6
    assert summary["total_usd"] > 0
