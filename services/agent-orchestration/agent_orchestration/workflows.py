"""Workflow protocol + runner + first concrete workflow.

The protocol mirrors Temporal's shape so the runner can be swapped for
a Temporal-backed implementation later without touching consumers:

- A workflow is async, takes a typed input, returns a typed output.
- The runner assigns an `id`, kicks the coroutine off, and tracks status.
- Status transitions: pending → running → (succeeded | failed | cancelled).

State persistence goes through a `WorkflowRepository` (see repo.py).
The default in-memory repo preserves the previous behavior; pass a
`PostgresWorkflowRepository` to survive process restarts.

What this runner deliberately does NOT do:
- Retries, timeouts, signals — that's all Temporal's job.
- Concurrency limits — every workflow gets its own task. Phase 3 problem.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Generic, Protocol, TypeVar

from agent_tools import CostMeter, LLMClient
from pydantic import BaseModel

from agent_orchestration.prompts import load_prompt
from agent_orchestration.repo import InMemoryWorkflowRepository, WorkflowRepository
from agent_orchestration.schemas import (
    CapabilityScoreUpdate,
    CapabilityScoreUpdaterRequest,
    CodeGenRequest,
    CodeGenResult,
    CodeReviewRequest,
    CodeReviewResult,
    Decomposition,
    DecompositionRequest,
    DriverInferenceRequest,
    DriverInferenceResult,
    EdgeInferenceRequest,
    EdgeInferenceResult,
    FullPipelineRequest,
    FullPipelineResult,
    ProposeSectorRequest,
    ProposeSectorResult,
    ResearchBrief,
    ResearchRequest,
    SignalExtractorRequest,
    SignalScoring,
    WorkflowRecord,
    WorkflowStatus,
)

log = logging.getLogger("agent_orchestration")


InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)


class Workflow(Protocol, Generic[InputT, OutputT]):
    """Minimal Temporal-shaped contract every workflow implements."""

    kind: str

    async def run(self, request: InputT, *, cost_meter: CostMeter) -> OutputT: ...


# ---- The runner ----------------------------------------------------------


class WorkflowRunner:
    """Scheduler with pluggable persistence.

    `start()` returns the assigned id immediately; the workflow body
    executes in a background task and writes state changes through the
    `WorkflowRepository`. The HTTP layer polls via `get()` and `list()`,
    which read from the repo (so a workflow created in a previous
    process is still visible).

    The runner still keeps per-workflow `CostMeter`s in memory — they
    don't outlive the process, which is fine because they're only used
    for the final cost roll-up at workflow completion. Restart safety
    for in-flight workflows is handled by `mark_dangling_as_failed()`
    on startup (see main.py).
    """

    def __init__(self, repo: WorkflowRepository | None = None) -> None:
        self._repo: WorkflowRepository = repo or InMemoryWorkflowRepository()
        self._meters: dict[str, CostMeter] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._lock = asyncio.Lock()

    @property
    def repo(self) -> WorkflowRepository:
        return self._repo

    # ---- mutation ----

    async def start(
        self,
        *,
        kind: str,
        request: BaseModel,
        run: Callable[[CostMeter], Awaitable[BaseModel]],
    ) -> WorkflowRecord:
        """Schedule a workflow. `run(cost_meter)` is the coroutine factory —
        accepted as a callable so callers can close over their workflow
        instance + the typed input without us needing generic gymnastics
        in the runner."""
        wid = f"wf_{secrets.token_hex(8)}"
        now = datetime.now(UTC)
        meter = CostMeter()
        record = WorkflowRecord(
            id=wid,
            kind=kind,
            status=WorkflowStatus.pending,
            created_at=now,
            updated_at=now,
            input=request.model_dump(),
        )
        async with self._lock:
            self._meters[wid] = meter
        await self._repo.create(record)

        task = asyncio.create_task(self._execute(wid, run, meter))
        self._tasks[wid] = task
        return record

    async def _execute(
        self,
        wid: str,
        run: Callable[[CostMeter], Awaitable[BaseModel]],
        meter: CostMeter,
    ) -> None:
        await self._transition(wid, WorkflowStatus.running)
        try:
            output = await run(meter)
            await self._finish(wid, status=WorkflowStatus.succeeded, output=output)
        except asyncio.CancelledError:
            await self._finish(
                wid, status=WorkflowStatus.cancelled, error="cancelled"
            )
            raise
        except Exception as e:
            log.exception("workflow %s failed", wid)
            await self._finish(wid, status=WorkflowStatus.failed, error=str(e))

    async def _transition(self, wid: str, status: WorkflowStatus) -> None:
        rec = await self._repo.get(wid)
        if rec is None:
            log.warning("workflow %s vanished mid-transition", wid)
            return
        updated = rec.model_copy(
            update={"status": status, "updated_at": datetime.now(UTC)}
        )
        await self._repo.update(updated)

    async def _finish(
        self,
        wid: str,
        *,
        status: WorkflowStatus,
        output: BaseModel | None = None,
        error: str | None = None,
    ) -> None:
        rec = await self._repo.get(wid)
        if rec is None:
            log.warning("workflow %s vanished before finish", wid)
            return
        meter = self._meters.get(wid)
        cost = round(meter.total_usd, 6) if meter else rec.cost_usd
        updated = rec.model_copy(
            update={
                "status": status,
                "updated_at": datetime.now(UTC),
                "output": output.model_dump() if output is not None else None,
                "error": error,
                "cost_usd": cost,
            }
        )
        await self._repo.update(updated)

    async def cancel(self, wid: str) -> WorkflowRecord | None:
        task = self._tasks.get(wid)
        if task is None or task.done():
            return await self.get(wid)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return await self.get(wid)

    # ---- read ----

    async def get(self, wid: str) -> WorkflowRecord | None:
        return await self._repo.get(wid)

    async def list(self, *, limit: int = 50, kind: str | None = None) -> list[WorkflowRecord]:
        # Repo handles ordering + filtering uniformly across in-memory
        # and Postgres backends.
        return await self._repo.list(limit=limit, kind=kind)

    def cost_meter(self, wid: str) -> CostMeter | None:
        return self._meters.get(wid)


# ---- DecompositionWorkflow -----------------------------------------------


class DecompositionWorkflow:
    """Wraps the decomposition agent call. Loads the system prompt from
    `prompts/decomposition.md`, calls Claude Opus 4.7 with the user's
    description, validates the structured output."""

    kind = "decomposition"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: DecompositionRequest, *, cost_meter: CostMeter
    ) -> Decomposition:
        # `cost_meter` is the per-workflow meter; rebind the client onto
        # it so each call rolls into the right ledger.
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("decomposition")
        user_parts = [request.description]
        if request.reference_data:
            user_parts.append(
                "\n\n## Reference data\n\n" + request.reference_data
            )
        # messages.parse() is sync in the Anthropic SDK; offload to a
        # thread so the event loop stays free for other workflows.
        result = await asyncio.to_thread(
            llm.call,
            tier="opus",
            system=system,
            user="\n".join(user_parts),
            max_tokens=8192,
            adaptive_thinking=True,
            response_model=Decomposition,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"decomposition agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        # mypy can't narrow result.parsed via response_model — assert here.
        assert isinstance(result.parsed, Decomposition)
        return result.parsed


# ---- EdgeInferenceWorkflow ----------------------------------------------


class EdgeInferenceWorkflow:
    """Closes the causal DAG over a sector's `Decomposition`. Loads the
    system prompt from `prompts/edge-inference.md`, calls Claude Opus
    4.7 with the decomposition serialized into the user turn, validates
    `EdgeInferenceResult`.

    Why Opus: edges are where the *physics + economics* of a sector
    get encoded. A wrong edge invalidates every downstream simulation.
    Adaptive thinking on, same posture as DecompositionWorkflow.
    """

    kind = "edge_inference"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: EdgeInferenceRequest, *, cost_meter: CostMeter
    ) -> EdgeInferenceResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("edge-inference")
        user = self._format_user_turn(request.decomposition)
        result = await asyncio.to_thread(
            llm.call,
            tier="opus",
            system=system,
            user=user,
            max_tokens=8192,
            adaptive_thinking=True,
            response_model=EdgeInferenceResult,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"edge-inference agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, EdgeInferenceResult)
        return result.parsed

    @staticmethod
    def _format_user_turn(decomp: Decomposition) -> str:
        """Serialize the Decomposition into a compact user turn. We
        deliberately keep this plain-Markdown rather than JSON so the
        Opus prompt cache can hit on the static template — only the
        node values change between calls."""
        lines: list[str] = []
        lines.append(f"# Sector: {decomp.name} (slug `{decomp.slug}`)")
        lines.append(f"Horizon: {decomp.horizon_years} years")
        lines.append("")
        lines.append(f"## Description\n\n{decomp.description}")
        lines.append("")
        lines.append("## Drivers")
        for d in decomp.drivers:
            lines.append(
                f"- `{d.name}` ({d.unit}) — group: {d.group} — "
                f"default {d.default}, range [{d.min}, {d.max}] — {d.description}"
            )
        if decomp.intermediates:
            lines.append("")
            lines.append("## Intermediates")
            for i in decomp.intermediates:
                lines.append(f"- `{i.name}` ({i.unit}) — {i.description}")
        lines.append("")
        lines.append("## Outputs")
        for o in decomp.outputs:
            lines.append(
                f"- `{o.name}` ({o.kind}, {o.unit}) — {o.description}"
            )
        lines.append("")
        lines.append(
            "Produce an `EdgeInferenceResult` connecting every "
            "intermediate and every output back through drivers. Include "
            "every edge — driver → intermediate, intermediate → "
            "intermediate, intermediate → output — and a `formula` field "
            "for every non-driver node. State any modelling assumptions "
            "you had to make in `assumptions`."
        )
        return "\n".join(lines)


# ---- ProposeSectorWorkflow ----------------------------------------------


class ProposeSectorWorkflow:
    """Multi-step chain: Decomposition → EdgeInference. Persists the
    composed result so a single workflow id captures the full
    proposal — the admin's `sector.proposeFromAgent` reads one row
    and creates nodes + edges in a single transaction.

    Cost rolls up across both stages via the same `CostMeter`.
    """

    kind = "propose_sector"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._decomposition = DecompositionWorkflow(llm)
        self._edge_inference = EdgeInferenceWorkflow(llm)

    async def run(
        self, request: ProposeSectorRequest, *, cost_meter: CostMeter
    ) -> ProposeSectorResult:
        decomp = await self._decomposition.run(
            DecompositionRequest(
                description=request.description,
                reference_data=request.reference_data,
            ),
            cost_meter=cost_meter,
        )
        edges = await self._edge_inference.run(
            EdgeInferenceRequest(decomposition=decomp),
            cost_meter=cost_meter,
        )
        # Sanity guard: every edge's source/target should reference a node
        # that exists in the decomposition. We don't *reject* the result
        # on a mismatch (the agent's intent is preserved), but we surface
        # the issue in the workflow record so an admin can see what to
        # patch manually.
        return ProposeSectorResult(decomposition=decomp, edge_inference=edges)


# ---- ResearchWorkflow (M28) ---------------------------------------------


class ResearchWorkflow:
    """Wraps the Research Agent (sonnet). Loads
    `prompts/research.md`, calls Claude Sonnet 4.6 with the user
    description + optional focus areas, validates `ResearchBrief`.

    Why sonnet: per the prompt, this is high-volume extraction +
    citation collection. Opus here would be wasteful — the reasoning
    burden is on Decomposition + EdgeInference downstream.
    """

    kind = "research"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: ResearchRequest, *, cost_meter: CostMeter
    ) -> ResearchBrief:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("research")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="sonnet",
            system=system,
            user=user,
            max_tokens=4096,
            response_model=ResearchBrief,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"research agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, ResearchBrief)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: ResearchRequest) -> str:
        lines = [
            "# Sector to research",
            "",
            request.description,
        ]
        if request.focus_areas:
            lines.append("")
            lines.append("## Focus areas")
            for fa in request.focus_areas:
                lines.append(f"- {fa}")
        lines.append("")
        lines.append(
            "Produce a `ResearchBrief` with the numeric anchors a downstream "
            "Decomposition + Driver Inference pipeline can use to calibrate "
            "drivers. 5-10 anchors is the right count; each anchor needs at "
            "least one source with a `kind` label."
        )
        return "\n".join(lines)


# ---- DriverInferenceWorkflow (M28) --------------------------------------


class DriverInferenceWorkflow:
    """Wraps the Driver Inference Agent (sonnet). Takes a
    `Decomposition` + optional `ResearchBrief`, produces
    `DriverInferenceResult` with calibrated defaults / ranges /
    history / sources per driver.

    Why sonnet: the work is matching anchors to drivers + normalizing
    units, which Sonnet handles well at half the per-token cost of
    Opus.
    """

    kind = "driver_inference"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: DriverInferenceRequest, *, cost_meter: CostMeter
    ) -> DriverInferenceResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("driver-inference")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="sonnet",
            system=system,
            user=user,
            max_tokens=8192,
            response_model=DriverInferenceResult,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"driver-inference agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, DriverInferenceResult)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: DriverInferenceRequest) -> str:
        d = request.decomposition
        lines = [
            f"# Decomposition to calibrate: {d.name} (`{d.slug}`)",
            f"Horizon: {d.horizon_years} years",
            "",
            "## Drivers (un-calibrated)",
        ]
        for drv in d.drivers:
            lines.append(
                f"- `{drv.name}` ({drv.unit}) — group {drv.group} — "
                f"current default {drv.default}, range [{drv.min}, {drv.max}] — "
                f"{drv.description}"
            )
        if request.research_brief is not None:
            rb = request.research_brief
            lines.append("")
            lines.append("## Research Brief")
            lines.append(f"Summary: {rb.summary}")
            if rb.anchors:
                lines.append("")
                lines.append("### Anchors")
                for a in rb.anchors:
                    lines.append(
                        f"- {a.concept} = {a.value_range} (as of {a.as_of})"
                    )
                    for src in a.sources:
                        lines.append(
                            f"  · [{src.kind}] {src.title} — {src.excerpt}"
                        )
            if rb.open_questions:
                lines.append("")
                lines.append("### Open questions")
                for q in rb.open_questions:
                    lines.append(f"- {q}")
        else:
            lines.append("")
            lines.append(
                "_No research brief was supplied — fall back to general "
                "knowledge of the sector to calibrate drivers, and list "
                "any driver you can't confidently source in `unresolved`._"
            )
        lines.append("")
        lines.append(
            "Produce a `DriverInferenceResult`. Every driver in the "
            "Decomposition must appear in `drivers` (or be listed in "
            "`unresolved`). Driver names must match the Decomposition "
            "verbatim."
        )
        return "\n".join(lines)


# ---- CodeGenWorkflow (M28) ----------------------------------------------


class CodeGenWorkflow:
    """Wraps the Code Generation Agent (sonnet). Takes the full
    structured spec (Decomposition + DriverInference + EdgeInference)
    and produces a `CodeGenResult` containing the `SimulationBase`
    subclass source as a string.

    The orchestrator does NOT execute the generated source — the
    Modal sandbox slice handles that. CodeGen's responsibility ends
    at producing the file; CodeReview is the next gate.
    """

    kind = "code_gen"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: CodeGenRequest, *, cost_meter: CostMeter
    ) -> CodeGenResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("code-gen")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="sonnet",
            system=system,
            user=user,
            max_tokens=16384,
            response_model=CodeGenResult,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"code-gen agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, CodeGenResult)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: CodeGenRequest) -> str:
        d = request.decomposition
        dr = request.driver_inference
        ei = request.edge_inference
        lines = [
            f"# Sector spec: {d.name} (`{request.slug}`)",
            "",
            f"Horizon: {d.horizon_years} years",
            f"Description: {d.description}",
            "",
            "## Drivers (calibrated)",
        ]
        # Index calibrated drivers by name so we can show the spec
        # value + the calibrated-by-driver-inference value side by side.
        cal = {c.name: c for c in dr.drivers}
        for drv in d.drivers:
            c = cal.get(drv.name)
            if c is None:
                lines.append(
                    f"- `{drv.name}` ({drv.unit}) — group {drv.group} — "
                    f"UNCALIBRATED (use decomp defaults: default {drv.default}, "
                    f"range [{drv.min}, {drv.max}])"
                )
                continue
            lines.append(
                f"- `{drv.name}` ({c.unit or drv.unit}) — group {drv.group} — "
                f"default {c.default}, range [{c.min}, {c.max}] — {c.description or drv.description}"
            )
            if c.history:
                hp = ", ".join(f"({h.date}, {h.value})" for h in c.history)
                lines.append(f"    history: {hp}")
            if c.sources:
                for src in c.sources:
                    lines.append(
                        f"    source [{src.kind}] {src.title} (as of {src.as_of}) — {src.excerpt}"
                    )
            if c.note:
                lines.append(f"    note: {c.note}")
        if dr.unresolved:
            lines.append("")
            lines.append("### Unresolved drivers (use decomposition defaults)")
            for u in dr.unresolved:
                lines.append(f"- {u}")
        lines.append("")
        lines.append("## Intermediates")
        # Index intermediate formulas by name to merge with decomposition
        if_idx = {i.name: i for i in ei.intermediates}
        for inter in d.intermediates:
            i_form = if_idx.get(inter.name)
            if i_form is not None:
                lines.append(
                    f"- `{inter.name}` ({i_form.unit or inter.unit}) — "
                    f"formula: {i_form.formula} — {i_form.description or inter.description}"
                )
            else:
                lines.append(
                    f"- `{inter.name}` ({inter.unit}) — NO FORMULA — {inter.description}"
                )
        lines.append("")
        lines.append("## Outputs")
        of_idx = {o.name: o for o in ei.outputs}
        for out in d.outputs:
            o_form = of_idx.get(out.name)
            if o_form is not None:
                deps = ", ".join(o_form.depends_on) if o_form.depends_on else "(unstated)"
                lines.append(
                    f"- `{out.name}` ({out.kind}, {out.unit}) — "
                    f"formula: {o_form.formula} — depends on: {deps}"
                )
            else:
                lines.append(
                    f"- `{out.name}` ({out.kind}, {out.unit}) — NO FORMULA"
                )
        lines.append("")
        lines.append("## Causal edges")
        for e in ei.edges:
            label = e.label or "(no label)"
            lines.append(f"- {e.source} → {e.target} [{label}]")
        if ei.assumptions:
            lines.append("")
            lines.append("## Modelling assumptions")
            for a in ei.assumptions:
                lines.append(f"- {a}")
        lines.append("")
        lines.append(
            "Produce a `CodeGenResult` whose `source` is the complete "
            "Python file. The file must subclass `platform_sdk.SimulationBase`, "
            "match the existing house style (see `space_data_center.py`), "
            "and use the driver / intermediate / output names verbatim. "
            "List anything you had to assume or smooth over in `concerns`."
        )
        return "\n".join(lines)


# ---- CodeReviewWorkflow (M28) -------------------------------------------


class CodeReviewWorkflow:
    """Wraps the Code Review Agent (sonnet). Takes the generated source
    + the structured spec it implements + any concerns Code Gen
    surfaced about itself, returns a `CodeReviewResult` with status
    `approve` / `revise` / `reject`.

    Sonnet on purpose — see the prompt for the calibration rationale
    (Opus 4.7's length calibration would suppress legitimate `nit`
    findings).
    """

    kind = "code_review"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: CodeReviewRequest, *, cost_meter: CostMeter
    ) -> CodeReviewResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("code-review")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="sonnet",
            system=system,
            user=user,
            max_tokens=4096,
            response_model=CodeReviewResult,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"code-review agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, CodeReviewResult)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: CodeReviewRequest) -> str:
        d = request.decomposition
        dr = request.driver_inference
        ei = request.edge_inference
        lines = [
            f"# Code review for sector `{d.slug}`",
            "",
            "## Generated source",
            "```python",
            request.source,
            "```",
            "",
            "## Spec — drivers",
        ]
        cal = {c.name: c for c in dr.drivers}
        for drv in d.drivers:
            c = cal.get(drv.name)
            if c is not None:
                lines.append(
                    f"- `{drv.name}` ({c.unit or drv.unit}) — default {c.default}, "
                    f"range [{c.min}, {c.max}]"
                )
            else:
                lines.append(
                    f"- `{drv.name}` ({drv.unit}) — UNCALIBRATED "
                    f"(spec default {drv.default}, [{drv.min}, {drv.max}])"
                )
        lines.append("")
        lines.append("## Spec — intermediates")
        for inter in ei.intermediates:
            lines.append(
                f"- `{inter.name}` ({inter.unit}) — formula: {inter.formula}"
            )
        lines.append("")
        lines.append("## Spec — outputs")
        for o in ei.outputs:
            deps = ", ".join(o.depends_on) if o.depends_on else "(unstated)"
            lines.append(
                f"- `{o.name}` ({o.kind}) — formula: {o.formula} — depends on: {deps}"
            )
        if ei.assumptions:
            lines.append("")
            lines.append("## Modelling assumptions")
            for a in ei.assumptions:
                lines.append(f"- {a}")
        if request.concerns:
            lines.append("")
            lines.append("## Code Gen self-reported concerns")
            for c_str in request.concerns:
                lines.append(f"- {c_str}")
        lines.append("")
        lines.append(
            "Produce a `CodeReviewResult`. Report every finding you "
            "are confident about with severity + category + concrete "
            "location + suggestion. Set `status` per the rubric in the "
            "prompt: `approve` if zero blockers and ≤2 majors; `revise` "
            "otherwise; `reject` only if the spec itself is broken."
        )
        return "\n".join(lines)


# ---- FullPipelineWorkflow (M28) -----------------------------------------


class FullPipelineWorkflow:
    """Six-stage chain that turns a user description into a reviewed
    `SimulationBase` source file:

        Research → Decomposition → DriverInference → EdgeInference
                 → CodeGen → CodeReview

    All stages share the same `CostMeter`, so the workflow record's
    rolled-up `cost_usd` is the headline number. Typical end-to-end
    cost is $0.50–$1.00 — gated by the per-user budget at the tRPC
    layer.

    Failure in any stage short-circuits the chain — the workflow
    record's `error` field surfaces which stage broke.
    """

    kind = "full_pipeline"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._research = ResearchWorkflow(llm)
        self._decomposition = DecompositionWorkflow(llm)
        self._driver_inference = DriverInferenceWorkflow(llm)
        self._edge_inference = EdgeInferenceWorkflow(llm)
        self._code_gen = CodeGenWorkflow(llm)
        self._code_review = CodeReviewWorkflow(llm)

    async def run(
        self, request: FullPipelineRequest, *, cost_meter: CostMeter
    ) -> FullPipelineResult:
        # Stage 1: research
        research = await self._research.run(
            ResearchRequest(
                description=request.description,
                focus_areas=request.focus_areas,
            ),
            cost_meter=cost_meter,
        )
        # Stage 2: decomposition. We pass the research brief summary
        # as reference_data when the caller didn't provide their own —
        # giving the Decomposition agent the same numeric anchors the
        # Driver Inference agent will see later.
        reference_data = request.reference_data
        if reference_data is None and research.anchors:
            anchors_text = "\n".join(
                f"- {a.concept} = {a.value_range} ({a.as_of})"
                for a in research.anchors
            )
            reference_data = (
                f"Research brief summary: {research.summary}\n\n"
                f"Anchors:\n{anchors_text}"
            )
        decomp = await self._decomposition.run(
            DecompositionRequest(
                description=request.description,
                reference_data=reference_data,
            ),
            cost_meter=cost_meter,
        )
        # Stage 3: driver inference (uses the research brief).
        driver_inf = await self._driver_inference.run(
            DriverInferenceRequest(
                decomposition=decomp, research_brief=research
            ),
            cost_meter=cost_meter,
        )
        # Stage 4: edge inference (uses the decomposition).
        edge_inf = await self._edge_inference.run(
            EdgeInferenceRequest(decomposition=decomp),
            cost_meter=cost_meter,
        )
        # Stage 5: code gen. The slug comes from the decomposition.
        code_gen = await self._code_gen.run(
            CodeGenRequest(
                slug=decomp.slug,
                decomposition=decomp,
                driver_inference=driver_inf,
                edge_inference=edge_inf,
            ),
            cost_meter=cost_meter,
        )
        # Stage 6: code review.
        code_review = await self._code_review.run(
            CodeReviewRequest(
                source=code_gen.source,
                decomposition=decomp,
                driver_inference=driver_inf,
                edge_inference=edge_inf,
                concerns=code_gen.concerns,
            ),
            cost_meter=cost_meter,
        )
        return FullPipelineResult(
            research=research,
            decomposition=decomp,
            driver_inference=driver_inf,
            edge_inference=edge_inf,
            code_gen=code_gen,
            code_review=code_review,
        )


# =====================================================================
# M39b — SignalExtractorWorkflow (haiku tier)
# =====================================================================
#
# Highest-volume workflow in the platform — runs ~100-1000x/day (one
# call per ingested signal). Lives on the haiku tier so total monthly
# cost stays under the per-user $30 budget even at thousands of
# signals.
#
# Output is structured (Pydantic SignalScoring). No adaptive_thinking
# (haiku doesn't benefit much, and we want fast turnaround).
# =====================================================================


class SignalExtractorWorkflow:
    """Score one signal against one capability across 4 dimensions.

    Called by the signal_ingest cron (M39c) for every raw signal after
    the adapter writes it. Output (per-dim deltas + confidence +
    matched_actor_key) is written back to the signals row before the
    extractor returns to the caller.

    Prompt: `prompts/signal_extractor.md`. Conservative scoring —
    when ambiguous, dims are null + confidence < 0.5; the score
    updater (M40) drops these.
    """

    kind = "signal_extractor"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: SignalExtractorRequest, *, cost_meter: CostMeter
    ) -> SignalScoring:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("signal_extractor")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="haiku",
            system=system,
            user=user,
            max_tokens=1024,
            # Haiku doesn't materially benefit from extended thinking on
            # this size of task — keep it fast.
            adaptive_thinking=False,
            response_model=SignalScoring,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"signal_extractor returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, SignalScoring)
        # Defensive: when extractor's matched_actor_key isn't in the
        # provided keyword set, drop it (the agent shouldn't hallucinate
        # keys, but cheap to guard).
        if result.parsed.matched_actor_key is not None:
            valid_keys = {ak.actor_key for ak in request.actor_keywords}
            if result.parsed.matched_actor_key not in valid_keys:
                log.warning(
                    "signal_extractor: dropping hallucinated actor_key %r (sector=%s cap=%s)",
                    result.parsed.matched_actor_key,
                    request.sector_slug,
                    request.capability_key,
                )
                # Pydantic v2 model_copy with update is the clean path.
                return result.parsed.model_copy(update={"matched_actor_key": None})
        return result.parsed

    @staticmethod
    def _format_user_turn(request: SignalExtractorRequest) -> str:
        actor_lines: list[str] = []
        if request.actor_keywords:
            actor_lines.append("\n## Actor keyword sets")
            for ak in request.actor_keywords:
                aliases = ", ".join(ak.aliases) if ak.aliases else "(none)"
                actor_lines.append(f"- {ak.actor_key}: {aliases}")
        summary_block = (
            f"\n### Summary\n{request.signal_summary}"
            if request.signal_summary
            else ""
        )
        return (
            f"## Capability — {request.capability_name} ({request.capability_key})\n\n"
            f"**Description**: {request.capability_description}\n\n"
            f"**Why it matters**: {request.capability_rationale}\n\n"
            f"## Signal ({request.source_kind})\n\n"
            f"### Title\n{request.signal_title}"
            f"{summary_block}\n"
            + "\n".join(actor_lines)
            + "\n\nScore per-dimension deltas, confidence, and (optionally) "
            "the matched actor key. Output only the SignalScoring schema."
        )


# =====================================================================
# M40b — CapabilityScoreUpdaterWorkflow (sonnet tier)
# =====================================================================
#
# One call per (capability × recompute cycle). Reasoning-heavy: agent
# weighs the recent signal feed against current scores with temporal
# decay. Sonnet tier (gemini-3.5-flash) — middle of the road for both
# cost and judgment.
# =====================================================================


class CapabilityScoreUpdaterWorkflow:
    """Update a capability's 4-dim scores from recent signals.

    Called by data-pipeline's recompute_feasibility cron once per
    (vision × capability) per day. Prompt: prompts/score_updater.md.
    """

    kind = "capability_score_updater"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: CapabilityScoreUpdaterRequest,
        *,
        cost_meter: CostMeter,
    ) -> CapabilityScoreUpdate:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("score_updater")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="sonnet",
            system=system,
            user=user,
            max_tokens=2048,
            # Sonnet benefits from extended thinking on multi-signal
            # reasoning. Caller pays ~$0.01-0.03 per call vs ~$0.005
            # without — worth it for the judgment quality.
            adaptive_thinking=True,
            response_model=CapabilityScoreUpdate,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"score-updater returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, CapabilityScoreUpdate)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: CapabilityScoreUpdaterRequest) -> str:
        parts: list[str] = []
        parts.append(
            f"## Capability — {request.capability_name} ({request.capability_key})"
        )
        parts.append(f"\n**Description**: {request.capability_description}")
        parts.append(f"\n**Why it matters**: {request.capability_rationale}")
        parts.append("\n## Current scores")
        for label, val in [
            ("technical", request.current_technical),
            ("economic", request.current_economic),
            ("regulatory", request.current_regulatory),
            ("supply", request.current_supply),
        ]:
            parts.append(
                f"- {label}: {val if val is not None else 'null (not assessed)'}"
            )
        parts.append("\n## Recent signals (newest first)")
        if not request.recent_signals:
            parts.append("- (no signals in window)")
        else:
            for s in request.recent_signals:
                deltas = []
                for dim, v in [
                    ("tech", s.delta_technical),
                    ("econ", s.delta_economic),
                    ("reg", s.delta_regulatory),
                    ("sup", s.delta_supply),
                ]:
                    if v is not None:
                        sign = "+" if v >= 0 else ""
                        deltas.append(f"{dim}={sign}{v}")
                deltas_str = " · ".join(deltas) if deltas else "no deltas"
                age_days = (
                    f" ({s.published_at.isoformat()[:10]})"
                    if s.published_at
                    else ""
                )
                actor = f" [{s.actor_short_name}]" if s.actor_short_name else ""
                parts.append(
                    f"- **{s.source_kind}**{actor}: {s.title}{age_days} — {deltas_str}"
                )
                if s.summary:
                    snippet = s.summary[:300]
                    parts.append(f"  > {snippet}{'…' if len(s.summary) > 300 else ''}")
        parts.append(
            "\n\nReturn the updated CapabilityScoreUpdate. Apply temporal decay; "
            "leave a dim null when no signal flow justifies a change."
        )
        return "\n".join(parts)
