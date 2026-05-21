"""data-pipeline FastAPI app.

Endpoints:
- GET  /health                 → liveness + last-run telemetry
- POST /jobs/refresh-quotes    → manual trigger
- GET  /jobs/refresh-quotes/last → last RefreshQuotesResult or 404

Scheduler:
  APScheduler `AsyncIOScheduler` runs `refresh_quotes` daily at the cron
  configured by `INGEST_CRON_QUOTES` (default `30 8 * * *` UTC — that's
  17:30 KST, well after KOSPI close and a few hours after US close).
  Disabled when `INGEST_SCHEDULE=off`.

Configuration (env):
  DATABASE_URL             — required
  INGEST_SOURCE            — `yfinance` (default) or `fake` for smoke
  INGEST_THROTTLE_MS       — between-symbol sleep (default 200)
  INGEST_CRON_QUOTES       — APScheduler cron (default `30 8 * * *`)
  INGEST_SCHEDULE          — set to `off` to disable the scheduler
  LOG_LEVEL                — default INFO
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from data_pipeline.adapters.base import DataSource
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import YFinanceSource
from data_pipeline.jobs.refresh_quote_history import (
    RefreshHistoryResult,
    refresh_quote_history,
)
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult, refresh_quotes
from data_pipeline.repo import EquityRepository, build_repository

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("data_pipeline")

_DEFAULT_CRON = "30 8 * * *"  # 08:30 UTC = 17:30 KST


def _build_source() -> DataSource:
    name = os.environ.get("INGEST_SOURCE", "yfinance").lower()
    if name == "fake":
        log.warning("data-pipeline: using FakeSource — only smoke-test data!")
        return FakeSource()
    return YFinanceSource()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    # Allow tests to pre-wire these.
    if not hasattr(app.state, "repo"):
        repo = await build_repository(os.environ.get("DATABASE_URL"))
        app.state.repo = repo
    if not hasattr(app.state, "source"):
        app.state.source = _build_source()
    if not hasattr(app.state, "last_result"):
        app.state.last_result = None
    app.state.throttle_ms = int(os.environ.get("INGEST_THROTTLE_MS", "200"))

    scheduler: AsyncIOScheduler | None = None
    if os.environ.get("INGEST_SCHEDULE", "on").lower() != "off":
        cron = os.environ.get("INGEST_CRON_QUOTES", _DEFAULT_CRON)
        try:
            trigger = CronTrigger.from_crontab(cron, timezone="UTC")
        except ValueError as e:
            log.error("data-pipeline: bad INGEST_CRON_QUOTES=%r (%s) — scheduler off", cron, e)
        else:
            scheduler = AsyncIOScheduler(timezone="UTC")
            scheduler.add_job(
                _run_refresh_job,
                trigger=trigger,
                kwargs={"app": app},
                id="refresh_quotes_daily",
                replace_existing=True,
            )
            scheduler.start()
            log.info("data-pipeline: scheduler armed (cron=%r UTC)", cron)
    else:
        log.info("data-pipeline: scheduler disabled by INGEST_SCHEDULE=off")
    app.state.scheduler = scheduler

    log.info("data-pipeline ready")
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        repo = getattr(app.state, "repo", None)
        if repo is not None:
            await repo.close()


async def _run_refresh_job(*, app: FastAPI) -> RefreshQuotesResult:
    repo: EquityRepository = app.state.repo
    source: DataSource = app.state.source
    throttle = int(app.state.throttle_ms)
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=throttle)
    app.state.last_result = result
    return result


def create_app() -> FastAPI:
    app = FastAPI(
        title="data-pipeline",
        version="0.1.0",
        description=(
            "Data ingestion — daily equity quote refresh from yfinance "
            "(US tickers + Korean .KS/.KQ symbols)."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3100"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, Any]:
        last: RefreshQuotesResult | None = getattr(app.state, "last_result", None)
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        next_run = None
        if scheduler is not None:
            jobs = scheduler.get_jobs()
            if jobs and jobs[0].next_run_time is not None:
                next_run = jobs[0].next_run_time.isoformat()
        return {
            "status": "ok",
            "now": datetime.now(UTC).isoformat(),
            "scheduler_armed": scheduler is not None,
            "next_refresh_at": next_run,
            "last_refresh": last.model_dump(mode="json") if last is not None else None,
        }

    @app.post("/jobs/refresh-quotes", response_model=RefreshQuotesResult)
    async def trigger_refresh() -> RefreshQuotesResult:
        log.info("data-pipeline: manual /jobs/refresh-quotes triggered")
        return await _run_refresh_job(app=app)

    @app.get("/jobs/refresh-quotes/last", response_model=RefreshQuotesResult)
    async def last_refresh() -> RefreshQuotesResult:
        last: RefreshQuotesResult | None = getattr(app.state, "last_result", None)
        if last is None:
            raise HTTPException(
                status_code=404, detail="no refresh has run since the process started"
            )
        return last

    @app.post(
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

    @app.get(
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

    return app


app = create_app()
