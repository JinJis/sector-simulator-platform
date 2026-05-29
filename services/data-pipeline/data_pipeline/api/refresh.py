"""Manual refresh endpoints for the daily quote + quote-history jobs."""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI, HTTPException

from data_pipeline.adapters.base import DataSource
from data_pipeline.jobs.refresh_quote_history import (
    RefreshHistoryResult,
    refresh_quote_history,
)
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult
from data_pipeline.jobs.runners import run_refresh_job
from data_pipeline.repo import EquityRepository

log = logging.getLogger("data_pipeline")


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["refresh"])

    @router.post("/jobs/refresh-quotes", response_model=RefreshQuotesResult)
    async def trigger_refresh() -> RefreshQuotesResult:
        log.info("data-pipeline: manual /jobs/refresh-quotes triggered")
        return await run_refresh_job(app=app)

    @router.get("/jobs/refresh-quotes/last", response_model=RefreshQuotesResult)
    async def last_refresh() -> RefreshQuotesResult:
        last: RefreshQuotesResult | None = getattr(app.state, "last_result", None)
        if last is None:
            raise HTTPException(
                status_code=404, detail="no refresh has run since the process started"
            )
        return last

    @router.post(
        "/jobs/refresh-quote-history",
        response_model=RefreshHistoryResult,
    )
    async def trigger_refresh_history(days: int = 90) -> RefreshHistoryResult:
        log.info(
            "data-pipeline: manual /jobs/refresh-quote-history triggered (days=%d)",
            days,
        )
        repo: EquityRepository = app.state.repo
        source: DataSource = app.state.source
        throttle = int(app.state.throttle_ms)
        result = await refresh_quote_history(
            source=source, repo=repo, days=days, throttle_ms=throttle
        )
        app.state.last_history_result = result
        return result

    @router.get(
        "/jobs/refresh-quote-history/last",
        response_model=RefreshHistoryResult,
    )
    async def last_history_refresh() -> RefreshHistoryResult:
        last: RefreshHistoryResult | None = getattr(
            app.state, "last_history_result", None
        )
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no quote-history refresh has run since the process started",
            )
        return last

    return router
