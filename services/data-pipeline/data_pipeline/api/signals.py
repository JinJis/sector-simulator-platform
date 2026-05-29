"""Signal-ingest endpoints — manual full sweep + scoped (M49c) + last."""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI, HTTPException

from data_pipeline.api.schemas import SignalIngestScopeRequest
from data_pipeline.jobs.runners import run_signal_ingest_job
from data_pipeline.jobs.signal_ingest import run_signal_ingest

log = logging.getLogger("data_pipeline")


def _ingest_stats_payload(stats) -> dict:  # noqa: ANN001
    return {
        "started_at": stats.started_at.isoformat(),
        "finished_at": stats.finished_at.isoformat() if stats.finished_at else None,
        "visions_processed": stats.visions_processed,
        "capabilities_processed": stats.capabilities_processed,
        "raw_signals_fetched": stats.raw_signals_fetched,
        "extractor_calls": stats.extractor_calls,
        "extractor_failures": stats.extractor_failures,
        "signals_written": stats.signals_written,
        "extractor_total_cost_usd": stats.extractor_total_cost_usd,
        "errors": stats.errors,
    }


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["signals"])

    @router.post("/jobs/signal-ingest")
    async def manual_signal_ingest() -> dict:  # noqa: ANN201
        if app.state.signal_repo is None:
            raise HTTPException(
                status_code=503,
                detail="signal_ingest unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/signal-ingest triggered")
        stats = await run_signal_ingest_job(app=app)
        if stats is None:
            raise HTTPException(status_code=503, detail="signal_ingest skipped")
        return _ingest_stats_payload(stats)

    @router.post("/jobs/signal-ingest/scope")
    async def scoped_signal_ingest(body: SignalIngestScopeRequest) -> dict:  # noqa: ANN201
        """M49c — scope-controlled ingest. The crawler orchestrator
        calls this per (vision × capability) instead of waiting on the
        full-vision daily sweep. Returns the same IngestStats payload
        the unscoped endpoint does."""
        if app.state.signal_repo is None:
            raise HTTPException(
                status_code=503,
                detail="signal_ingest unavailable — DATABASE_URL not configured",
            )
        log.info(
            "data-pipeline: scoped signal-ingest vision=%s caps=%s",
            body.sector_slug,
            body.capability_keys,
        )
        stats = await run_signal_ingest(
            sector_slugs=[body.sector_slug],
            repo=app.state.signal_repo,
            lookback_days=body.lookback_days,
            per_capability_limit=body.per_capability_limit,
            capability_keys=body.capability_keys,
        )
        return _ingest_stats_payload(stats)

    @router.get("/jobs/signal-ingest/last")
    async def last_signal_ingest() -> dict:  # noqa: ANN201
        last = app.state.last_signal_ingest_result
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no signal-ingest has run since the process started",
            )
        return _ingest_stats_payload(last)

    return router
