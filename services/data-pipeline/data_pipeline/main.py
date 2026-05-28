"""data-pipeline FastAPI app.

Endpoints:
- GET  /health                            → liveness + last-run telemetry
- POST /jobs/refresh-quotes               → daily snapshot refresh
- GET  /jobs/refresh-quotes/last
- POST /jobs/refresh-quote-history        → daily-bar window refresh
- GET  /jobs/refresh-quote-history/last
- POST /jobs/signal-ingest                → manual full M39 sweep
- POST /jobs/signal-ingest/scope          → scoped to one vision × cap
- POST /jobs/recompute-feasibility        → ScoreUpdater per capability
- POST /jobs/resolve-predictions-v2       → M46b resolver
- POST /fetchers/{capability,actor,risk,signal,hello-world}/run
- POST /jobs/orchestrator/tick            → M49f opportunistic picker
- POST /jobs/discovery/run                → M50 bot proposal sweep
- GET  /jobs/runs[/{id}]                  → CrawlRun history

Scheduler (APScheduler AsyncIOScheduler, UTC):
  refresh_quotes_daily             — `INGEST_CRON_QUOTES` (08:30 UTC default)
  resolve_predictions_v2_hourly    — `RESOLVE_PREDICTIONS_V2_CRON` (5 * * * *)
  news_ingest_5min                 — every 5 min; armed when NEWSAPI_KEY set
  research_ingest_hourly           — arXiv + USPTO sweep at :07 past
  recompute_feasibility_hourly     — ScoreUpdater rollup at :25 past
  orchestrator_tick_15min          — M49f picker; gated `ORCHESTRATOR_SCHEDULE`
  Disabled entirely when `INGEST_SCHEDULE=off`.

Configuration (env):
  DATABASE_URL                  — required
  INGEST_SOURCE                 — `yfinance` (default) or `fake` for smoke
  INGEST_THROTTLE_MS            — between-symbol sleep (default 200)
  INGEST_CRON_QUOTES            — quote-refresh cron
  INGEST_SCHEDULE               — set to `off` to disable the scheduler
  NEWSAPI_KEY                   — arms news_ingest_5min when present
  NEWS_INGEST_SCHEDULE          — `on` (default when key set) / `off`
  RESEARCH_INGEST_SCHEDULE      — `on` (default) / `off`
  ORCHESTRATOR_SCHEDULE         — `off` (default); accepts CRAWLER_SCHEDULE alias
  RESOLVE_PREDICTIONS_V2_CRON   — defaults to hourly
  LOG_LEVEL                     — default INFO
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from agent_tools import GroundedResearchClient
from apscheduler.events import (
    EVENT_JOB_ERROR,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_MAX_INSTANCES,
    EVENT_JOB_MISSED,
    EVENT_JOB_SUBMITTED,
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data_pipeline.adapters.base import DataSource
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import YFinanceSource
from data_pipeline.agents import (
    AgentClient,
    HttpAgentClient,
    default_agent_orchestration_url,
)
from data_pipeline.crawl_run_repo import (
    CrawlRunRepository,
    CrawlRunRow,
    PostgresCrawlRunRepository,
)
from data_pipeline.db.actor_reader import ActorReader, PostgresActorReader
from data_pipeline.db.capability_reader import CapabilityReader, PostgresCapabilityReader
from data_pipeline.db.discovery_reader import DiscoveryReader, PostgresDiscoveryReader
from data_pipeline.db.orchestrator_repo import OrchestratorReader, PostgresOrchestratorReader
from data_pipeline.db.proposal_writer import PostgresProposalWriter, ProposalWriter
from data_pipeline.db.risk_reader import PostgresRiskReader, RiskReader
from data_pipeline.db.signal_writer import PostgresSignalWriter, SignalWriter
from data_pipeline.deep_research.digest import (
    DigestError,
    DigestRequest,
    enqueue_deep_research_digest,
    run_deep_research_digest,
)
from data_pipeline.deep_research.discovery.runner import run_discovery
from data_pipeline.deep_research.dispatcher import DispatcherClients, dispatch_tick
from data_pipeline.deep_research.fetchers.actor import (
    ActorFetcherError,
    ActorFetchRequest,
    enqueue_actor_fetcher,
    run_actor_fetcher,
)
from data_pipeline.deep_research.fetchers.capability import (
    CapabilityFetcherError,
    CapabilityFetchRequest,
    enqueue_capability_fetcher,
    run_capability_fetcher,
)
from data_pipeline.deep_research.fetchers.hello_world import (
    HelloWorldRunRequest,
    enqueue_hello_world,
    run_hello_world,
)
from data_pipeline.deep_research.fetchers.risk import (
    RiskFetcherError,
    RiskFetchRequest,
    enqueue_risk_fetcher,
    run_risk_fetcher,
)
from data_pipeline.deep_research.fetchers.signal import (
    SignalFetcherError,
    SignalFetchRequest,
    SignalIngestFn,
    enqueue_signal_fetcher,
    run_signal_fetcher,
)
from data_pipeline.queue import (
    QueueClient,
    QueueDepthSnapshot,
    build_queue_client,
)
from data_pipeline.queue.client import (
    TASK_ACTOR,
    TASK_CAPABILITY,
    TASK_DIGEST,
    TASK_HELLO_WORLD,
    TASK_RISK,
    TASK_SIGNAL,
)
from data_pipeline.deep_research.orchestrator import pick_for_tick
from data_pipeline.jobs.refresh_quote_history import (
    RefreshHistoryResult,
    refresh_quote_history,
)
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult, refresh_quotes
from data_pipeline.jobs.resolve_predictions_v2 import (
    ResolvePredictionsV2Result,
    resolve_due_predictions_v2,
)
from data_pipeline.jobs.signal_ingest import IngestStats, run_signal_ingest
from data_pipeline.prediction2_repo import (
    PredictionV2ResolverRepository,
    build_resolver_v2_repository,
)
from data_pipeline.repo import EquityRepository, build_repository
from data_pipeline.signals import (
    ArxivSource,
    Crawl4aiFinvizSource,
    Crawl4aiNaverSource,
    Crawl4aiYahooSource,
    GoogleNewsSource,
    UsptoSource,
)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("data_pipeline")

_DEFAULT_CRON = "30 8 * * *"  # 08:30 UTC = 17:30 KST
# M46b — PredictionV2 resolver runs hourly so a 1-day prediction placed
# at 10:00 UTC resolves the morning after the next-day close lands in
# equity_quotes.
_DEFAULT_RESOLVE_PREDICTIONS_V2_CRON = "5 * * * *"


def _build_source() -> DataSource:
    name = os.environ.get("INGEST_SOURCE", "yfinance").lower()
    if name == "fake":
        log.warning("data-pipeline: using FakeSource — only smoke-test data!")
        return FakeSource()
    return YFinanceSource()


_KNOWN_PIPELINE_ENVS = {
    "INGEST_SCHEDULE",
    "INGEST_SOURCE",
    "INGEST_CRON_QUOTES",
    "INGEST_THROTTLE_MS",
    "NEWS_INGEST_SCHEDULE",
    "NEWS_INGEST_INTERVAL_MIN",
    "RESEARCH_INGEST_SCHEDULE",
    "RESEARCH_INGEST_CRON",
    "RECOMPUTE_FEASIBILITY_CRON",
    "ORCHESTRATOR_SCHEDULE",
    "ORCHESTRATOR_INTERVAL_MIN",
    "CRAWLER_SCHEDULE",  # deprecated alias
    "DIGEST_SCHEDULE",
    "DIGEST_CRON",
    "RESOLVE_PREDICTIONS_V2_CRON",
    "ENABLE_USPTO",
}


def _warn_on_suspicious_env() -> None:
    """Surface typo'd ingest env vars at boot. The operator's .env in
    the M56 verification had six leading-`i` typos
    (`iNEWS_INGEST_INTERVAL_MIN`, etc.) that silently no-op'd — env
    vars are case + spelling exact, no validation. This best-effort
    check matches obvious near-misses (single-char prefix typos, the
    most common shape) and prints a WARNING so the operator catches it
    before they wonder why crons aren't honoring the override."""
    suspicious: list[tuple[str, str]] = []
    for key in os.environ:
        # Strip a single non-letter prefix char (most common typo) and
        # see if the remainder matches a known env. Catches "iNEWS_…"
        # without flagging legitimate "OS_…"/"HOME"/etc.
        if len(key) > 1 and not key[0].isupper() and key[1:].isupper():
            candidate = key[1:]
            if candidate in _KNOWN_PIPELINE_ENVS:
                suspicious.append((key, candidate))
    for bad, good in suspicious:
        log.warning(
            "data-pipeline: env var %r looks like a typo of %r — value is "
            "being ignored. Fix the .env entry; otherwise the cron stays "
            "on its default cadence.",
            bad,
            good,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    _warn_on_suspicious_env()
    # Allow tests to pre-wire these.
    if not hasattr(app.state, "repo"):
        repo = await build_repository(os.environ.get("DATABASE_URL"))
        app.state.repo = repo
    if not hasattr(app.state, "resolver_v2_repo"):
        # M46b — PredictionV2 resolver. Separate pool from `repo` so a
        # long-running refresh-quotes job doesn't starve the resolver.
        # Tests pre-set `app.state.resolver_v2_repo` to inject an
        # in-memory backing.
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
    if not hasattr(app.state, "last_result"):
        app.state.last_result = None
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

    # ------------------------------------------------------------------
    # Crawler-side bootstrap (merged from crawler/main.py in commit 3/6).
    # crawl_runs_repo owns its own asyncpg pool; the per-fetcher readers
    # share that pool to stay at one connection bucket for the crawler
    # side of the service.
    # ------------------------------------------------------------------
    if not hasattr(app.state, "crawl_runs_repo"):
        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            try:
                app.state.crawl_runs_repo = await PostgresCrawlRunRepository.connect(dsn)
            except Exception as exc:
                log.error("data-pipeline: crawl_runs_repo connect failed: %s", exc)
                app.state.crawl_runs_repo = None
        else:
            log.warning(
                "data-pipeline: DATABASE_URL unset — crawler fetchers disabled"
            )
            app.state.crawl_runs_repo = None

    if not hasattr(app.state, "deep_research"):
        app.state.deep_research = _build_grounded_research_client()

    crawl_repo = getattr(app.state, "crawl_runs_repo", None)
    crawl_pool = crawl_repo.pool if isinstance(crawl_repo, PostgresCrawlRunRepository) else None

    if not hasattr(app.state, "capability_reader"):
        app.state.capability_reader = (
            PostgresCapabilityReader(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "signal_writer"):
        app.state.signal_writer = (
            PostgresSignalWriter(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "actor_reader"):
        app.state.actor_reader = (
            PostgresActorReader(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "risk_reader"):
        app.state.risk_reader = (
            PostgresRiskReader(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "orchestrator_reader"):
        app.state.orchestrator_reader = (
            PostgresOrchestratorReader(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "discovery_reader"):
        app.state.discovery_reader = (
            PostgresDiscoveryReader(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "proposal_writer"):
        app.state.proposal_writer = (
            PostgresProposalWriter(crawl_pool) if crawl_pool is not None else None
        )
    if not hasattr(app.state, "bot_user_id"):
        if crawl_pool is not None:
            row = await crawl_pool.fetchrow(
                "SELECT id FROM users WHERE bot_kind = 'research_agent' AND is_bot = true LIMIT 1"
            )
            app.state.bot_user_id = row["id"] if row is not None else None
            if app.state.bot_user_id is None:
                log.warning(
                    "data-pipeline: no @feasibility_bot user found — discovery "
                    "endpoint will 503 until `pnpm db:seed` runs"
                )
        else:
            app.state.bot_user_id = None

    if not hasattr(app.state, "agent_client"):
        base = default_agent_orchestration_url()
        if base:
            app.state.agent_client = HttpAgentClient(base_url=base)
        else:
            log.warning(
                "data-pipeline: AGENT_ORCHESTRATION_URL unset — SignalExtractor "
                "unreachable; capability/actor/risk fetchers will 503"
            )
            app.state.agent_client = None

    # ARQ queue client — used by the /fetchers/*/run endpoints to
    # enqueue jobs onto the data-pipeline-worker pool. Degrades to
    # None when REDIS_URL is unset (then the trigger endpoints 503
    # with a clear "queue unavailable" message rather than blocking).
    if not hasattr(app.state, "queue_client"):
        try:
            app.state.queue_client = await build_queue_client()
            log.info("data-pipeline: queue_client connected")
        except Exception as exc:  # noqa: BLE001
            log.error(
                "data-pipeline: queue_client connect failed — fetcher "
                "triggers will 503 (%s)",
                exc,
            )
            app.state.queue_client = None

    # In-process signal-ingest closure. Reuses signal_repo (already
    # initialized above) — no new pool. SignalFetcher invokes this
    # instead of the legacy HTTP hop.
    if not hasattr(app.state, "signal_ingest_fn"):
        sig_repo = app.state.signal_repo
        if sig_repo is not None:
            async def _signal_ingest_scoped(
                vision_slug: str,
                capability_keys: list[str],
                lookback_days: int,
                per_capability_limit: int,
            ) -> IngestStats:
                return await run_signal_ingest(
                    sector_slugs=[vision_slug],
                    repo=sig_repo,
                    capability_keys=capability_keys,
                    lookback_days=lookback_days,
                    per_capability_limit=per_capability_limit,
                )
            app.state.signal_ingest_fn = _signal_ingest_scoped
        else:
            app.state.signal_ingest_fn = None
    if not hasattr(app.state, "last_orchestrator_tick"):
        app.state.last_orchestrator_tick = None

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

        # Tiered signal ingest (commit 4/6 — merger). Replaces the prior
        # single signal_ingest_daily cron with three independently-gated
        # jobs so news rotates quickly while research papers / patents
        # run on a slower cadence that matches their publication rate.
        if app.state.signal_repo is not None:
            # ── news_ingest_5min: crawl4ai Yahoo + Naver + Finviz news
            # sweep every 5 min. Per-vision ticker map in
            # data_pipeline/signals/tickers.py controls which symbols
            # each vision pulls; crawl4ai handles JS-rendered lists.
            # NEWS_INGEST_SCHEDULE=off disables.
            news_armed = (
                os.environ.get("NEWS_INGEST_SCHEDULE", "on").lower() != "off"
            )
            if news_armed:
                # NEWS_INGEST_INTERVAL_MIN lets local dev fire every 1 min
                # to validate the queue → worker → CrawlRun chain end-to-end
                # without waiting 5 min. Float-parsed so 0.5 is allowed.
                news_interval = float(
                    os.environ.get("NEWS_INGEST_INTERVAL_MIN", "5")
                )
                scheduler.add_job(
                    _run_news_ingest_5min,
                    trigger=IntervalTrigger(minutes=news_interval),
                    kwargs={"app": app},
                    id="news_ingest_5min",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
                log.info(
                    "data-pipeline: news_ingest_5min armed (every %s min)",
                    news_interval,
                )
            else:
                log.info(
                    "data-pipeline: news_ingest_5min disabled "
                    "(NEWSAPI_KEY unset or NEWS_INGEST_SCHEDULE=off)"
                )

            # ── research_ingest_hourly: arXiv + USPTO at :07 past.
            # 7-min offset spreads load away from `:00` where most
            # crons cluster.
            if os.environ.get("RESEARCH_INGEST_SCHEDULE", "on").lower() != "off":
                research_cron = os.environ.get("RESEARCH_INGEST_CRON", "7 * * * *")
                try:
                    research_trigger = CronTrigger.from_crontab(
                        research_cron, timezone="UTC"
                    )
                except ValueError as e:
                    log.error(
                        "data-pipeline: bad RESEARCH_INGEST_CRON=%r (%s)",
                        research_cron,
                        e,
                    )
                else:
                    scheduler.add_job(
                        _run_research_ingest_hourly,
                        trigger=research_trigger,
                        kwargs={"app": app},
                        id="research_ingest_hourly",
                        replace_existing=True,
                        max_instances=1,
                        coalesce=True,
                    )
                    log.info(
                        "data-pipeline: research_ingest_hourly armed (cron=%r UTC)",
                        research_cron,
                    )
            else:
                log.info(
                    "data-pipeline: research_ingest_hourly disabled "
                    "(RESEARCH_INGEST_SCHEDULE=off)"
                )

            # ── recompute_feasibility_hourly: 18 min after the research
            # sweep so freshly-written signals have time to settle
            # before ScoreUpdater reads them. Override via
            # RECOMPUTE_FEASIBILITY_CRON for local testing (e.g.,
            # "*/2 * * * *" for every 2 min).
            recompute_cron = os.environ.get("RECOMPUTE_FEASIBILITY_CRON", "25 * * * *")
            try:
                recompute_trigger = CronTrigger.from_crontab(
                    recompute_cron, timezone="UTC"
                )
            except ValueError as e:
                log.error(
                    "data-pipeline: bad RECOMPUTE_FEASIBILITY_CRON=%r (%s)",
                    recompute_cron,
                    e,
                )
            else:
                scheduler.add_job(
                    _run_recompute_feasibility_job,
                    trigger=recompute_trigger,
                    kwargs={"app": app},
                    id="recompute_feasibility_hourly",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
                log.info(
                    "data-pipeline: recompute_feasibility_hourly armed (cron=%r UTC)",
                    recompute_cron,
                )

            # ── digest_daily: grounded gemini synthesis per vision.
            # DIGEST_SCHEDULE=off (default) keeps it manual-only so
            # operators validate cost/quality before turning on per-
            # vision daily billing (~$0.30/run × N visions).
            digest_mode = os.environ.get("DIGEST_SCHEDULE", "off").lower()
            if digest_mode != "off":
                # 06:00 UTC = 15:00 KST — after Asia opens digest the
                # overnight US news cycle.
                digest_cron = os.environ.get("DIGEST_CRON", "0 6 * * *")
                try:
                    digest_trigger = CronTrigger.from_crontab(
                        digest_cron, timezone="UTC"
                    )
                except ValueError as e:
                    log.error("data-pipeline: bad DIGEST_CRON=%r (%s)", digest_cron, e)
                else:
                    scheduler.add_job(
                        _run_digest_daily_job,
                        trigger=digest_trigger,
                        kwargs={"app": app},
                        id="digest_daily",
                        replace_existing=True,
                        max_instances=1,
                        coalesce=True,
                    )
                    log.info(
                        "data-pipeline: digest_daily armed (cron=%r UTC)",
                        digest_cron,
                    )
            else:
                log.info(
                    "data-pipeline: digest_daily disabled "
                    "(DIGEST_SCHEDULE=off) — use POST /jobs/deep-research-digest/run "
                    "for manual triggers"
                )

        # M49f — orchestrator opportunistic picker. 15-min interval.
        # ORCHESTRATOR_SCHEDULE (new) or CRAWLER_SCHEDULE (legacy
        # alias from the standalone crawler service); default off so
        # dev/CI doesn't burn LLM budget.
        orch_mode = os.environ.get(
            "ORCHESTRATOR_SCHEDULE",
            os.environ.get("CRAWLER_SCHEDULE", "off"),
        ).lower()
        if orch_mode != "off" and app.state.crawl_runs_repo is not None:
            orch_interval = float(
                os.environ.get("ORCHESTRATOR_INTERVAL_MIN", "15")
            )
            scheduler.add_job(
                _run_orchestrator_tick_job,
                trigger=IntervalTrigger(minutes=orch_interval),
                kwargs={"app": app},
                id="orchestrator_tick_15min",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            log.info(
                "data-pipeline: orchestrator cron armed (every %s min) — schedule=%s",
                orch_interval,
                orch_mode,
            )
        elif orch_mode == "off":
            log.info(
                "data-pipeline: orchestrator cron disabled — "
                "use POST /jobs/orchestrator/tick for manual runs"
            )

        if scheduler.get_jobs():
            # Wire the cron-history buffer BEFORE start() so the very
            # first job firing is captured. The buffer is read by the
            # SQLAdmin Queue + Crons page so an operator can verify
            # crons are actually firing (and what their last output was)
            # without grepping `docker logs`.
            from data_pipeline.admin.cron_history import (  # noqa: PLC0415
                CronHistoryBuffer,
            )

            history = CronHistoryBuffer()
            app.state.cron_history = history

            def _on_event(event: Any) -> None:
                code = event.code
                if code == EVENT_JOB_SUBMITTED:
                    history.on_submitted(event.job_id)
                elif code == EVENT_JOB_EXECUTED:
                    history.on_executed(event.job_id, getattr(event, "retval", None))
                elif code == EVENT_JOB_ERROR:
                    history.on_error(
                        event.job_id, getattr(event, "exception", None)
                    )
                elif code == EVENT_JOB_MISSED:
                    history.on_missed(
                        event.job_id, getattr(event, "scheduled_run_time", None)
                    )
                elif code == EVENT_JOB_MAX_INSTANCES:
                    history.on_max_instances(event.job_id)

            scheduler.add_listener(
                _on_event,
                EVENT_JOB_SUBMITTED
                | EVENT_JOB_EXECUTED
                | EVENT_JOB_ERROR
                | EVENT_JOB_MISSED
                | EVENT_JOB_MAX_INSTANCES,
            )
            scheduler.start()
        else:
            log.warning("data-pipeline: no scheduler jobs were registered")
            scheduler = None
    else:
        log.info("data-pipeline: scheduler disabled by INGEST_SCHEDULE=off")
    app.state.scheduler = scheduler
    if not hasattr(app.state, "cron_history"):
        # Always set the attr so SQLAdmin can read it safely even with
        # INGEST_SCHEDULE=off — empty buffer renders "no runs yet".
        from data_pipeline.admin.cron_history import (  # noqa: PLC0415
            CronHistoryBuffer,
        )

        app.state.cron_history = CronHistoryBuffer()

    log.info("data-pipeline ready")
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        repo = getattr(app.state, "repo", None)
        if repo is not None:
            await repo.close()
        resolver_v2_repo = getattr(app.state, "resolver_v2_repo", None)
        if resolver_v2_repo is not None:
            await resolver_v2_repo.close()
        crawl_runs_repo = getattr(app.state, "crawl_runs_repo", None)
        if isinstance(crawl_runs_repo, PostgresCrawlRunRepository):
            await crawl_runs_repo.close()
        queue_client = getattr(app.state, "queue_client", None)
        if queue_client is not None:
            await queue_client.close()


async def _run_refresh_job(*, app: FastAPI) -> RefreshQuotesResult:
    repo: EquityRepository = app.state.repo
    source: DataSource = app.state.source
    throttle = int(app.state.throttle_ms)
    log.info(
        "[cron refresh_quotes] START source=%s throttle_ms=%d",
        type(source).__name__,
        throttle,
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=throttle)
    app.state.last_result = result
    log.info("[cron refresh_quotes] DONE %s", result.model_dump())
    return result


async def _run_resolve_predictions_v2_job(
    *, app: FastAPI
) -> ResolvePredictionsV2Result | None:
    """M46b — band-based prediction resolver. Runs hourly so 1D/1W
    bets resolve as soon as the corresponding EquityQuote row lands."""
    repo: PredictionV2ResolverRepository | None = app.state.resolver_v2_repo
    if repo is None:
        log.warning("[cron resolve_predictions_v2] repo not configured — skipping")
        return None
    log.info("[cron resolve_predictions_v2] START")
    result = await resolve_due_predictions_v2(repo=repo)
    app.state.last_resolve_v2_result = result
    log.info("[cron resolve_predictions_v2] DONE %s", result.model_dump())
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
    """Manual / full-sweep signal ingest. All 3 M39 sources across every
    vision. POST /jobs/signal-ingest invokes this; the tiered crons
    below use `_run_news_ingest_5min` + `_run_research_ingest_hourly`
    instead so news rotates fast and research stays hourly."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("signal-ingest: repo not configured — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions
    stats = await run_signal_ingest(sector_slugs=visions, repo=repo)
    app.state.last_signal_ingest_result = stats
    return stats


async def _run_news_ingest_5min(*, app: FastAPI):  # noqa: ANN201
    """Tier 1 — fast-rotation news sweep. Default: Google News RSS
    (keyword-driven, capability-relevant). Set NEWS_INGEST_USE_CRAWL4AI=1
    to use the original ticker-page crawlers (Yahoo + Naver + Finviz)
    instead — those return investor-noise mostly, but cover Korean
    sources Google News thin-coverage's."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron news_ingest_5min] signal_repo unset — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions

    use_crawl4ai = os.environ.get("NEWS_INGEST_USE_CRAWL4AI", "").lower() in {
        "1", "true", "yes", "on",
    }
    if use_crawl4ai:
        async def db_ticker_provider(sector_slug: str):  # noqa: ANN202
            from data_pipeline.signals.tickers import (  # noqa: PLC0415
                tickers_for,
            )

            db_tickers = await repo.list_vision_tickers(sector_slug)
            if db_tickers.us or db_tickers.kr:
                return db_tickers
            return tickers_for(sector_slug)

        sources = [
            Crawl4aiYahooSource(ticker_provider=db_ticker_provider),
            Crawl4aiFinvizSource(ticker_provider=db_ticker_provider),
            Crawl4aiNaverSource(ticker_provider=db_ticker_provider),
        ]
    else:
        # Keyword-driven Google News RSS — matches the operator's
        # capability keyword set directly (no ticker indirection).
        sources = [GoogleNewsSource()]
    log.info(
        "[cron news_ingest_5min] START visions=%s sources=%s",
        ",".join(visions) or "<none>",
        ",".join(s.name for s in sources),
    )

    stats = await run_signal_ingest(
        sector_slugs=visions,
        repo=repo,
        sources=sources,
        # Tight lookback — we're rotating every 5 min, no need to look
        # back days.
        lookback_days=1,
        per_capability_limit=10,
    )
    app.state.last_signal_ingest_result = stats
    log.info(
        "[cron news_ingest_5min] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


async def _run_research_ingest_hourly(*, app: FastAPI):  # noqa: ANN201
    """Tier 2 — hourly research sweep (commit 4/6). arXiv + USPTO
    across every vision. Publication cadence on those sources is
    measured in days, so 1 hour is generous; offset to :07 past keeps
    load away from `:00` where most crons cluster."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron research_ingest_hourly] signal_repo unset — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions
    # USPTO disabled (M56-4) — operator can't authenticate against the
    # API. Set ENABLE_USPTO=1 in .env to re-arm; otherwise arxiv-only.
    # The adapter file stays on disk for the eventual re-enable.
    sources = [ArxivSource()]
    if os.environ.get("ENABLE_USPTO", "").lower() in {"1", "true", "yes", "on"}:
        sources.append(UsptoSource())
    # Widened default lookback to 7d (was 3d) — fusion/memory/sofc are
    # low-publication-rate fields where 3d returns 0 hits most ticks.
    # Override via env for local testing (e.g., 30 to backfill).
    lookback_days = int(os.environ.get("RESEARCH_INGEST_LOOKBACK_DAYS", "7"))
    log.info(
        "[cron research_ingest_hourly] START visions=%s sources=%s lookback=%dd",
        ",".join(visions) or "<none>",
        ",".join(s.name for s in sources),
        lookback_days,
    )
    stats = await run_signal_ingest(
        sector_slugs=visions,
        repo=repo,
        sources=sources,
        lookback_days=lookback_days,
        per_capability_limit=10,
    )
    app.state.last_signal_ingest_result = stats
    log.info(
        "[cron research_ingest_hourly] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


async def _run_digest_daily_job(*, app: FastAPI):  # noqa: ANN201
    """Daily grounded-research digest sweep — one signal per vision.
    Each call hits the Vertex grounded gemini (DEEP tier) once, so the
    daily cost is roughly $0.30 × N visions. Per-vision errors are
    logged + swallowed so one bad vision doesn't kill the rest."""
    repo = getattr(app.state, "crawl_runs_repo", None)
    sig_repo = getattr(app.state, "signal_repo", None)
    writer = getattr(app.state, "signal_writer", None)
    dr = getattr(app.state, "deep_research", None)
    agent = getattr(app.state, "agent_client", None)
    if any(x is None for x in (repo, sig_repo, writer, dr, agent)):
        log.warning(
            "[cron digest_daily] missing dep(s) — skipping "
            "(crawl_runs=%s signal_repo=%s writer=%s dr=%s agent=%s)",
            *[("on" if x is not None else "off") for x in (repo, sig_repo, writer, dr, agent)],
        )
        return None
    visions: list[str] = app.state.signal_ingest_visions
    # Pre-filter to visions that actually have capabilities — the digest
    # anchors itself on one capability per vision, and on an empty
    # vision the inner check fails + writes an error crawl_run. Cron
    # runs every minute (or hourly) so without this pre-filter the
    # cockpit fills with `error: no_capabilities_for_vision` noise on
    # every tick. Manual SQLAdmin triggers bypass this gate (operator
    # gets a clear error row when they hit a misconfigured vision).
    eligible: list[str] = []
    skipped: list[str] = []
    for slug in visions:
        caps = await sig_repo.list_vision_capabilities(slug)
        if caps:
            eligible.append(slug)
        else:
            skipped.append(slug)
    if skipped:
        log.info(
            "[cron digest_daily] skipping %d vision(s) with no capabilities: %s",
            len(skipped),
            ",".join(skipped),
        )
    log.info(
        "[cron digest_daily] START visions=%s",
        ",".join(eligible) or "<none>",
    )
    ok = err = 0
    for slug in eligible:
        log.info("[cron digest_daily] vision=%s — calling DR digest", slug)
        try:
            await run_deep_research_digest(
                DigestRequest(vision_slug=slug),
                runs_repo=repo,
                signal_repo=sig_repo,
                signal_writer=writer,
                deep_research=dr,
                agent_client=agent,
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001
            log.error("[cron digest_daily] vision=%s failed: %s", slug, exc)
            err += 1
    log.info(
        "[cron digest_daily] DONE ok=%d err=%d skipped=%d visions=%d",
        ok,
        err,
        len(skipped),
        len(visions),
    )
    return {
        "ok": ok,
        "err": err,
        "skipped_no_capabilities": len(skipped),
        "visions": len(visions),
    }


async def _run_recompute_feasibility_job(*, app: FastAPI):  # noqa: ANN201
    """Hourly feasibility recompute (commit 4/6). Calls ScoreUpdater
    agent per capability, then triggers sim-service vision-level
    aggregation. Was daily before the merger — moves to hourly so the
    5-min news + hourly research signals roll into FeasibilityIndex
    within the hour."""
    from data_pipeline.jobs.recompute_feasibility import run_recompute_feasibility

    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron recompute_feasibility] repo not configured — skipping")
        return None
    visions: list[str] = app.state.signal_ingest_visions
    log.info(
        "[cron recompute_feasibility] START visions=%s",
        ",".join(visions) or "<none>",
    )
    stats = await run_recompute_feasibility(sector_slugs=visions, repo=repo)
    app.state.last_feasibility_recompute_result = stats
    log.info(
        "[cron recompute_feasibility] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


# --------------------------------------------------------------------------
# Crawler-side Pydantic shapes (merged from services/crawler/crawler/main.py
# in the data-pipeline merger, commit 3/6). Names + fields preserved so
# admin cockpit + tRPC schema don't need a deploy in lockstep.
# --------------------------------------------------------------------------


# Serialize a `@dataclass(frozen=True, slots=True)` FetchRequest into a
# msgpack-safe dict for ARQ's wire format. Worker side rehydrates via
# `Request(**dict)`. Keeping this in one place so adding a field to a
# request doesn't require touching the queue producer + consumer
# separately.
def _request_to_dict(req: Any) -> dict[str, Any]:
    from dataclasses import asdict, is_dataclass  # noqa: PLC0415

    if is_dataclass(req):
        return asdict(req)
    return dict(req)


class CrawlRunOut(BaseModel):
    id: str
    vision_slug: str
    fetcher_kind: str
    status: str
    plan: dict[str, Any]
    result_summary: dict[str, Any] | None
    cost_usd: float | None
    signals_written: int
    proposals_written: int
    error: str | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def from_row(cls, row: CrawlRunRow) -> CrawlRunOut:
        return cls(
            id=row.id,
            vision_slug=row.vision_slug,
            fetcher_kind=row.fetcher_kind,
            status=row.status,
            plan=row.plan,
            result_summary=row.result_summary,
            cost_usd=row.cost_usd,
            signals_written=row.signals_written,
            proposals_written=row.proposals_written,
            error=row.error,
            started_at=row.started_at,
            ended_at=row.ended_at,
        )


class HelloWorldTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = None


class HelloWorldTriggerOut(BaseModel):
    run: CrawlRunOut
    cached: bool


class CapabilityTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    capability_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class CapabilityTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None


class ActorTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    actor_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class ActorTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None
    matched_actor_key: str | None
    primary_capability_key: str | None


class SignalTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    capability_key: str = Field(..., min_length=1, max_length=128)
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


class SignalTriggerOut(BaseModel):
    run: CrawlRunOut
    raw_signals_fetched: int
    signals_written: int
    extractor_failures: int
    extractor_total_cost_usd: float


class RiskTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    risk_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class RiskTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None
    primary_capability_key: str | None
    risk_severity: str
    risk_likelihood: str


class OrchestratorCandidateOut(BaseModel):
    vision_slug: str
    fetcher_kind: str
    key: str
    anchor_composite: float | None
    stale_hours: float
    estimated_cost_usd: float
    ranking_score: float


class OrchestratorTickBody(BaseModel):
    pinned_visions: list[str] | None = Field(default=None, max_length=50)


class OrchestratorTickOut(BaseModel):
    dry_run: bool
    total_candidates: int
    over_budget_skipped: int
    picked: list[OrchestratorCandidateOut]
    per_vision_remaining_usd: dict[str, float]
    dispatch_summary: dict[str, Any] | None = None


class DigestRunBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class DigestRunOut(BaseModel):
    run: CrawlRunOut
    anchor_capability_key: str | None
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None


class DiscoveryRunBody(BaseModel):
    vision_slugs: list[str] | None = Field(default=None, max_length=50)
    min_signal_count: int = Field(default=2, ge=1, le=20)
    lookback_days: int = Field(default=7, ge=1, le=30)
    fuzzy_threshold: float = Field(default=0.92, ge=0.5, le=1.0)


class DiscoveryRunOut(BaseModel):
    summary: dict[str, Any]


def _build_grounded_research_client() -> GroundedResearchClient | None:
    """Construct a GroundedResearchClient backed by google-genai with
    the google_search grounding tool. Models default to gemini-2.5-flash
    (fast tier) and gemini-3.1-pro-preview (deep tier); both are
    env-overridable via GROUNDED_MODEL_FAST / GROUNDED_MODEL_DEEP.

    Vertex AI auth is preferred (SA JSON). AI Studio (GEMINI_API_KEY)
    also works for the gemini-* family — we'll fall back to it when
    Vertex env isn't set."""
    try:
        from google import genai  # noqa: PLC0415  (optional dep)
    except ImportError:
        log.warning("data-pipeline: google-genai not installed — grounded research disabled")
        return None

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()

    # Vertex AI path (preferred — same SA other services use).
    if use_vertex and creds:
        if not os.path.exists(creds):
            log.error(
                "data-pipeline: grounded research disabled — SA JSON not "
                "found at %s. Drop a Vertex AI service-account key at "
                "infra/secrets/vertex-ai-sa.json on the host (see "
                "infra/secrets/README.md).",
                creds,
            )
            return None
        try:
            client = genai.Client(
                vertexai=True,
                location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            )
        except Exception as exc:  # pragma: no cover — exercised in compose
            log.error(
                "data-pipeline: Vertex AI client construction failed (%s). "
                "Verify GOOGLE_CLOUD_PROJECT + the SA's roles/aiplatform.user grant.",
                exc,
            )
            return None
        log.info("data-pipeline: grounded research via Vertex AI (sa=%s)", creds)
        return GroundedResearchClient(genai_client=client)

    # AI Studio fallback — works for gemini-* family.
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
        except Exception as exc:  # pragma: no cover
            log.error("data-pipeline: AI Studio client construction failed: %s", exc)
            return None
        log.info("data-pipeline: grounded research via AI Studio (GEMINI_API_KEY)")
        return GroundedResearchClient(genai_client=client)

    log.warning(
        "data-pipeline: grounded research disabled — neither Vertex "
        "(GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_APPLICATION_CREDENTIALS) "
        "nor AI Studio (GEMINI_API_KEY) is configured. Fetcher endpoints "
        "will 503."
    )
    return None


async def _run_orchestrator_tick_job(*, app: FastAPI) -> None:
    """Cron entrypoint (M49f) — wraps pick_for_tick + dispatch_tick with
    full client wiring from app.state. Logs + swallows errors so a bad
    tick doesn't kill the scheduler."""
    reader = getattr(app.state, "orchestrator_reader", None)
    if reader is None:
        log.warning("[cron orchestrator_tick] orchestrator_reader unset — skipping tick")
        return
    log.info("[cron orchestrator_tick] START")
    try:
        pick = await pick_for_tick(reader=reader)
        if not pick.picked:
            log.info(
                "[cron orchestrator_tick] DONE picked=0 candidates=%d over_budget=%d",
                pick.total_candidates,
                pick.over_budget_skipped,
            )
            return
        log.info(
            "[cron orchestrator_tick] picked %d/%d (over_budget=%d) — dispatching",
            len(pick.picked),
            pick.total_candidates,
            pick.over_budget_skipped,
        )
        deps = [
            getattr(app.state, "crawl_runs_repo", None),
            getattr(app.state, "deep_research", None),
            getattr(app.state, "agent_client", None),
            getattr(app.state, "capability_reader", None),
            getattr(app.state, "actor_reader", None),
            getattr(app.state, "risk_reader", None),
            getattr(app.state, "signal_writer", None),
            getattr(app.state, "signal_ingest_fn", None),
        ]
        if any(d is None for d in deps):
            log.warning(
                "[cron orchestrator_tick] missing dep(s) — skipping dispatch "
                "(runs=%s dr=%s agent=%s cap=%s actor=%s risk=%s writer=%s ingest_fn=%s)",
                *["on" if d is not None else "off" for d in deps],
            )
            return
        clients = DispatcherClients(
            runs_repo=deps[0],
            capability_reader=deps[3],
            actor_reader=deps[4],
            risk_reader=deps[5],
            signal_writer=deps[6],
            deep_research=deps[1],
            agent_client=deps[2],
            signal_ingest_fn=deps[7],
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        app.state.last_orchestrator_tick = summary.to_summary_dict()
    except Exception as exc:  # noqa: BLE001
        log.error("[cron orchestrator_tick] tick failed: %s", exc)


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

    # M55 — SQLAdmin replaces apps/admin/ Next.js app. Mount before any
    # other route so SQLAdmin's static-file routes shadow nothing.
    from data_pipeline.admin import mount_admin  # noqa: PLC0415

    mount_admin(app)

    @app.get("/health")
    def health() -> dict[str, Any]:
        last: RefreshQuotesResult | None = getattr(app.state, "last_result", None)
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        next_runs: dict[str, str | None] = {}
        if scheduler is not None:
            for job in scheduler.get_jobs():
                next_runs[job.id] = (
                    job.next_run_time.isoformat() if job.next_run_time else None
                )
        return {
            "status": "ok",
            "now": datetime.now(UTC).isoformat(),
            "scheduler_armed": scheduler is not None,
            "next_runs": next_runs,
            "last_refresh": last.model_dump(mode="json") if last is not None else None,
            # Merged crawler readiness flags (commit 3/6). Cockpit chips
            # at /admin/crawler read this same shape.
            "ready": {
                "repo": getattr(app.state, "crawl_runs_repo", None) is not None,
                "deep_research": getattr(app.state, "deep_research", None) is not None,
                "agent_client": getattr(app.state, "agent_client", None) is not None,
                "signal_repo": getattr(app.state, "signal_repo", None) is not None,
            },
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

    # ------------------------------------------------------------------
    # Crawler-side endpoints (merged from crawler/main.py in commit 3/6).
    # ------------------------------------------------------------------

    def _require_crawl_repo() -> CrawlRunRepository:
        repo = getattr(app.state, "crawl_runs_repo", None)
        if repo is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — DATABASE_URL not configured",
            )
        return repo

    def _require_deep_research() -> GroundedResearchClient:
        dr = getattr(app.state, "deep_research", None)
        if dr is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Grounded research not configured. Two auth paths supported "
                    "(env-driven): "
                    "(A) Vertex AI — drop a Vertex SA JSON at "
                    "infra/secrets/vertex-ai-sa.json + set GOOGLE_GENAI_USE_VERTEXAI=true + "
                    "GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json in .env. "
                    "(B) AI Studio — set GEMINI_API_KEY in .env. "
                    "Restart the data-pipeline container after either."
                ),
            )
        return dr

    def _require_capability_reader() -> CapabilityReader:
        r = getattr(app.state, "capability_reader", None)
        if r is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — capability_reader not configured (DATABASE_URL)",
            )
        return r

    def _require_actor_reader() -> ActorReader:
        r = getattr(app.state, "actor_reader", None)
        if r is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — actor_reader not configured (DATABASE_URL)",
            )
        return r

    def _require_risk_reader() -> RiskReader:
        r = getattr(app.state, "risk_reader", None)
        if r is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — risk_reader not configured (DATABASE_URL)",
            )
        return r

    def _require_orchestrator_reader() -> OrchestratorReader:
        r = getattr(app.state, "orchestrator_reader", None)
        if r is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — orchestrator_reader not configured (DATABASE_URL)",
            )
        return r

    def _require_discovery_reader() -> DiscoveryReader:
        r = getattr(app.state, "discovery_reader", None)
        if r is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — discovery_reader not configured",
            )
        return r

    def _require_proposal_writer() -> ProposalWriter:
        w = getattr(app.state, "proposal_writer", None)
        if w is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — proposal_writer not configured",
            )
        return w

    def _require_bot_user_id() -> str:
        bot_id = getattr(app.state, "bot_user_id", None)
        if not bot_id:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — no @feasibility_bot user; run `pnpm db:seed`",
            )
        return bot_id

    def _require_signal_writer() -> SignalWriter:
        w = getattr(app.state, "signal_writer", None)
        if w is None:
            raise HTTPException(
                status_code=503,
                detail="data-pipeline unavailable — signal_writer not configured (DATABASE_URL)",
            )
        return w

    def _require_agent_client() -> AgentClient:
        c = getattr(app.state, "agent_client", None)
        if c is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "data-pipeline unavailable — AGENT_ORCHESTRATION_URL not configured "
                    "(SignalExtractor unreachable)"
                ),
            )
        return c

    def _require_signal_ingest_fn() -> SignalIngestFn:
        fn = getattr(app.state, "signal_ingest_fn", None)
        if fn is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "data-pipeline unavailable — DATABASE_URL not configured "
                    "(SignalFetcher needs signal_repo to run M39 ingest)"
                ),
            )
        return fn

    def _require_queue() -> QueueClient:
        q = getattr(app.state, "queue_client", None)
        if q is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "data-pipeline unavailable — REDIS_URL not configured "
                    "or Redis unreachable (no worker queue)"
                ),
            )
        return q

    @app.post("/fetchers/capability/run", response_model=CapabilityTriggerOut)
    async def capability_run(body: CapabilityTriggerBody) -> CapabilityTriggerOut:
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info(
            "capability enqueued vision=%s cap=%s", body.vision_slug, body.capability_key
        )
        req = CapabilityFetchRequest(
            vision_slug=body.vision_slug,
            capability_key=body.capability_key,
            prompt=body.prompt,
        )
        run = await enqueue_capability_fetcher(req, runs_repo=repo)
        await queue.enqueue(
            TASK_CAPABILITY, run.id, _request_to_dict(req), job_id=run.id
        )
        return CapabilityTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
        )

    @app.post("/fetchers/actor/run", response_model=ActorTriggerOut)
    async def actor_run(body: ActorTriggerBody) -> ActorTriggerOut:
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info(
            "actor enqueued vision=%s actor=%s", body.vision_slug, body.actor_key
        )
        req = ActorFetchRequest(
            vision_slug=body.vision_slug,
            actor_key=body.actor_key,
            prompt=body.prompt,
        )
        run = await enqueue_actor_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_ACTOR, run.id, _request_to_dict(req), job_id=run.id)
        return ActorTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
            matched_actor_key=None,
            primary_capability_key=None,
        )

    @app.post("/fetchers/risk/run", response_model=RiskTriggerOut)
    async def risk_run(body: RiskTriggerBody) -> RiskTriggerOut:
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info("risk enqueued vision=%s risk=%s", body.vision_slug, body.risk_key)
        req = RiskFetchRequest(
            vision_slug=body.vision_slug,
            risk_key=body.risk_key,
            prompt=body.prompt,
        )
        run = await enqueue_risk_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_RISK, run.id, _request_to_dict(req), job_id=run.id)
        return RiskTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
            primary_capability_key=None,
            risk_severity="unknown",
            risk_likelihood="unknown",
        )

    @app.post("/fetchers/signal/run", response_model=SignalTriggerOut)
    async def signal_run(body: SignalTriggerBody) -> SignalTriggerOut:
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info("signal enqueued vision=%s cap=%s", body.vision_slug, body.capability_key)
        req = SignalFetchRequest(
            vision_slug=body.vision_slug,
            capability_key=body.capability_key,
            lookback_days=body.lookback_days,
            per_capability_limit=body.per_capability_limit,
        )
        run = await enqueue_signal_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_SIGNAL, run.id, _request_to_dict(req), job_id=run.id)
        return SignalTriggerOut(
            run=CrawlRunOut.from_row(run),
            raw_signals_fetched=0,
            signals_written=0,
            extractor_failures=0,
            extractor_total_cost_usd=0.0,
        )

    @app.post("/fetchers/hello-world/run", response_model=HelloWorldTriggerOut)
    async def hello_world_run(body: HelloWorldTriggerBody) -> HelloWorldTriggerOut:
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info("hello-world enqueued vision=%s", body.vision_slug)
        req = HelloWorldRunRequest(
            vision_slug=body.vision_slug, prompt=body.prompt
        )
        run = await enqueue_hello_world(req, repo=repo)
        await queue.enqueue(
            TASK_HELLO_WORLD, run.id, _request_to_dict(req), job_id=run.id
        )
        return HelloWorldTriggerOut(
            run=CrawlRunOut.from_row(run),
            cached=False,
        )

    @app.post("/jobs/orchestrator/tick", response_model=OrchestratorTickOut)
    async def orchestrator_tick(
        body: OrchestratorTickBody | None = None,
        dry_run: bool = True,
    ) -> OrchestratorTickOut:
        reader = _require_orchestrator_reader()
        pinned = set(body.pinned_visions) if body and body.pinned_visions else set()
        pick = await pick_for_tick(reader=reader, pinned_visions=pinned)

        picked_out = [
            OrchestratorCandidateOut(
                vision_slug=c.vision_slug,
                fetcher_kind=c.fetcher_kind,
                key=c.key,
                anchor_composite=c.anchor_composite,
                stale_hours=round(c.stale_hours, 2),
                estimated_cost_usd=round(c.estimated_cost_usd, 4),
                ranking_score=round(c.ranking_score, 2),
            )
            for c in pick.picked
        ]

        if dry_run:
            return OrchestratorTickOut(
                dry_run=True,
                total_candidates=pick.total_candidates,
                over_budget_skipped=pick.over_budget_skipped,
                picked=picked_out,
                per_vision_remaining_usd={
                    k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
                },
                dispatch_summary=None,
            )

        repo = _require_crawl_repo()
        dr = _require_deep_research()
        agent = _require_agent_client()
        cap_reader = _require_capability_reader()
        actor_reader = _require_actor_reader()
        risk_reader = _require_risk_reader()
        writer = _require_signal_writer()
        signal_ingest_fn = _require_signal_ingest_fn()
        clients = DispatcherClients(
            runs_repo=repo,
            capability_reader=cap_reader,
            actor_reader=actor_reader,
            risk_reader=risk_reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
            signal_ingest_fn=signal_ingest_fn,
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        return OrchestratorTickOut(
            dry_run=False,
            total_candidates=pick.total_candidates,
            over_budget_skipped=pick.over_budget_skipped,
            picked=picked_out,
            per_vision_remaining_usd={
                k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
            },
            dispatch_summary=summary.to_summary_dict(),
        )

    @app.post("/jobs/deep-research-digest/run", response_model=DigestRunOut)
    async def deep_research_digest_run(body: DigestRunBody) -> DigestRunOut:
        """Daily-style industry/macro Deep Research digest per vision.
        Manual-only at this commit — no cron arming. Writes one signal
        row anchored on the vision's first capability with
        source_kind='research_brief' + source_url='internal://digest/
        {vision}/{YYYY-MM-DD}' so re-runs the same day dedupe."""
        repo = _require_crawl_repo()
        queue = _require_queue()
        log.info(
            "deep-research-digest enqueued vision=%s", body.vision_slug
        )
        req = DigestRequest(vision_slug=body.vision_slug, prompt=body.prompt)
        run = await enqueue_deep_research_digest(req, runs_repo=repo)
        await queue.enqueue(TASK_DIGEST, run.id, _request_to_dict(req), job_id=run.id)
        return DigestRunOut(
            run=CrawlRunOut.from_row(run),
            anchor_capability_key=None,
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
        )

    @app.get("/queue/status")
    async def queue_status() -> dict[str, Any]:
        """Lightweight introspection for the cockpit Queue tab —
        current depth, in-flight, worker count. Returns degraded
        snapshot (all zeros + `available: false`) when Redis can't
        be reached, so the panel renders an "offline" indicator
        rather than crashing."""
        q = getattr(app.state, "queue_client", None)
        if q is None:
            return {
                "available": False,
                "queue_name": "",
                "queued": 0,
                "in_progress": 0,
                "workers": 0,
                "deferred": 0,
            }
        snap = await q.snapshot()
        return {
            "available": True,
            "queue_name": snap.queue_name,
            "queued": snap.queued,
            "in_progress": snap.in_progress,
            "workers": snap.workers,
            "deferred": snap.deferred,
        }

    @app.post("/jobs/discovery/run", response_model=DiscoveryRunOut)
    async def discovery_run(body: DiscoveryRunBody | None = None) -> DiscoveryRunOut:
        discovery_reader = _require_discovery_reader()
        proposal_writer = _require_proposal_writer()
        bot_id = _require_bot_user_id()
        body = body or DiscoveryRunBody()

        slugs = body.vision_slugs
        if not slugs:
            orch_reader = _require_orchestrator_reader()
            slugs = await orch_reader.list_vision_slugs()
        summary = await run_discovery(
            sector_slugs=slugs,
            reader=discovery_reader,
            writer=proposal_writer,
            bot_user_id=bot_id,
            min_signal_count=body.min_signal_count,
            lookback_days=body.lookback_days,
            fuzzy_threshold=body.fuzzy_threshold,
        )
        return DiscoveryRunOut(summary=summary.to_dict())

    @app.get("/jobs/runs", response_model=list[CrawlRunOut])
    async def list_runs(
        vision: str | None = Query(None, alias="vision"),
        fetcher: str | None = Query(None, alias="fetcher"),
        status: str | None = Query(None, alias="status"),
        limit: int = Query(50, ge=1, le=200),
    ) -> list[CrawlRunOut]:
        repo = _require_crawl_repo()
        rows = await repo.list_recent(
            vision_slug=vision,
            fetcher_kind=fetcher,
            status=status,
            limit=limit,
        )
        return [CrawlRunOut.from_row(r) for r in rows]

    @app.get("/jobs/runs/{run_id}", response_model=CrawlRunOut)
    async def get_run(run_id: str) -> CrawlRunOut:
        repo = _require_crawl_repo()
        row = await repo.get(run_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"run {run_id} not found")
        return CrawlRunOut.from_row(row)

    return app


app = create_app()
