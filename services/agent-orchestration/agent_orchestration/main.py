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
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any

from agent_tools import CostMeter, LLMClient
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from agent_orchestration import progress
from agent_orchestration.conductor import VisionBuilderConductor
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
    DataSourceSelectorRequest,
    DataSourceSelectorRunResult,
    DecompositionRequest,
    DriverInferenceRequest,
    FullPipelineRequest,
    MarketingContentRunResult,
    PromptValidatorRunResult,
    ProposalPayloadDraftRequest,
    ProposalPayloadDraftResult,
    ProposeSectorRequest,
    ResearchRequest,
    SignalExtractorRequest,
    SignalExtractorRunResult,
    StageMetricDto,
    ValidationGateDto,
    VisionBuilderPromptRequest,
    VisionBuilderRequest,
    VisionBuilderRunResult,
    VisionDecompositionRequest,
    VisionDecompositionRunResult,
    VisionMarketingSnapshot,
    WorkflowRecord,
)
from agent_orchestration.workflows import (
    CapabilityScoreUpdaterWorkflow,
    CodeGenWorkflow,
    CodeReviewWorkflow,
    DataSourceSelectorWorkflow,
    DecompositionWorkflow,
    DriverInferenceWorkflow,
    FullPipelineWorkflow,
    MarketingContentWorkflow,
    PromptValidatorWorkflow,
    ProposalPayloadDrafterWorkflow,
    ProposeSectorWorkflow,
    ResearchWorkflow,
    SignalExtractorWorkflow,
    VisionDecompositionWorkflow,
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
        # Try to build LLMClient eagerly. If LLM auth isn't configured
        # (no Vertex SA, no GEMINI_API_KEY) the constructor raises
        # RuntimeError — we used to let that kill boot, but that makes
        # dev/test/CI without creds impossible. Catch it, store None,
        # and let `_require_llm` return 503 from each endpoint that
        # actually needs an LLM. Non-LLM endpoints (health, repo reads,
        # workflow listing) keep working.
        try:
            app.state.llm = LLMClient()
        except RuntimeError as exc:
            app.state.llm = None
            log.warning(
                "agent-orchestration: LLM auth not configured (%s) — "
                "LLM-dependent endpoints will return 503 until "
                "GOOGLE_APPLICATION_CREDENTIALS or GEMINI_API_KEY is set",
                exc,
            )
    log.info(
        "agent-orchestration ready (llm=%s, workflows: decomposition, "
        "propose_sector, research, driver_inference, code_gen, "
        "code_review, full_pipeline)",
        "configured" if app.state.llm is not None else "disabled",
    )
    try:
        yield
    finally:
        repo = getattr(app.state, "repo", None)
        if repo is not None:
            await repo.close()


def _require_llm(app: FastAPI) -> LLMClient:
    """Return the lifespan-built LLMClient, or raise 503 if the
    service booted without LLM auth (no Vertex SA + no GEMINI_API_KEY).
    Endpoints that don't actually need an LLM bypass this helper."""
    llm = getattr(app.state, "llm", None)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "agent-orchestration is running without LLM auth. Set "
                "GOOGLE_APPLICATION_CREDENTIALS (Vertex SA) or "
                "GEMINI_API_KEY (AI Studio) and restart the container."
            ),
        )
    return llm


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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        llm: LLMClient = _require_llm(app)
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
        cron once per raw Signal. Single fast-tier call (~$0.001 each at
        current pricing), run synchronously through the runner to ensure
        persistence and audit logging. Returns the scoring + cost roll-up.
        """
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = _require_llm(app)
        workflow = SignalExtractorWorkflow(llm=llm)
        t0 = time.perf_counter()

        async def run_fn(meter: CostMeter):
            return await workflow.run(req, cost_meter=meter)

        try:
            scoring, record = await runner.run_synchronous(
                kind=workflow.kind, request=req, run_fn=run_fn
            )
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
            cost_usd=record.cost_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/proposal-payload/draft",
        response_model=ProposalPayloadDraftResult,
    )
    async def proposal_payload_draft(
        req: ProposalPayloadDraftRequest,
    ) -> ProposalPayloadDraftResult:
        """M55 follow-up — fill a community proposal's `proposed_payload`
        from the (target_kind, sector, title, body) the user typed in the
        wizard's first 3 steps. Single fast-tier call (~$0.001 each), run
        synchronously through the runner to ensure persistence and audit logging."""
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = _require_llm(app)
        workflow = ProposalPayloadDrafterWorkflow(llm=llm)
        t0 = time.perf_counter()

        async def run_fn(meter: CostMeter):
            return await workflow.run(req, cost_meter=meter)

        try:
            payload_model, record = await runner.run_synchronous(
                kind=workflow.kind, request=req, run_fn=run_fn
            )
        except Exception as e:
            log.exception("proposal-payload draft failed: %s", e)
            raise HTTPException(
                status_code=502,
                detail=f"proposal-payload drafter failed: {e}",
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return ProposalPayloadDraftResult(
            target_kind=req.target_kind,
            payload=payload_model.model_dump(),
            cost_usd=record.cost_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/vision-builder/validate-prompt",
        response_model=PromptValidatorRunResult,
    )
    async def vision_builder_validate_prompt(
        req: VisionBuilderPromptRequest,
    ) -> PromptValidatorRunResult:
        """Stage 1 of the Vision Builder pipeline — sanity-check the
        user's natural-language prompt before kicking off the
        expensive decomposition stages. Cheap (fast tier, ~$0.0005
        per call). Returns rejection details + a refined_question
        suggestion that the admin UI surfaces as "did you mean…?".
        """
        from agent_orchestration.schemas import PromptValidatorRunResult

        llm: LLMClient = _require_llm(app)
        workflow = PromptValidatorWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            validation = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception("prompt-validator failed: %s", e)
            raise HTTPException(
                status_code=502, detail=f"prompt-validator failed: {e}"
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return PromptValidatorRunResult(
            validation=validation,
            cost_usd=cost_meter.total_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/vision-builder/decompose",
        response_model=VisionDecompositionRunResult,
    )
    async def vision_builder_decompose(
        req: VisionDecompositionRequest,
    ) -> VisionDecompositionRunResult:
        """Stage 3 of the Vision Builder pipeline — full structured
        decomposition (capabilities + dependencies + risks + actors +
        initial feasibility). Deep tier; cost target <$0.50 per call.
        Admin must approve the resulting draft before it's persisted.
        """
        llm: LLMClient = _require_llm(app)
        workflow = VisionDecompositionWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            draft = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception("vision-decomposition failed: %s", e)
            raise HTTPException(
                status_code=502, detail=f"vision-decomposition failed: {e}"
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return VisionDecompositionRunResult(
            draft=draft,
            cost_usd=cost_meter.total_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/vision-builder/build",
        response_model=VisionBuilderRunResult,
    )
    async def vision_builder_build(
        req: VisionBuilderRequest,
    ) -> VisionBuilderRunResult:
        """End-to-end Vision Builder — runs the full pipeline (validator
        → decomposition → data sources → validation gate) and returns a
        single draft ready for admin review. Total cost target ≤$0.55
        per successful build. Pipeline short-circuits at stage 1 on
        prompt rejection; gate failures still return the (un-normalized)
        draft so admin can see what went wrong.
        """
        llm: LLMClient = _require_llm(app)
        conductor = VisionBuilderConductor(llm=llm)
        try:
            result = await conductor.run(
                prompt=req.prompt,
                existing_vision_slugs=req.existing_vision_slugs,
                existing_actor_keys=req.existing_actor_keys,
                research_brief=req.research_brief,
            )
        except Exception as e:
            # Surface the exception class + message + the snapshot of
            # which stages got far enough to emit completion events.
            # Without this, the 502 body is just "vision-builder
            # failed: <repr>" — operator can't tell whether it died
            # in stage 2 or stage 5. The full traceback still goes
            # to stderr via log.exception.
            progress_snap = progress.snapshot()
            completed = ", ".join(
                f"{s['name']}({s['duration_ms']}ms)"
                for s in progress_snap.get("stages", [])
            ) or "<none>"
            log.exception(
                "vision-builder conductor failed at stage=%r after [%s]: %s",
                progress_snap.get("current_stage"),
                completed,
                e,
            )
            # Flip the progress slot to failed so the admin UI's
            # polling loop stops trying instead of waiting forever.
            progress.pipeline_complete(status="failed", error=str(e))
            detail = (
                f"vision-builder failed at stage="
                f"{progress_snap.get('current_stage')!r} "
                f"after stages=[{completed}]: "
                f"{type(e).__name__}: {e}"
            )
            raise HTTPException(status_code=502, detail=detail) from e
        return VisionBuilderRunResult(
            success=result.success,
            validation=result.validation,
            draft=result.draft,
            signal_config=result.signal_config,
            gate=ValidationGateDto(
                ok=result.gate.ok,
                errors=result.gate.errors,
                warnings=result.gate.warnings,
            ) if result.gate is not None else None,
            thesis_catalysts=result.thesis_catalysts,
            stages=[
                StageMetricDto(
                    name=s.name,
                    cost_usd=s.cost_usd,
                    duration_ms=s.duration_ms,
                    output_summary=s.output_summary,
                )
                for s in result.stages
            ],
            total_cost_usd=result.total_cost_usd,
            total_duration_ms=result.total_duration_ms,
        )

    @app.get("/vision-builder/progress/latest")
    async def vision_builder_progress_latest() -> dict[str, Any]:
        """Slice 15 — single-tenant progress slot. Returns the latest
        Vision Builder pipeline's per-stage state for the admin's
        polling UI. Single global slot (last-writer-wins) — fine for
        the single-operator dev environment; multi-tenant would need
        a submission-id keyed registry."""
        return progress.snapshot()

    @app.post(
        "/vision-builder/select-data-sources",
        response_model=DataSourceSelectorRunResult,
    )
    async def vision_builder_select_data_sources(
        req: DataSourceSelectorRequest,
    ) -> DataSourceSelectorRunResult:
        """Stage 4 of the Vision Builder pipeline — per-capability
        keyword sets for arXiv / USPTO / News adapters. Balanced tier;
        cheap (~$0.005 per vision). Output gets persisted into each
        Capability.signal_keywords column so the M39 ingest cron
        picks them up on the next run.
        """
        llm: LLMClient = _require_llm(app)
        workflow = DataSourceSelectorWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            config = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception("data-source-selector failed: %s", e)
            raise HTTPException(
                status_code=502, detail=f"data-source-selector failed: {e}"
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return DataSourceSelectorRunResult(
            config=config,
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
        day. Single balanced-tier call with extended thinking; ~$0.01-0.03
        each at current pricing, run synchronously through the runner to
        ensure persistence and audit logging. Returns the update + cost roll-up.
        """
        runner: WorkflowRunner = app.state.runner
        llm: LLMClient = _require_llm(app)
        workflow = CapabilityScoreUpdaterWorkflow(llm=llm)
        t0 = time.perf_counter()

        async def run_fn(meter: CostMeter):
            return await workflow.run(req, cost_meter=meter)

        try:
            update, record = await runner.run_synchronous(
                kind=workflow.kind, request=req, run_fn=run_fn
            )
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
            cost_usd=record.cost_usd,
            duration_ms=duration_ms,
        )

    @app.post(
        "/marketing-content/generate",
        response_model=MarketingContentRunResult,
    )
    async def marketing_content(
        req: VisionMarketingSnapshot,
    ) -> MarketingContentRunResult:
        """Synchronous marketing-copy endpoint — called by the
        data-pipeline marketing_digest job once per vision. Single
        balanced-tier call; returns a bilingual (ko + en) Threads +
        Instagram post set + cost roll-up."""
        llm: LLMClient = _require_llm(app)
        workflow = MarketingContentWorkflow(llm=llm)
        cost_meter = CostMeter()
        t0 = time.perf_counter()
        try:
            post_set = await workflow.run(req, cost_meter=cost_meter)
        except Exception as e:
            log.exception(
                "marketing-content failed for %s: %s", req.vision_slug, e
            )
            raise HTTPException(
                status_code=502,
                detail=f"marketing-content agent failed: {e}",
            ) from e
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return MarketingContentRunResult(
            post_set=post_set,
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
