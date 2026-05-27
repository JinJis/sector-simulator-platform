"""ARQ worker entry point.

Run with: `arq data_pipeline.queue.worker.WorkerSettings`
(the docker-compose data-pipeline-worker service does this).

`WorkerSettings.on_startup` builds the same repos + clients the
FastAPI app builds in its lifespan, then stashes them on the shared
`ctx` dict so every task can read its deps without re-instantiating.
`on_shutdown` closes the asyncpg pools + the genai client.

Concurrency: ARQ runs tasks via asyncio.gather under the hood, with
`max_jobs` capping the concurrent count. We set `max_jobs=4` —
LLM-bound tasks are the dominant cost and 4 in-flight grounded gemini
calls is well within the per-vision $/day cap. Tune up if a vision
backlog persists.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from agent_tools import GroundedResearchClient

from data_pipeline.agents import HttpAgentClient, default_agent_orchestration_url
from data_pipeline.crawl_run_repo import PostgresCrawlRunRepository
from data_pipeline.db.actor_reader import PostgresActorReader
from data_pipeline.db.capability_reader import PostgresCapabilityReader
from data_pipeline.db.risk_reader import PostgresRiskReader
from data_pipeline.db.signal_writer import PostgresSignalWriter
from data_pipeline.jobs.signal_ingest import IngestStats, run_signal_ingest
from data_pipeline.queue.client import (
    DATA_PIPELINE_QUEUE,
    _redis_settings_from_url,
    default_redis_url,
)
from data_pipeline.queue.tasks import TASK_FUNCTIONS
from data_pipeline.signal_repo import PostgresSignalRepository

log = logging.getLogger("data_pipeline.queue.worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())


def _build_grounded_research_client() -> GroundedResearchClient | None:
    """Same construction logic as the FastAPI lifespan — Vertex
    preferred, AI Studio fallback. Duplicated here rather than imported
    to avoid pulling FastAPI into the worker process."""
    try:
        from google import genai  # noqa: PLC0415
    except ImportError:
        log.warning("worker: google-genai not installed — grounded research disabled")
        return None

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()

    if use_vertex and creds and os.path.exists(creds):
        try:
            client = genai.Client(
                vertexai=True,
                location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            )
        except Exception as exc:  # pragma: no cover
            log.error("worker: Vertex client construction failed: %s", exc)
            return None
        log.info("worker: grounded research via Vertex AI (sa=%s)", creds)
        return GroundedResearchClient(genai_client=client)
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
        except Exception as exc:  # pragma: no cover
            log.error("worker: AI Studio client construction failed: %s", exc)
            return None
        log.info("worker: grounded research via AI Studio (GEMINI_API_KEY)")
        return GroundedResearchClient(genai_client=client)
    log.warning(
        "worker: grounded research disabled — neither Vertex nor AI Studio configured"
    )
    return None


async def startup(ctx: dict[str, Any]) -> None:
    """ARQ calls this once per worker process before pulling jobs.
    Build every dep the tasks share + stash on ctx. Failures here
    abort startup loudly — better than every task individually
    503-ing on missing deps."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("worker: DATABASE_URL not set")

    runs_repo = await PostgresCrawlRunRepository.connect(dsn)
    pool = runs_repo.pool
    signal_repo = PostgresSignalRepository(pool)

    ctx["runs_repo"] = runs_repo
    ctx["signal_repo"] = signal_repo
    ctx["capability_reader"] = PostgresCapabilityReader(pool)
    ctx["actor_reader"] = PostgresActorReader(pool)
    ctx["risk_reader"] = PostgresRiskReader(pool)
    ctx["signal_writer"] = PostgresSignalWriter(pool)

    ctx["deep_research"] = _build_grounded_research_client()

    agent_base = default_agent_orchestration_url()
    ctx["agent_client"] = (
        HttpAgentClient(base_url=agent_base) if agent_base else None
    )

    # signal_ingest_fn — same closure pattern the FastAPI app uses, so
    # the SignalFetcher task hands an in-process callable to
    # run_signal_fetcher (no HTTP hop).
    async def _signal_ingest_scoped(
        vision_slug: str,
        capability_keys: list[str],
        lookback_days: int,
        per_capability_limit: int,
    ) -> IngestStats:
        return await run_signal_ingest(
            sector_slugs=[vision_slug],
            repo=signal_repo,
            capability_keys=capability_keys,
            lookback_days=lookback_days,
            per_capability_limit=per_capability_limit,
        )

    ctx["signal_ingest_fn"] = _signal_ingest_scoped

    log.info("worker startup complete — listening on queue=%s", DATA_PIPELINE_QUEUE)


async def shutdown(ctx: dict[str, Any]) -> None:
    """Close pools so the worker can exit cleanly."""
    runs_repo = ctx.get("runs_repo")
    if runs_repo is not None:
        await runs_repo.close()


class WorkerSettings:
    """ARQ-recognized config class. The `arq` CLI imports this module
    and uses these attributes — class-level only, no instance."""

    functions = TASK_FUNCTIONS
    on_startup = startup
    on_shutdown = shutdown
    queue_name = DATA_PIPELINE_QUEUE
    max_jobs = int(os.environ.get("WORKER_MAX_JOBS", "4"))
    # If a task takes longer than this, ARQ marks it failed + lets
    # another worker retry. Set high enough for DEEP digest (~60s) +
    # comfortable headroom.
    job_timeout = int(os.environ.get("WORKER_JOB_TIMEOUT", "300"))
    # Retry pause is exponential; bump if grounded gemini quota
    # errors start dominating.
    max_tries = int(os.environ.get("WORKER_MAX_TRIES", "2"))

    # redis_settings has to be set at class-construction (not import)
    # because env may load later in a real container. Use a property-
    # like classmethod for ARQ.
    @staticmethod
    def _redis_settings():
        return _redis_settings_from_url(default_redis_url())

    redis_settings = _redis_settings_from_url(default_redis_url())
