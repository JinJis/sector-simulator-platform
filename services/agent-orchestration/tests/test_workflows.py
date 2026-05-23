"""Direct tests against `WorkflowRunner` + `DecompositionWorkflow`.

We exercise the runner without going through the HTTP surface so failures
localize cleanly — HTTP tests live in test_api.py.
"""

from __future__ import annotations

import asyncio

import pytest
from agent_tools import LLMClient

from agent_orchestration.schemas import (
    Decomposition,
    DecompositionRequest,
    WorkflowStatus,
)
from agent_orchestration.workflows import DecompositionWorkflow, WorkflowRunner


async def _wait_done(runner: WorkflowRunner, wid: str, timeout: float = 2.0) -> None:
    """Spin until the workflow leaves running/pending. The runner stores the
    asyncio.Task; we await it directly when present, fall back to a short
    polling loop otherwise."""
    task = runner._tasks.get(wid)  # noqa: SLF001 - test introspection
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


@pytest.mark.asyncio
async def test_runner_assigns_id_and_starts_in_pending(fake_llm: LLMClient) -> None:
    runner = WorkflowRunner()
    workflow = DecompositionWorkflow(llm=fake_llm)
    req = DecompositionRequest(description="A simple test sector for orchestrator")

    async def run(cm):  # type: ignore[no-untyped-def]
        return await workflow.run(req, cost_meter=cm)

    rec = await runner.start(kind="decomposition", request=req, run=run)
    assert rec.id.startswith("wf_")
    assert rec.kind == "decomposition"
    # Status is pending OR running by the time start() returns —
    # both are acceptable because the task fires immediately.
    assert rec.status in {WorkflowStatus.pending, WorkflowStatus.running}

    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.succeeded
    assert final.output is not None
    assert final.output["slug"] == "ai-memory-demand"


@pytest.mark.asyncio
async def test_runner_captures_workflow_errors_as_failed(fake_llm: LLMClient) -> None:
    runner = WorkflowRunner()

    async def run(cm):  # type: ignore[no-untyped-def]
        raise RuntimeError("synthetic agent failure")

    req = DecompositionRequest(description="Boom — this one fails on purpose")
    rec = await runner.start(kind="decomposition", request=req, run=run)
    await _wait_done(runner, rec.id)
    final = await runner.get(rec.id)
    assert final is not None
    assert final.status == WorkflowStatus.failed
    assert final.error == "synthetic agent failure"


@pytest.mark.asyncio
async def test_runner_lists_most_recent_first_and_filters_by_kind(
    fake_llm: LLMClient,
) -> None:
    runner = WorkflowRunner()
    workflow = DecompositionWorkflow(llm=fake_llm)

    async def make_run(text: str):
        req = DecompositionRequest(description=text)

        async def run(cm):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cm)

        return await runner.start(kind="decomposition", request=req, run=run)

    a = await make_run("first run for the listing test")
    await asyncio.sleep(0.005)
    b = await make_run("second run for the listing test")
    await _wait_done(runner, a.id)
    await _wait_done(runner, b.id)

    listed = await runner.list()
    assert [r.id for r in listed[:2]] == [b.id, a.id]
    # Filtering by an unknown kind should yield empty.
    assert await runner.list(kind="nonexistent") == []


@pytest.mark.asyncio
async def test_decomposition_workflow_uses_decomposition_prompt(
    fake_llm: LLMClient, fake_anthropic, sample_decomposition: Decomposition
) -> None:
    """The prompt file must be loaded and passed as the system prompt; the
    user description must reach the user turn; structured output must be
    requested via response_model=Decomposition."""
    workflow = DecompositionWorkflow(llm=fake_llm)
    from agent_tools import CostMeter

    meter = CostMeter()
    out = await workflow.run(
        DecompositionRequest(
            description="An automotive battery recycling sector — sources, costs, recovery rates."
        ),
        cost_meter=meter,
    )
    assert isinstance(out, Decomposition)
    assert out.slug == sample_decomposition.slug  # fake echoes the sample
    sent = fake_anthropic.messages.requests[-1]
    sys_blocks = sent["system"]
    assert any("Decomposition Agent" in b["text"] for b in sys_blocks), (
        "decomposition.md content was not loaded into the system prompt"
    )
    # Last block carries the cache_control marker.
    assert sys_blocks[-1]["cache_control"] == {"type": "ephemeral"}
    # Structured output requested with the Decomposition model.
    assert sent["output_format"] is Decomposition
    # Adaptive thinking is requested by the workflow, but the wrapper
    # MUST drop it on the Anthropic path because forced tool_choice
    # (the structured-output mechanism) is incompatible with extended
    # thinking. See llm_client._call_anthropic — structured output is
    # the harder constraint and wins.
    assert sent.get("thinking") is None


@pytest.mark.asyncio
async def test_decomposition_workflow_includes_reference_data_when_supplied(
    fake_anthropic, fake_llm: LLMClient
) -> None:
    workflow = DecompositionWorkflow(llm=fake_llm)
    from agent_tools import CostMeter

    await workflow.run(
        DecompositionRequest(
            description="A sector with reference baseline",
            reference_data="Prior memory-semi sector — used as a comparison.",
        ),
        cost_meter=CostMeter(),
    )
    sent = fake_anthropic.messages.requests[-1]
    user_content = sent["messages"][-1]["content"]
    assert "Reference data" in user_content
    assert "Prior memory-semi" in user_content
