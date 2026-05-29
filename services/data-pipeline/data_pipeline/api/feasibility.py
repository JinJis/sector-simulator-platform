"""M40b feasibility recompute endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI, HTTPException

from data_pipeline.jobs.runners import run_recompute_feasibility_job

log = logging.getLogger("data_pipeline")


def _recompute_payload(stats) -> dict:  # noqa: ANN001
    return {
        "started_at": stats.started_at.isoformat(),
        "finished_at": stats.finished_at.isoformat() if stats.finished_at else None,
        "visions_processed": stats.visions_processed,
        "capabilities_processed": stats.capabilities_processed,
        "score_updater_calls": stats.score_updater_calls,
        "score_updater_failures": stats.score_updater_failures,
        "score_writes": stats.score_writes,
        "score_writes_skipped_low_confidence": stats.score_writes_skipped_low_confidence,
        "feasibility_writes": stats.feasibility_writes,
        "score_updater_total_cost_usd": stats.score_updater_total_cost_usd,
        "errors": stats.errors,
    }


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["feasibility"])

    @router.post("/jobs/recompute-feasibility")
    async def manual_recompute_feasibility() -> dict:  # noqa: ANN201
        if app.state.signal_repo is None:
            raise HTTPException(
                status_code=503,
                detail="recompute-feasibility unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/recompute-feasibility triggered")
        stats = await run_recompute_feasibility_job(app=app)
        if stats is None:
            raise HTTPException(
                status_code=503, detail="recompute-feasibility skipped"
            )
        return _recompute_payload(stats)

    @router.get("/jobs/recompute-feasibility/last")
    async def last_recompute_feasibility() -> dict:  # noqa: ANN201
        last = app.state.last_feasibility_recompute_result
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no feasibility-recompute has run since the process started",
            )
        return _recompute_payload(last)

    return router
