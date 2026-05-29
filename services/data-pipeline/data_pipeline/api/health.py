"""GET /health — liveness probe + scheduler/cron telemetry."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import APIRouter, FastAPI

from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get("/health")
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

    return router
