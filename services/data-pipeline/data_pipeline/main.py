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

import asyncpg
from agent_tools import (
    EnvSeedKey,
    GroundedResearchClient,
    InMemoryJobConfigStore,
    PostgresJobConfigStore,
    seed_from_env,
)
from apscheduler.events import (
    EVENT_JOB_ERROR,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_MAX_INSTANCES,
    EVENT_JOB_MISSED,
    EVENT_JOB_SUBMITTED,
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
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
)
from data_pipeline.api import (
    fetchers as api_fetchers,
)
from data_pipeline.api import (
    health as api_health,
)
from data_pipeline.api import (
    jobs as api_jobs,
)
from data_pipeline.api import (
    orchestrator as api_orchestrator,
)
from data_pipeline.api import (
    predictions as api_predictions,
)
from data_pipeline.api import (
    refresh as api_refresh,
)
from data_pipeline.api import (
    signals as api_signals,
)
from data_pipeline.crawl_run_repo import (
    PostgresCrawlRunRepository,
)
from data_pipeline.cron_specs import (
    CRON_SPECS,
    build_trigger,
    enabled_key,
    schedule_key,
)
from data_pipeline.db.actor_reader import PostgresActorReader
from data_pipeline.db.capability_reader import PostgresCapabilityReader
from data_pipeline.db.discovery_reader import PostgresDiscoveryReader
from data_pipeline.db.orchestrator_repo import PostgresOrchestratorReader
from data_pipeline.db.proposal_writer import PostgresProposalWriter
from data_pipeline.db.risk_reader import PostgresRiskReader
from data_pipeline.db.signal_writer import PostgresSignalWriter
from data_pipeline.jobs.runners import (
    run_digest_daily_job,
    run_marketing_digest_job,
    run_news_ingest_5min,
    run_orchestrator_tick_job,
    run_recompute_feasibility_job,
    run_refresh_job,
    run_research_ingest_hourly,
    run_resolve_predictions_v2_job,
)
from data_pipeline.jobs.signal_ingest import IngestStats, run_signal_ingest
from data_pipeline.prediction2_repo import build_resolver_v2_repository
from data_pipeline.queue import (
    build_queue_client,
)
from data_pipeline.repo import build_repository

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("data_pipeline")


# Per-cron runtime prereqs. None means "always register"; the string
# values name app.state attrs that must be not-None for the runner to
# function. The boot loop in `lifespan` skips registration when the
# prereq slot is None (e.g. DATABASE_URL unset → no signal_repo).
_cron_prereq_attr: dict[str, str | None] = {
    "refresh_quotes_daily": None,
    "resolve_predictions_v2_hourly": "resolver_v2_repo",
    "news_ingest_5min": "signal_repo",
    "research_ingest_hourly": "signal_repo",
    "recompute_feasibility_hourly": "signal_repo",
    "digest_daily": "signal_repo",
    "marketing_digest_daily": "signal_repo",
    "orchestrator_tick_15min": "crawl_runs_repo",
}

# id → runner function. Module-level so the boot loop doesn't have to
# rebuild the dict per process and ruff stops flagging it as a
# constant inside a function.
_cron_runner: dict[str, Any] = {
    "refresh_quotes_daily": run_refresh_job,
    "resolve_predictions_v2_hourly": run_resolve_predictions_v2_job,
    "news_ingest_5min": run_news_ingest_5min,
    "research_ingest_hourly": run_research_ingest_hourly,
    "recompute_feasibility_hourly": run_recompute_feasibility_job,
    "digest_daily": run_digest_daily_job,
    "marketing_digest_daily": run_marketing_digest_job,
    "orchestrator_tick_15min": run_orchestrator_tick_job,
}

def _build_source() -> DataSource:
    name = os.environ.get("INGEST_SOURCE", "yfinance").lower()
    if name == "fake":
        log.warning("data-pipeline: using FakeSource — only smoke-test data!")
        return FakeSource()
    return YFinanceSource()


# Schedule on/off + cron expressions / intervals all live in
# `job_configs` after slice 14. The remaining env vars are operational
# knobs that still drive runner behavior (USPTO toggle, signal source,
# throttle) — those are slice 12c+ scope.
_KNOWN_PIPELINE_ENVS = {
    "INGEST_SOURCE",
    "INGEST_THROTTLE_MS",
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
    if not hasattr(app.state, "last_marketing_digest_result"):
        app.state.last_marketing_digest_result = None
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

    # JobConfigStore — DB-backed source of truth for per-cron enabled
    # flags (and, in later slices, cron expressions / interval values
    # / LLM model overrides). Falls back to in-memory when DATABASE_URL
    # is absent so the boot loop below doesn't need conditionals.
    if not hasattr(app.state, "job_config"):
        if dsn := os.environ.get("DATABASE_URL"):
            try:
                jc_pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
                app.state.job_config = PostgresJobConfigStore(jc_pool)
                app.state._job_config_pool = jc_pool
                log.info("data-pipeline: job_config connected (Postgres)")
            except Exception as exc:  # noqa: BLE001
                log.error(
                    "data-pipeline: job_config Postgres connect failed (%s) "
                    "— falling back to in-memory store (toggles won't persist)",
                    exc,
                )
                app.state.job_config = InMemoryJobConfigStore()
                app.state._job_config_pool = None
        else:
            log.warning(
                "data-pipeline: DATABASE_URL unset — job_config falls back "
                "to in-memory (toggles won't persist across restart)"
            )
            app.state.job_config = InMemoryJobConfigStore()
            app.state._job_config_pool = None

    # Seed the per-cron `{id}.enabled` AND `{id}.schedule` rows on
    # first boot from the spec defaults. Idempotent — existing rows
    # (operator's prior admin toggles + reschedules) are preserved.
    seed_keys: list[EnvSeedKey] = []
    for spec in CRON_SPECS:
        seed_keys.append(
            EnvSeedKey(
                key=enabled_key(spec.id),
                kind="schedule_toggle",
                group="cron_enabled",
                description=(
                    f"On/off toggle for {spec.label} ({spec.cadence}). "
                    "Edited via the admin Queue + Crons page."
                ),
                default_when_unset="on" if spec.default_enabled else "off",
            )
        )
        seed_keys.append(
            EnvSeedKey(
                key=schedule_key(spec.id),
                kind=spec.schedule_kind,
                group="cron_schedule",
                description=(
                    f"Schedule for {spec.label} — "
                    + (
                        "5-field crontab expression (UTC)."
                        if spec.schedule_kind == "cron"
                        else "interval in minutes (float allowed)."
                    )
                    + " Edited via the admin Queue + Crons page."
                ),
                default_when_unset=spec.default_schedule_value,
            )
        )
    seed_keys.append(
        EnvSeedKey(
            key="RECOMPUTE_WINDOW_DAYS",
            kind="int",
            group="feasibility",
            description="Feasibility Recompute 윈도우 조회 기간 (일 단위)",
            default_when_unset="7",
        )
    )
    seed_keys.append(
        EnvSeedKey(
            key="RECOMPUTE_LIMIT",
            kind="int",
            group="feasibility",
            description="최근 시그널 델타 조회 개수 한도",
            default_when_unset="100",
        )
    )
    await seed_from_env(app.state.job_config, seed_keys)

    # Build the scheduler unconditionally. Schedule values + enabled
    # state both come from `job_configs` (slice 14) — env vars for cron
    # expressions / intervals are gone. The .env `*_SCHEDULE` toggles
    # were already retired in slice 13.
    scheduler = AsyncIOScheduler(timezone="UTC")
    job_config = app.state.job_config

    for spec in CRON_SPECS:
        # Prereq gate: when the runner needs an asyncpg-backed slot on
        # app.state and that slot is None (e.g. DATABASE_URL unset),
        # skip registration entirely — running the cron would only
        # error in the runner.
        prereq_attr = _cron_prereq_attr[spec.id]
        if prereq_attr is not None and getattr(app.state, prereq_attr) is None:
            log.info(
                "data-pipeline: %s skipped (prereq app.state.%s is None)",
                spec.id,
                prereq_attr,
            )
            continue

        # Schedule value: DB row (admin edit) → spec default.
        sched_value = await job_config.get(
            schedule_key(spec.id), default=spec.default_schedule_value
        )
        assert sched_value is not None  # default guarantees non-None
        try:
            trigger = build_trigger(spec.schedule_kind, sched_value)
        except ValueError as exc:
            log.error(
                "data-pipeline: bad schedule for %s (kind=%s value=%r): %s "
                "— falling back to spec default %r",
                spec.id,
                spec.schedule_kind,
                sched_value,
                exc,
                spec.default_schedule_value,
            )
            trigger = build_trigger(spec.schedule_kind, spec.default_schedule_value)

        scheduler.add_job(
            _cron_runner[spec.id],
            trigger=trigger,
            kwargs={"app": app},
            id=spec.id,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        enabled = await job_config.get_typed(
            enabled_key(spec.id), default=True, kind="bool"
        )
        if not enabled:
            scheduler.pause_job(spec.id)
            log.info(
                "data-pipeline: %s registered schedule=%r (paused per job_config)",
                spec.id,
                sched_value,
            )
        else:
            log.info(
                "data-pipeline: %s registered schedule=%r (armed)",
                spec.id,
                sched_value,
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
        log.warning(
            "data-pipeline: no scheduler jobs were registered (DATABASE_URL "
            "or signal_repo / crawl_runs_repo prerequisites missing)"
        )
        scheduler = None
    app.state.scheduler = scheduler
    if not hasattr(app.state, "cron_history"):
        # Always set the attr so SQLAdmin can read it safely — empty
        # buffer renders "no runs yet" rather than 500.
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
        # JobConfig pool — own lifecycle so it doesn't leak after the
        # service restarts the admin handlers.
        jc_pool = getattr(app.state, "_job_config_pool", None)
        if jc_pool is not None:
            await jc_pool.close()


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
