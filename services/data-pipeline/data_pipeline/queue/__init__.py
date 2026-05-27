"""ARQ-backed queue layer for the data-pipeline service.

Why a queue:
  - Fetcher jobs (capability / actor / risk / digest) call grounded
    gemini + the SignalExtractor agent inline. End-to-end latency is
    typically 10-40s (60s+ for DEEP-tier digest). Holding the HTTP
    request open that long is fragile: uvicorn workers stay busy, the
    sector-service proxy needs 180s timeouts, browser tabs look
    frozen, and a network blip mid-LLM-call orphans the work.
  - Splitting trigger → enqueue → worker decouples the HTTP layer
    from the LLM layer. Trigger returns sub-second with a CrawlRun
    row (status="queued"). A separate ARQ worker container picks up
    the job, marks the row "running", does the actual work, marks
    "ok" or "error". The cockpit's LiveJobsTable already polls
    CrawlRun every 5s, so the UX flow is unchanged.

Why ARQ:
  - Async-native — drops into existing `async def run_*_fetcher`
    code without a sync/async bridge.
  - Redis-only — one container, no message broker, no Postgres
    extension.
  - Tiny config surface (`WorkerSettings` class with `functions`
    list + `on_startup`/`on_shutdown` hooks).
  - By Samuel Colvin (Pydantic author); stable + maintained.

Why CrawlRun stays the source of truth:
  - We already have a persistent table (`crawl_runs`) with `status`,
    `cost_usd`, `result_summary`, `signals_written`, `error` fields.
    The cockpit reads from it; per-vision $/day rollups use it; the
    bot discovery loop reads CrawlRun history. ARQ only holds the
    short-lived "is this job in flight, queued, or done?" view —
    we don't migrate ownership of the audit trail to Redis.
  - Job ID matches CrawlRun.id so the queue and the table are
    cross-referenceable in one click.
"""

from data_pipeline.queue.client import (
    DATA_PIPELINE_QUEUE,
    QueueClient,
    QueueDepthSnapshot,
    build_queue_client,
)
from data_pipeline.queue.worker import WorkerSettings

__all__ = [
    "DATA_PIPELINE_QUEUE",
    "QueueClient",
    "QueueDepthSnapshot",
    "WorkerSettings",
    "build_queue_client",
]
