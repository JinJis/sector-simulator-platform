"""FastAPI app — HTTP surface for the orchestration service.

Endpoint surface (Phase 2 starter):
- POST /workflows/decompose   → kick off a DecompositionWorkflow
- GET  /workflows/{id}        → poll status / fetch output
- GET  /workflows             → list recent (filter by ?kind=)
- POST /workflows/{id}/cancel → cancel a running workflow
- GET  /health

The runner + LLMClient are global singletons configured at startup so
tests can override them via `app.state.runner` / `app.state.llm` — no
DI framework needed for the surface area we have today.

Persistence: when `DATABASE_URL` is configured, the runner uses a
Postgres-backed repo; otherwise it falls back to an in-memory one.
Both expose the same `WorkflowRepository` protocol so consumers don't
care which is in play.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import timedelta

import time

from agent_tools import CostMeter, LLMClient
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from agent_orchestration.repo import (
    InMemoryWorkflowRepository,
    build_repository,
    utc_now,
)
from agent_orchestration.schemas import (
    CapabilityScoreUpdaterRequest,
    CapabilityScoreUpdaterRunResult,
    CodeGenRequest,
    CodeReviewRequest,
    DecompositionRequest,
    DriverInferenceRequest,
    FullPipelineRequest,
    ProposeSectorRequest,
    ResearchRequest,
    SignalExtractorRequest,
    SignalExtractorRunResult,
    WorkflowRecord,
)
from agent_orchestration.workflows import (
    CapabilityScoreUpdaterWorkflow,
    CodeGenWorkflow,
    CodeReviewWorkflow,
    DecompositionWorkflow,
    DriverInferenceWorkflow,
    FullPipelineWorkflow,
    ProposeSectorWorkflow,
    ResearchWorkflow,
    SignalExtractorWorkflow,
    WorkflowRunner,
)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("agent_orchestration")


# Workflows still in `pending` / `running` after this much wall-clock
# time when the process boots are assumed to have been driven by a
# previous (now-dead) worker. We mark them failed so the list view
# doesn't show them as perpetually "running".
_DANGLING_GRACE = timedelta(minutes=5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Allow tests / harnesses to pre-set these on app.state before lifespan
    # runs. In normal boot they're built from environment.
    if not hasattr(app.state, "runner"):
        database_url = os.environ.get("DATABASE_URL")
        repo = await build_repository(database_url)
        if isinstance(repo, InMemoryWorkflowRepository):
            log.info("agent-orchestration: in-memory repo (no DATABASE_URL)")
        else:
            log.info("agent-orchestration: postgres repo via DATABASE_URL")
            # Sweep workflows the previous process couldn't finish.
            swept = await repo.mark_dangling_as_failed(
                statuses=["pending", "running"],
                stale_before=utc_now() - _DANGLING_GRACE,
                reason="process crashed or was restarted before completion",
            )
            if swept:
                log.info("agent-orchestration: marked %d dangling workflows as failed", swept)
        app.state.repo = repo
        app.state.runner = WorkflowRunner(repo=repo)
    if not hasattr(app.state, "llm"):
        app.state.llm = LLMClient()
    log.info(
        "agent-orchestration ready (workflows: decomposition, propose_sector, "
        "research, driver_inference, code_gen, code_review, full_pipeline)"
    )
    try:
        yield
    finally:
        repo = getattr(app.state, "repo", None)
        if repo is not None:
            await repo.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="agent-orchestration",
        version="0.1.0",
        description="Agent workflow orchestration. Temporal-shaped, in-memory runner.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3100"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/workflows/decompose", response_model=WorkflowRecord, status_code=202)
    async def start_decomposition(req: DecompositionRequest) -> WorkflowRecord:
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = DecompositionWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/workflows/propose-sector", response_model=WorkflowRecord, status_code=202
    )
    async def start_propose_sector(req: ProposeSectorRequest) -> WorkflowRecord:
        """Multi-step pipeline: Decomposition (Opus) → EdgeInference
        (Opus). Returns immediately with the workflow record; the
        composed result lands on `output` when both stages succeed."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = ProposeSectorWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    # ---- M28 dormant prompts → live workflows ---------------------------

    @app.post(
        "/workflows/research", response_model=WorkflowRecord, status_code=202
    )
    async def start_research(req: ResearchRequest) -> WorkflowRecord:
        """Research Agent (Sonnet). Returns a `ResearchBrief` with
        sourced numeric anchors — typically the first stage of
        full_pipeline but exposed independently for stage-level
        testing."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = ResearchWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/workflows/driver-inference",
        response_model=WorkflowRecord,
        status_code=202,
    )
    async def start_driver_inference(
        req: DriverInferenceRequest,
    ) -> WorkflowRecord:
        """Driver Inference Agent (Sonnet). Takes a `Decomposition` +
        optional `ResearchBrief`, returns calibrated drivers with
        provenance."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = DriverInferenceWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/workflows/code-gen", response_model=WorkflowRecord, status_code=202
    )
    async def start_code_gen(req: CodeGenRequest) -> WorkflowRecord:
        """Code Generation Agent (Sonnet). Takes the full structured
        spec, returns a `SimulationBase` subclass source file as a
        string. The orchestrator does NOT execute the source — Modal
        sandbox is a future slice."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = CodeGenWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/workflows/code-review", response_model=WorkflowRecord, status_code=202
    )
    async def start_code_review(req: CodeReviewRequest) -> WorkflowRecord:
        """Code Review Agent (Sonnet). Returns a `CodeReviewResult`
        with status `approve` / `revise` / `reject` and severity-tagged
        findings."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = CodeReviewWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/workflows/full-pipeline",
        response_model=WorkflowRecord,
        status_code=202,
    )
    async def start_full_pipeline(req: FullPipelineRequest) -> WorkflowRecord:
        """Six-stage chain: research → decomposition → driver_inference
        → edge_inference → code_gen → code_review. Headline workflow
        for admin sector authoring. Typical cost $0.50–$1.00."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = app.state.llm
        workflow = FullPipelineWorkflow(llm=llm)

        async def run(cost_meter):  # type: ignore[no-untyped-def]
            return await workflow.run(req, cost_meter=cost_meter)

        return await runner.start(kind=workflow.kind, request=req, run=run)

    @app.post(
        "/signal-extractor/score",
        response_model=SignalExtractorRunResult,
    )
    async def signal_extractor_score(
        req: SignalExtractorRequest,
    ) -> SignalExtractorRunResult:
        """Synchronous extractor endpoint — called by the signal_ingest
        cron once per raw Signal. Single haiku call (~$0.001 each at
        current pricing), so we run inline rather than through the
        WorkflowRunner queue. Returns the scoring + cost roll-up.
        """
        llm: LLMClient = app.state.llm
        workflow = SignalExtractorWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            scoring = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception(
                "signal-extractor failed for %s/%s: %s",
                req.sector_slug,
                req.capability_key,
                e,
            )
            raise HTTPException(
                status_code=502,
                detail=f"extractor agent failed: {e}",
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return SignalExtractorRunResult(
            scoring=scoring,
            cost_usd=cost_meter.total_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/capability-score-updater/score",
        response_model=CapabilityScoreUpdaterRunResult,
    )
    async def capability_score_updater(
        req: CapabilityScoreUpdaterRequest,
    ) -> CapabilityScoreUpdaterRunResult:
        """Synchronous score-updater endpoint — called by the
        recompute_feasibility cron once per (vision × capability) per
        day. Single sonnet call with extended thinking; ~$0.01-0.03
        each at current pricing. Returns the update + cost roll-up.
        """
        llm: LLMClient = app.state.llm
        workflow = CapabilityScoreUpdaterWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            update = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception(
                "capability-score-updater failed for %s/%s: %s",
                req.sector_slug,
                req.capability_key,
                e,
            )
            raise HTTPException(
                status_code=502,
                detail=f"score-updater agent failed: {e}",
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return CapabilityScoreUpdaterRunResult(
            update=update,
            cost_usd=cost_meter.total_usd,
            duration_ms=duration_ms,
        )

    @app.get("/workflows/{wid}", response_model=WorkflowRecord)
    async def get_workflow(wid: str) -> WorkflowRecord:
        runner: WorkflowRunner = app.state.runner
        record = await runner.get(wid)
        if record is None:
            raise HTTPException(status_code=404, detail=f"workflow not found: {wid}")
        return record

    @app.get("/workflows", response_model=list[WorkflowRecord])
    async def list_workflows(
        kind: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
    ) -> list[WorkflowRecord]:
        runner: WorkflowRunner = app.state.runner
        return await runner.list(kind=kind, limit=limit)

    @app.post("/workflows/{wid}/cancel", response_model=WorkflowRecord)
    async def cancel_workflow(wid: str) -> WorkflowRecord:
        runner: WorkflowRunner = app.state.runner
        record = await runner.cancel(wid)
        if record is None:
            raise HTTPException(status_code=404, detail=f"workflow not found: {wid}")
        return record

    return app


app = create_app()
