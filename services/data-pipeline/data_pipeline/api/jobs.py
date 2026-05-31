"""Miscellaneous /jobs/* endpoints — digest trigger, discovery sweep,
queue introspection, CrawlRun history."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query

from data_pipeline.api.deps import (
    require_bot_user_id,
    require_crawl_repo,
    require_discovery_reader,
    require_orchestrator_reader,
    require_proposal_writer,
    require_queue,
)
from data_pipeline.api.schemas import (
    CrawlRunOut,
    DigestRunBody,
    DigestRunOut,
    DiscoveryRunBody,
    DiscoveryRunOut,
)
from data_pipeline.deep_research.digest import (
    DigestRequest,
    enqueue_deep_research_digest,
)
from data_pipeline.deep_research.discovery.runner import run_discovery
from data_pipeline.jobs.runners import run_marketing_digest_job
from data_pipeline.queue.client import TASK_DIGEST

log = logging.getLogger("data_pipeline")


def _request_to_dict(req: Any) -> dict[str, Any]:
    """ARQ wire-format serializer shared with api/fetchers.py."""
    from dataclasses import asdict, is_dataclass  # noqa: PLC0415

    if is_dataclass(req):
        return asdict(req)
    return dict(req)


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["jobs"])

    @router.post("/jobs/deep-research-digest/run", response_model=DigestRunOut)
    async def deep_research_digest_run(body: DigestRunBody) -> DigestRunOut:
        """Daily-style industry/macro Deep Research digest per vision.
        Manual-only at this commit — no cron arming. Writes one signal
        row anchored on the vision's first capability with
        source_kind='research_brief' + source_url='internal://digest/
        {vision}/{YYYY-MM-DD}' so re-runs the same day dedupe."""
        repo = require_crawl_repo(app)
        queue = require_queue(app)
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

    @router.get("/queue/status")
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

    @router.post("/jobs/discovery/run", response_model=DiscoveryRunOut)
    async def discovery_run(body: DiscoveryRunBody | None = None) -> DiscoveryRunOut:
        discovery_reader = require_discovery_reader(app)
        proposal_writer = require_proposal_writer(app)
        bot_id = require_bot_user_id(app)
        body = body or DiscoveryRunBody()

        slugs = body.vision_slugs
        if not slugs:
            orch_reader = require_orchestrator_reader(app)
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

    def _marketing_digest_payload(stats: Any) -> dict[str, Any]:
        return {
            "started_at": stats.started_at.isoformat(),
            "finished_at": (
                stats.finished_at.isoformat() if stats.finished_at else None
            ),
            "visions_processed": stats.visions_processed,
            "visions_skipped_no_capabilities": stats.visions_skipped_no_capabilities,
            "post_sets_generated": stats.post_sets_generated,
            "agent_failures": stats.agent_failures,
            "total_cost_usd": stats.total_cost_usd,
            "results": stats.results,
            "errors": stats.errors,
        }

    @router.post("/jobs/marketing-digest")
    async def marketing_digest_run() -> dict[str, Any]:
        """Build a source-grounded snapshot per active vision and generate
        bilingual (ko+en) Threads + Instagram copy via the marketing-
        content agent. Returns the generated post sets for operator review
        — does not auto-publish. Same path the (default-off) cron uses."""
        if getattr(app.state, "signal_repo", None) is None:
            raise HTTPException(
                status_code=503,
                detail="marketing-digest unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/marketing-digest triggered")
        stats = await run_marketing_digest_job(app=app)
        if stats is None:
            raise HTTPException(status_code=503, detail="marketing-digest skipped")
        return _marketing_digest_payload(stats)

    @router.get("/jobs/marketing-digest/last")
    async def marketing_digest_last() -> dict[str, Any]:
        last = getattr(app.state, "last_marketing_digest_result", None)
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no marketing-digest has run since the process started",
            )
        return _marketing_digest_payload(last)

    @router.get("/jobs/runs", response_model=list[CrawlRunOut])
    async def list_runs(
        vision: str | None = Query(None, alias="vision"),
        fetcher: str | None = Query(None, alias="fetcher"),
        status: str | None = Query(None, alias="status"),
        limit: int = Query(50, ge=1, le=200),
    ) -> list[CrawlRunOut]:
        repo = require_crawl_repo(app)
        rows = await repo.list_recent(
            vision_slug=vision,
            fetcher_kind=fetcher,
            status=status,
            limit=limit,
        )
        return [CrawlRunOut.from_row(r) for r in rows]

    @router.get("/jobs/runs/{run_id}", response_model=CrawlRunOut)
    async def get_run(run_id: str) -> CrawlRunOut:
        repo = require_crawl_repo(app)
        row = await repo.get(run_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"run {run_id} not found")
        return CrawlRunOut.from_row(row)

    return router
