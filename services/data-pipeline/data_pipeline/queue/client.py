"""Client-side helpers for enqueueing data-pipeline jobs.

The FastAPI HTTP endpoints use this to push work onto the ARQ queue
without holding the HTTP connection open while the LLM call runs.

`QueueClient` wraps `arq.connections.ArqRedis` with three concerns:
  - typed enqueue methods (one per task — keeps the call sites
    obvious about which fetcher they're queueing)
  - a single shared queue name (`DATA_PIPELINE_QUEUE`) so the worker
    + producer agree on which list in Redis to use
  - depth/health introspection for the cockpit's queue panel
    (`QueueDepthSnapshot`)

The worker side (`worker.py`) consumes tasks by name; the names
defined here are the only contract between producer + consumer.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import arq
from arq.connections import ArqRedis, RedisSettings

log = logging.getLogger(__name__)


# All data-pipeline jobs land on this queue. Single-queue is fine for
# the current scale (≤ a few hundred jobs/day across 4 visions);
# split into priority lanes if we ever throttle by vision $/day.
DATA_PIPELINE_QUEUE = "data_pipeline_jobs"


# Task names — one constant per task function in worker.tasks. Keep
# producer + consumer in sync via these.
TASK_HELLO_WORLD = "hello_world"
TASK_CAPABILITY = "capability"
TASK_ACTOR = "actor"
TASK_SIGNAL = "signal"
TASK_RISK = "risk"
TASK_DIGEST = "digest"


def default_redis_url() -> str:
    """Production: `redis://redis:6379/0` (docker-compose hostname).
    Local-dev outside compose: `redis://localhost:6379/0` works if you
    `docker compose up redis` standalone."""
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0").strip()


def _redis_settings_from_url(url: str) -> RedisSettings:
    """Parse REDIS_URL into ARQ's `RedisSettings`. Supports
    `redis://[user:pass@]host[:port][/db]`."""
    from urllib.parse import urlparse  # noqa: PLC0415

    p = urlparse(url)
    return RedisSettings(
        host=p.hostname or "localhost",
        port=p.port or 6379,
        database=int(p.path.lstrip("/") or "0") if p.path else 0,
        password=p.password,
        username=p.username,
    )


@dataclass(frozen=True, slots=True)
class QueueDepthSnapshot:
    """Current queue + worker state. Returned by
    `QueueClient.snapshot()` for the cockpit's /admin/queue view."""

    queue_name: str
    queued: int          # jobs waiting for a worker
    in_progress: int     # jobs a worker has picked up but not finished
    workers: int         # connected worker count (from worker heartbeats)
    deferred: int        # jobs scheduled for a future timestamp


@dataclass
class QueueClient:
    """Thin async wrapper around `ArqRedis`. Tasks are pushed by name
    rather than by importing the worker module (keeps the FastAPI
    process from pulling in worker-side deps it doesn't need)."""

    redis: ArqRedis

    async def enqueue(
        self,
        task_name: str,
        *args: Any,
        job_id: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Enqueue `task_name` and return its job id. When `job_id` is
        provided (e.g., the CrawlRun.id), ARQ uses it directly — the
        cockpit can then cross-reference Redis state and the CrawlRun
        table by the same key. Falls back to ARQ's auto-generated id
        when not provided."""
        job = await self.redis.enqueue_job(
            task_name,
            *args,
            _queue_name=DATA_PIPELINE_QUEUE,
            _job_id=job_id,
            **kwargs,
        )
        if job is None:
            # ARQ returns None when a job with the same id is already
            # queued/in-flight. The CrawlRun row exists either way; let
            # the caller decide whether that's an error.
            raise RuntimeError(
                f"duplicate job id rejected by arq: {job_id} (task={task_name})"
            )
        return job.job_id

    async def snapshot(self) -> QueueDepthSnapshot:
        """Best-effort introspection of the queue + worker pool. ARQ
        doesn't expose a single stat endpoint, so we compose this from
        a few Redis reads. Fields default to 0 on any underlying
        Redis error — the cockpit treats a degraded snapshot as
        "queue offline" rather than crashing."""
        try:
            queued = await self.redis.zcard(DATA_PIPELINE_QUEUE)
        except Exception as exc:  # noqa: BLE001
            log.warning("queue snapshot: zcard failed: %s", exc)
            queued = 0
        try:
            in_progress_key = f"arq:in-progress:{DATA_PIPELINE_QUEUE}"
            in_progress = await self.redis.scard(in_progress_key)
        except Exception as exc:  # noqa: BLE001
            log.warning("queue snapshot: scard in-progress failed: %s", exc)
            in_progress = 0
        try:
            workers_key = f"arq:health-check:{DATA_PIPELINE_QUEUE}"
            workers = await self.redis.scard(workers_key)
        except Exception:  # noqa: BLE001
            workers = 0
        # ARQ stores deferred jobs in the same zset with future scores;
        # `zcard` includes them. We approximate "deferred" by counting
        # entries with score > now() — but Redis' ZCOUNT with +inf
        # bound is cheap.
        try:
            import time  # noqa: PLC0415

            now_ms = int(time.time() * 1000)
            deferred = await self.redis.zcount(
                DATA_PIPELINE_QUEUE, now_ms + 1, "+inf"
            )
        except Exception:  # noqa: BLE001
            deferred = 0
        return QueueDepthSnapshot(
            queue_name=DATA_PIPELINE_QUEUE,
            queued=int(queued),
            in_progress=int(in_progress),
            workers=int(workers),
            deferred=int(deferred),
        )

    async def close(self) -> None:
        await self.redis.close(close_connection_pool=True)


async def build_queue_client(redis_url: str | None = None) -> QueueClient:
    """Construct a QueueClient from an env-resolved Redis URL. Used by
    the FastAPI lifespan to wire `app.state.queue_client` once at
    startup."""
    settings = _redis_settings_from_url(redis_url or default_redis_url())
    redis = await arq.create_pool(settings)
    return QueueClient(redis=redis)
