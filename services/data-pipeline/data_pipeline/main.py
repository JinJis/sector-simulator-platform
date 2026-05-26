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
from pydantic import BaseModel, Field

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
from data_pipeline.jobs.resolve_predictions_v2 import (
    ResolvePredictionsV2Result,
    resolve_due_predictions_v2,
)
from data_pipeline.prediction_repo import (
    PredictionResolverRepository,
    build_resolver_repository,
)
from data_pipeline.prediction2_repo import (
    PredictionV2ResolverRepository,
    build_resolver_v2_repository,
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


def _legacy_investment_enabled() -> bool:
    """M43 — gate legacy investment-frame crons behind a single flag.

    Default `false` means the data-pipeline doesn't run the financials
    refresh (EDGAR/DART) or the legacy v1 prediction resolver — those
    surfaces are archived. PredictionV2 resolver + quote refresh
    (used by V2's anchor + vol calc) stay on regardless.

    Flip `ENABLE_LEGACY_INVESTMENT_FEATURES=true` to revive the legacy
    crons for backtest / migration / debugging.
    """
    return os.environ.get(
        "ENABLE_LEGACY_INVESTMENT_FEATURES", "false"
    ).lower() in {"1", "true", "yes", "on"}
# M46b — PredictionV2 resolver runs hourly so a 1-day prediction
# placed at 10:00 UTC resolves the morning after the next-day close
# lands in equity_quotes, instead of waiting until the next 09:00 UTC
# tick.
_DEFAULT_RESOLVE_PREDICTIONS_V2_CRON = "5 * * * *"

# M39c — signal ingest cron. 09:00 UTC = 18:00 KST daily (after KOSPI
# close / few hours after US news cycle). Separate env so it can be
# scheduled independently of the legacy equity cron family.
_DEFAULT_SIGNAL_INGEST_CRON = "0 9 * * *"

# M40b — recompute_feasibility cron. 09:30 UTC = 30 min after signal
# ingest so the freshly-written signals have time to settle before the
# score updater reads them.
_DEFAULT_FEASIBILITY_RECOMPUTE_CRON = "30 9 * * *"


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
    if not hasattr(app.state, "resolver_v2_repo"):
        # M46b — PredictionV2 resolver. Same DATABASE_URL but separate
        # pool to isolate from the legacy resolver. Tests pre-set
        # `app.state.resolver_v2_repo` to inject an in-memory backing.
        try:
            app.state.resolver_v2_repo = await build_resolver_v2_repository(
                os.environ.get("DATABASE_URL")
            )
        except RuntimeError:
            log.warning(
                "data-pipeline: DATABASE_URL unset — prediction-v2 resolver disabled"
            )
            app.state.resolver_v2_repo = None
    if not hasattr(app.state, "last_resolve_v2_result"):
        app.state.last_resolve_v2_result = None
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
    if not hasattr(app.state, "last_feasibility_recompute_result"):
        app.state.last_feasibility_recompute_result = None
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

        # M43 — Weekly financials refresh (M10c) gated behind the legacy
        # investment flag. EDGAR/DART pull is investment-frame; PredictionV2
        # doesn't use it.
        if _legacy_investment_enabled():
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
        else:
            log.info(
                "data-pipeline: financials-refresh SKIPPED "
                "(ENABLE_LEGACY_INVESTMENT_FEATURES=false)"
            )

        # M43 — Legacy v1 prediction resolver (M33b) also gated. PredictionV2
        # resolver (below, M46b) is the active one.
        if _legacy_investment_enabled():
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
        else:
            log.info(
                "data-pipeline: legacy predictions-resolve SKIPPED "
                "(ENABLE_LEGACY_INVESTMENT_FEATURES=false). PredictionV2 still runs."
            )

        # M46b — hourly PredictionV2 resolver. Skipped when DATABASE_URL
        # is absent (`resolver_v2_repo is None`) so dev compose without
        # a DB doesn't error-loop.
        if app.state.resolver_v2_repo is not None:
            resolve_v2_cron = os.environ.get(
                "RESOLVE_PREDICTIONS_V2_CRON",
                _DEFAULT_RESOLVE_PREDICTIONS_V2_CRON,
            )
            try:
                resolve_v2_trigger = CronTrigger.from_crontab(
                    resolve_v2_cron, timezone="UTC"
                )
            except ValueError as e:
                log.error(
                    "data-pipeline: bad RESOLVE_PREDICTIONS_V2_CRON=%r (%s)",
                    resolve_v2_cron,
                    e,
                )
            else:
                scheduler.add_job(
                    _run_resolve_predictions_v2_job,
                    trigger=resolve_v2_trigger,
                    kwargs={"app": app},
                    id="resolve_predictions_v2_hourly",
                    replace_existing=True,
                )
                log.info(
                    "data-pipeline: predictions-v2-resolve armed (cron=%r UTC)",
                    resolve_v2_cron,
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

            # M40b — recompute_feasibility, runs 30 min after signal-ingest.
            rf_cron = os.environ.get(
                "FEASIBILITY_RECOMPUTE_CRON", _DEFAULT_FEASIBILITY_RECOMPUTE_CRON
            )
            try:
                rf_trigger = CronTrigger.from_crontab(rf_cron, timezone="UTC")
            except ValueError as e:
                log.error(
                    "data-pipeline: bad FEASIBILITY_RECOMPUTE_CRON=%r (%s)",
                    rf_cron,
                    e,
                )
            else:
                scheduler.add_job(
                    _run_recompute_feasibility_job,
                    trigger=rf_trigger,
                    kwargs={"app": app},
                    id="recompute_feasibility_daily",
                    replace_existing=True,
                )
                log.info(
                    "data-pipeline: feasibility-recompute armed (cron=%r UTC)",
                    rf_cron,
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
        resolver_v2_repo = getattr(app.state, "resolver_v2_repo", None)
        if resolver_v2_repo is not None:
            await resolver_v2_repo.close()


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


async def _run_resolve_predictions_v2_job(
    *, app: FastAPI
) -> ResolvePredictionsV2Result | None:
    """M46b — band-based prediction resolver. Runs hourly so 1D/1W
    bets resolve as soon as the corresponding EquityQuote row lands."""
    repo: PredictionV2ResolverRepository | None = app.state.resolver_v2_repo
    if repo is None:
        log.warning("resolve_predictions_v2: repo not configured — skipping")
        return None
    result = await resolve_due_predictions_v2(repo=repo)
    app.state.last_resolve_v2_result = result
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


class SignalIngestScopeRequest(BaseModel):
    """M49c — scoped trigger body for /jobs/signal-ingest/scope.

    The crawler orchestrator picks one (vision × capability) per tick
    based on its binding × stale × cost ranking; this request lets it
    push exactly that scope into the existing M39 pipeline without
    waiting on the full-vision daily sweep.
    """

    sector_slug: str = Field(..., min_length=1, max_length=128)
    # None / empty → ingest every capability with a keyword entry (same
    # behavior as the unscoped endpoint).
    capability_keys: list[str] | None = Field(default=None, max_length=50)
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


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


async def _run_recompute_feasibility_job(*, app: FastAPI):  # noqa: ANN201
    """M40b — daily feasibility recompute. Calls ScoreUpdater agent per
    capability, then triggers sim-service vision-level aggregation."""
    from data_pipeline.jobs.recompute_feasibility import run_recompute_feasibility

    repo = app.state.signal_repo
    if repo is None:
        log.warning("recompute-feasibility: repo not configured — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions
    stats = await run_recompute_feasibility(sector_slugs=visions, repo=repo)
    app.state.last_feasibility_recompute_result = stats
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

    # ---- M46b PredictionV2 resolver ---------------------------------
    @app.post(
        "/jobs/resolve-predictions-v2",
        response_model=ResolvePredictionsV2Result,
    )
    async def trigger_resolve_predictions_v2() -> ResolvePredictionsV2Result:
        if app.state.resolver_v2_repo is None:
            raise HTTPException(
                status_code=503,
                detail="prediction-v2 resolver unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/resolve-predictions-v2 triggered")
        result = await _run_resolve_predictions_v2_job(app=app)
        if result is None:
            raise HTTPException(status_code=503, detail="prediction-v2 resolver skipped")
        return result

    @app.get(
        "/jobs/resolve-predictions-v2/last",
        response_model=ResolvePredictionsV2Result,
    )
    async def last_resolve_predictions_v2() -> ResolvePredictionsV2Result:
        last: ResolvePredictionsV2Result | None = getattr(
            app.state, "last_resolve_v2_result", None
        )
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no prediction-v2 resolve has run since process start",
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

    @app.post("/jobs/signal-ingest/scope")
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
        from data_pipeline.jobs.signal_ingest import run_signal_ingest

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
        # Mirror the legacy /jobs/signal-ingest payload so both endpoints
        # are interchangeable for consumers.
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

    # M40b — feasibility recompute manual + last endpoints.
    @app.post("/jobs/recompute-feasibility")
    async def manual_recompute_feasibility() -> dict:  # noqa: ANN201
        if app.state.signal_repo is None:
            raise HTTPException(
                status_code=503,
                detail="recompute-feasibility unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/recompute-feasibility triggered")
        stats = await _run_recompute_feasibility_job(app=app)
        if stats is None:
            raise HTTPException(
                status_code=503, detail="recompute-feasibility skipped"
            )
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

    @app.get("/jobs/recompute-feasibility/last")
    async def last_recompute_feasibility() -> dict:  # noqa: ANN201
        last = app.state.last_feasibility_recompute_result
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no feasibility-recompute has run since the process started",
            )
        return {
            "started_at": last.started_at.isoformat(),
            "finished_at": last.finished_at.isoformat() if last.finished_at else None,
            "visions_processed": last.visions_processed,
            "capabilities_processed": last.capabilities_processed,
            "score_updater_calls": last.score_updater_calls,
            "score_updater_failures": last.score_updater_failures,
            "score_writes": last.score_writes,
            "score_writes_skipped_low_confidence": last.score_writes_skipped_low_confidence,
            "feasibility_writes": last.feasibility_writes,
            "score_updater_total_cost_usd": last.score_updater_total_cost_usd,
            "errors": last.errors,
        }

    return app


app = create_app()
