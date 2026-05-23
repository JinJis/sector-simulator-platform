"""data-pipeline FastAPI app.

Endpoints:
- GET  /health                            → liveness + last-run telemetry
- POST /jobs/refresh-quotes               → daily snapshot refresh
- GET  /jobs/refresh-quotes/last
- POST /jobs/refresh-quote-history        → daily-bar window refresh
- GET  /jobs/refresh-quote-history/last
- POST /jobs/refresh-financials           → quarterly fundamentals refresh
- GET  /jobs/refresh-financials/last

Scheduler (APScheduler AsyncIOScheduler, UTC):
  refresh_quotes        — `INGEST_CRON_QUOTES` (default `30 8 * * *`)
  refresh_financials    — `REFRESH_FINANCIALS_CRON` (default `0 4 * * 0`, weekly)
  Disabled entirely when `INGEST_SCHEDULE=off`.

Configuration (env):
  DATABASE_URL                  — required
  INGEST_SOURCE                 — `yfinance` (default) or `fake` for smoke
  INGEST_THROTTLE_MS            — between-symbol sleep (default 200)
  INGEST_CRON_QUOTES            — quote-refresh cron
  INGEST_SCHEDULE               — set to `off` to disable the scheduler
  REFRESH_FINANCIALS_CRON       — financials-refresh cron
  REFRESH_FINANCIALS_QUARTERS   — how many quarters to fetch per equity
  EDGAR_USER_AGENT              — SEC fair-access policy contact string
  DART_API_KEY                  — OPEN DART (KR) — required for KR refresh
  LOG_LEVEL                     — default INFO
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
from data_pipeline.adapters.dart_source import DartSource
from data_pipeline.adapters.edgar_source import EdgarSource
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.fake_financials import FakeFinancialsSource
from data_pipeline.adapters.financials_base import FinancialsSource
from data_pipeline.adapters.frankfurter_fx import FrankfurterFx
from data_pipeline.adapters.yfinance_source import YFinanceSource
from data_pipeline.jobs.refresh_financials import (
    RefreshFinancialsResult,
    refresh_financials,
)
from data_pipeline.jobs.refresh_quote_history import (
    RefreshHistoryResult,
    refresh_quote_history,
)
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult, refresh_quotes
from data_pipeline.jobs.resolve_predictions import (
    ResolvePredictionsResult,
    resolve_due_predictions,
)
from data_pipeline.prediction_repo import (
    PredictionResolverRepository,
    build_resolver_repository,
)
from data_pipeline.repo import EquityRepository, build_repository

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("data_pipeline")

_DEFAULT_CRON = "30 8 * * *"  # 08:30 UTC = 17:30 KST
# Default financials cron: weekly Sun 04:00 UTC. Quarterly cadence
# upstream means daily would burn rate limits with no value.
_DEFAULT_FINANCIALS_CRON = "0 4 * * 0"
_DEFAULT_FINANCIALS_QUARTERS = 8
# Default prediction-resolve cron: 09:00 UTC daily. 30 min after the
# 08:30 UTC quote refresh so the resolver sees today's freshly-ingested
# closes when target_date is yesterday. (M33b)
_DEFAULT_RESOLVE_PREDICTIONS_CRON = "0 9 * * *"

# M39c — signal ingest cron. 09:00 UTC = 18:00 KST daily (after KOSPI
# close / few hours after US news cycle). Separate env so it can be
# scheduled independently of the legacy equity cron family.
_DEFAULT_SIGNAL_INGEST_CRON = "0 9 * * *"


def _build_source() -> DataSource:
    name = os.environ.get("INGEST_SOURCE", "yfinance").lower()
    if name == "fake":
        log.warning("data-pipeline: using FakeSource — only smoke-test data!")
        return FakeSource()
    return YFinanceSource()


def _build_financials_sources(
    *, fx: FrankfurterFx | None = None
) -> tuple[FinancialsSource, FinancialsSource | None]:
    """Return (us_source, kr_source). KR is optional — without DART_API_KEY
    we skip KR equities at refresh time. INGEST_SOURCE=fake routes both
    countries through FakeFinancialsSource for smoke tests.

    M10c: when a `FrankfurterFx` instance is provided, the DART adapter
    uses it for per-quarter historical FX. Without it the adapter
    falls back to the constructor's `DEFAULT_KRW_PER_USD`.
    """
    name = os.environ.get("INGEST_SOURCE", "yfinance").lower()
    if name == "fake":
        log.warning("data-pipeline: using FakeFinancialsSource — only smoke-test data!")
        fake = FakeFinancialsSource()
        return fake, fake

    edgar_ua = os.environ.get(
        "EDGAR_USER_AGENT",
        "sector-simulator-platform info@example.com",
    )
    edgar = EdgarSource(user_agent=edgar_ua)

    dart_key = os.environ.get("DART_API_KEY", "").strip()
    kr_source: FinancialsSource | None = None
    if dart_key:
        fx_for = fx.krw_per_usd if fx is not None else None
        kr_source = DartSource(api_key=dart_key, fx_for=fx_for)
    else:
        log.warning(
            "data-pipeline: DART_API_KEY unset — KR equities will be skipped on financials refresh.",
        )
    return edgar, kr_source


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    # Allow tests to pre-wire these.
    if not hasattr(app.state, "repo"):
        repo = await build_repository(os.environ.get("DATABASE_URL"))
        app.state.repo = repo
    if not hasattr(app.state, "resolver_repo"):
        # Separate pool from `repo` so a long-running refresh-quotes job
        # doesn't starve the resolver and vice versa. Tests pre-set
        # `app.state.resolver_repo` to swap in an in-memory backing.
        app.state.resolver_repo = await build_resolver_repository(
            os.environ.get("DATABASE_URL")
        )
    if not hasattr(app.state, "source"):
        app.state.source = _build_source()
    if not hasattr(app.state, "fx"):
        app.state.fx = FrankfurterFx()
    if not hasattr(app.state, "us_financials") or not hasattr(app.state, "kr_financials"):
        us_fs, kr_fs = _build_financials_sources(fx=app.state.fx)
        app.state.us_financials = us_fs
        app.state.kr_financials = kr_fs
    if not hasattr(app.state, "last_result"):
        app.state.last_result = None
    if not hasattr(app.state, "last_financials_result"):
        app.state.last_financials_result = None
    if not hasattr(app.state, "last_resolve_result"):
        app.state.last_resolve_result = None
    if not hasattr(app.state, "last_signal_ingest_result"):
        app.state.last_signal_ingest_result = None
    # Signal ingest gets its own asyncpg pool (separate from `repo` and
    # `resolver_repo`) so its writes don't compete with refresh jobs.
    # Tests pre-wire `app.state.signal_repo` to swap in InMemory.
    if not hasattr(app.state, "signal_repo"):
        from data_pipeline.signal_repo import PostgresSignalRepository

        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            try:
                app.state.signal_repo = await PostgresSignalRepository.connect(dsn)
            except Exception as e:
                log.error("data-pipeline: signal_repo connect failed: %s", e)
                app.state.signal_repo = None
        else:
            log.warning(
                "data-pipeline: DATABASE_URL unset — signal_ingest disabled"
            )
            app.state.signal_repo = None
    # Per-vision visions to ingest. Default to the 3 reference visions;
    # M44 adds fusion-power-grid-parity to this list.
    if not hasattr(app.state, "signal_ingest_visions"):
        env_list = os.environ.get("SIGNAL_INGEST_VISIONS", "").strip()
        if env_list:
            app.state.signal_ingest_visions = [
                s.strip() for s in env_list.split(",") if s.strip()
            ]
        else:
            app.state.signal_ingest_visions = [
                "space-data-center",
                "memory-semi",
                "sofc",
            ]
    app.state.throttle_ms = int(os.environ.get("INGEST_THROTTLE_MS", "200"))
    app.state.financials_quarters = int(
        os.environ.get("REFRESH_FINANCIALS_QUARTERS", str(_DEFAULT_FINANCIALS_QUARTERS))
    )

    scheduler: AsyncIOScheduler | None = None
    if os.environ.get("INGEST_SCHEDULE", "on").lower() != "off":
        scheduler = AsyncIOScheduler(timezone="UTC")

        # Daily quote refresh.
        cron = os.environ.get("INGEST_CRON_QUOTES", _DEFAULT_CRON)
        try:
            trigger = CronTrigger.from_crontab(cron, timezone="UTC")
        except ValueError as e:
            log.error("data-pipeline: bad INGEST_CRON_QUOTES=%r (%s)", cron, e)
        else:
            scheduler.add_job(
                _run_refresh_job,
                trigger=trigger,
                kwargs={"app": app},
                id="refresh_quotes_daily",
                replace_existing=True,
            )
            log.info("data-pipeline: quote-refresh armed (cron=%r UTC)", cron)

        # Weekly financials refresh (M10c).
        fin_cron = os.environ.get("REFRESH_FINANCIALS_CRON", _DEFAULT_FINANCIALS_CRON)
        try:
            fin_trigger = CronTrigger.from_crontab(fin_cron, timezone="UTC")
        except ValueError as e:
            log.error("data-pipeline: bad REFRESH_FINANCIALS_CRON=%r (%s)", fin_cron, e)
        else:
            scheduler.add_job(
                _run_refresh_financials_job,
                trigger=fin_trigger,
                kwargs={"app": app},
                id="refresh_financials_weekly",
                replace_existing=True,
            )
            log.info("data-pipeline: financials-refresh armed (cron=%r UTC)", fin_cron)

        # Daily prediction resolution (M33b).
        resolve_cron = os.environ.get(
            "RESOLVE_PREDICTIONS_CRON", _DEFAULT_RESOLVE_PREDICTIONS_CRON
        )
        try:
            resolve_trigger = CronTrigger.from_crontab(resolve_cron, timezone="UTC")
        except ValueError as e:
            log.error(
                "data-pipeline: bad RESOLVE_PREDICTIONS_CRON=%r (%s)", resolve_cron, e
            )
        else:
            scheduler.add_job(
                _run_resolve_predictions_job,
                trigger=resolve_trigger,
                kwargs={"app": app},
                id="resolve_predictions_daily",
                replace_existing=True,
            )
            log.info(
                "data-pipeline: predictions-resolve armed (cron=%r UTC)", resolve_cron
            )

        # M39c — signal ingest cron. Skip if signal_repo couldn't connect
        # (DATABASE_URL missing → app.state.signal_repo is None).
        if (
            app.state.signal_repo is not None
            and os.environ.get("SIGNAL_INGEST_SCHEDULE", "on").lower() != "off"
        ):
            sig_cron = os.environ.get(
                "SIGNAL_INGEST_CRON_DAILY", _DEFAULT_SIGNAL_INGEST_CRON
            )
            try:
                sig_trigger = CronTrigger.from_crontab(sig_cron, timezone="UTC")
            except ValueError as e:
                log.error(
                    "data-pipeline: bad SIGNAL_INGEST_CRON_DAILY=%r (%s)",
                    sig_cron,
                    e,
                )
            else:
                scheduler.add_job(
                    _run_signal_ingest_job,
                    trigger=sig_trigger,
                    kwargs={"app": app},
                    id="signal_ingest_daily",
                    replace_existing=True,
                )
                log.info(
                    "data-pipeline: signal-ingest armed (cron=%r UTC)", sig_cron
                )

        if scheduler.get_jobs():
            scheduler.start()
        else:
            log.warning("data-pipeline: no scheduler jobs were registered")
            scheduler = None
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
        resolver_repo = getattr(app.state, "resolver_repo", None)
        if resolver_repo is not None:
            await resolver_repo.close()


async def _run_refresh_job(*, app: FastAPI) -> RefreshQuotesResult:
    repo: EquityRepository = app.state.repo
    source: DataSource = app.state.source
    throttle = int(app.state.throttle_ms)
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=throttle)
    app.state.last_result = result
    return result


async def _run_resolve_predictions_job(*, app: FastAPI) -> ResolvePredictionsResult:
    repo: PredictionResolverRepository = app.state.resolver_repo
    result = await resolve_due_predictions(repo=repo)
    app.state.last_resolve_result = result
    return result


async def _run_refresh_financials_job(*, app: FastAPI) -> RefreshFinancialsResult:
    repo: EquityRepository = app.state.repo
    us: FinancialsSource = app.state.us_financials
    kr: FinancialsSource | None = app.state.kr_financials
    throttle = int(app.state.throttle_ms)
    quarters = int(app.state.financials_quarters)
    result = await refresh_financials(
        us_source=us,
        kr_source=kr,
        repo=repo,
        quarters=quarters,
        throttle_ms=throttle,
    )
    app.state.last_financials_result = result
    return result


async def _run_signal_ingest_job(*, app: FastAPI):  # noqa: ANN201
    """M39c — daily signal ingest. Drives arXiv (+ M39d NewsAPI + M39e
    USPTO when those ship) through the SignalExtractor agent, writing
    rows to signals.
    """
    from data_pipeline.jobs.signal_ingest import run_signal_ingest

    repo = app.state.signal_repo
    if repo is None:
        log.warning("signal-ingest: repo not configured — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions
    stats = await run_signal_ingest(sector_slugs=visions, repo=repo)
    app.state.last_signal_ingest_result = stats
    return stats


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
        last_fin: RefreshFinancialsResult | None = getattr(
            app.state, "last_financials_result", None
        )
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        next_runs: dict[str, str | None] = {}
        if scheduler is not None:
            for job in scheduler.get_jobs():
                next_runs[job.id] = (
                    job.next_run_time.isoformat() if job.next_run_time else None
                )
        last_resolve: ResolvePredictionsResult | None = getattr(
            app.state, "last_resolve_result", None
        )
        return {
            "status": "ok",
            "now": datetime.now(UTC).isoformat(),
            "scheduler_armed": scheduler is not None,
            "next_runs": next_runs,
            "last_refresh": last.model_dump(mode="json") if last is not None else None,
            "last_financials_refresh": last_fin.model_dump(mode="json") if last_fin is not None else None,
            "last_resolve_predictions": last_resolve.model_dump(mode="json")
            if last_resolve is not None
            else None,
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

    @app.post(
        "/jobs/refresh-financials",
        response_model=RefreshFinancialsResult,
    )
    async def trigger_refresh_financials(quarters: int = _DEFAULT_FINANCIALS_QUARTERS) -> RefreshFinancialsResult:
        log.info(
            "data-pipeline: manual /jobs/refresh-financials triggered (quarters=%d)",
            quarters,
        )
        # Allow per-call override of the configured quarters via query
        # string; routing + sources still come from app.state.
        repo: EquityRepository = app.state.repo
        us: FinancialsSource = app.state.us_financials
        kr: FinancialsSource | None = app.state.kr_financials
        throttle = int(app.state.throttle_ms)
        result = await refresh_financials(
            us_source=us,
            kr_source=kr,
            repo=repo,
            quarters=quarters,
            throttle_ms=throttle,
        )
        app.state.last_financials_result = result
        return result

    @app.get(
        "/jobs/refresh-financials/last",
        response_model=RefreshFinancialsResult,
    )
    async def last_financials_refresh() -> RefreshFinancialsResult:
        last: RefreshFinancialsResult | None = getattr(
            app.state, "last_financials_result", None
        )
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no financials refresh has run since the process started",
            )
        return last

    @app.post(
        "/jobs/resolve-predictions",
        response_model=ResolvePredictionsResult,
    )
    async def trigger_resolve_predictions() -> ResolvePredictionsResult:
        log.info("data-pipeline: manual /jobs/resolve-predictions triggered")
        return await _run_resolve_predictions_job(app=app)

    @app.get(
        "/jobs/resolve-predictions/last",
        response_model=ResolvePredictionsResult,
    )
    async def last_resolve_predictions() -> ResolvePredictionsResult:
        last: ResolvePredictionsResult | None = getattr(
            app.state, "last_resolve_result", None
        )
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no prediction-resolve has run since the process started",
            )
        return last

    # M39c — signal ingest manual + last endpoints.
    @app.post("/jobs/signal-ingest")
    async def manual_signal_ingest() -> dict:  # noqa: ANN201
        if app.state.signal_repo is None:
            raise HTTPException(
                status_code=503,
                detail="signal_ingest unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/signal-ingest triggered")
        stats = await _run_signal_ingest_job(app=app)
        if stats is None:
            raise HTTPException(status_code=503, detail="signal_ingest skipped")
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

    @app.get("/jobs/signal-ingest/last")
    async def last_signal_ingest() -> dict:  # noqa: ANN201
        last = app.state.last_signal_ingest_result
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no signal-ingest has run since the process started",
            )
        return {
            "started_at": last.started_at.isoformat(),
            "finished_at": last.finished_at.isoformat() if last.finished_at else None,
            "visions_processed": last.visions_processed,
            "capabilities_processed": last.capabilities_processed,
            "raw_signals_fetched": last.raw_signals_fetched,
            "extractor_calls": last.extractor_calls,
            "extractor_failures": last.extractor_failures,
            "signals_written": last.signals_written,
            "extractor_total_cost_usd": last.extractor_total_cost_usd,
            "errors": last.errors,
        }

    return app


app = create_app()
