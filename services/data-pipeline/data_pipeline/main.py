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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from data_pipeline.adapters.base import DataSource
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import YFinanceSource
from data_pipeline.agents import (
    HttpAgentClient,
    default_agent_orchestration_url,
)
from data_pipeline.api import (
    feasibility as api_feasibility,
    fetchers as api_fetchers,
    health as api_health,
    jobs as api_jobs,
    orchestrator as api_orchestrator,
    predictions as api_predictions,
    refresh as api_refresh,
    signals as api_signals,
)
from data_pipeline.crawl_run_repo import (
    PostgresCrawlRunRepository,
)
from data_pipeline.db.actor_reader import PostgresActorReader
from data_pipeline.db.capability_reader import PostgresCapabilityReader
from data_pipeline.db.discovery_reader import PostgresDiscoveryReader
from data_pipeline.db.orchestrator_repo import PostgresOrchestratorReader
from data_pipeline.db.proposal_writer import PostgresProposalWriter
from data_pipeline.db.risk_reader import PostgresRiskReader
from data_pipeline.db.signal_writer import PostgresSignalWriter
from data_pipeline.queue import (
    build_queue_client,
)
from data_pipeline.jobs.runners import (
    run_digest_daily_job,
    run_news_ingest_5min,
    run_orchestrator_tick_job,
    run_recompute_feasibility_job,
    run_refresh_job,
    run_research_ingest_hourly,
    run_resolve_predictions_v2_job,
)
from data_pipeline.jobs.signal_ingest import IngestStats, run_signal_ingest
from data_pipeline.prediction2_repo import build_resolver_v2_repository
from data_pipeline.repo import build_repository

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
                run_refresh_job,
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
                    run_resolve_predictions_v2_job,
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
            # ── news_ingest_5min: keyword-driven Google News RSS (default)
            # or per-ticker crawl4ai (Yahoo/Naver/Finviz) when
            # NEWS_INGEST_USE_CRAWL4AI=1. Ticker lookup reads
            # actors.ticker via SignalRepository.list_vision_tickers —
            # no static map fallback. NEWS_INGEST_SCHEDULE=off disables.
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
                    run_news_ingest_5min,
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
                        run_research_ingest_hourly,
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
                    run_recompute_feasibility_job,
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
                        run_digest_daily_job,
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
                run_orchestrator_tick_job,
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


def _build_grounded_research_client() -> GroundedResearchClient | None:
    """Construct a GroundedResearchClient backed by google-genai with
    the google_search grounding tool. Models resolve through the same
    ``LLM_FAST_MODEL`` / ``LLM_DEEP_MODEL`` env vars the agent
    LLMClient uses (defaults: gemini-3.1-flash-lite / gemini-3.1-pro-
    preview); grounded research and agent tiers stay in lockstep.

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

    app.include_router(api_health.create_router(app))
    app.include_router(api_refresh.create_router(app))
    app.include_router(api_predictions.create_router(app))
    app.include_router(api_signals.create_router(app))
    app.include_router(api_feasibility.create_router(app))
    app.include_router(api_fetchers.create_router(app))
    app.include_router(api_orchestrator.create_router(app))
    app.include_router(api_jobs.create_router(app))

    return app


app = create_app()
