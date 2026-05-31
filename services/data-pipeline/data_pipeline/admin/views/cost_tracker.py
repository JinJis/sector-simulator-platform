"""Custom SQLAdmin page: LLM Costs Tracker.

Aggregates and lists detailed metered expenditures across:
  - AgentWorkflows (Conductor prompts, score updates, full pipelines)
  - CrawlRuns (automated cron sweeps + Deep Research digests)
  - Breakdown by model types, sectors, and daily spend.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI
from sqladmin import BaseView, expose
from sqlalchemy import text
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger(__name__)


def _parent_app(request: Request) -> FastAPI:
    """Walk back to the outer FastAPI app whose lifespan owns the DB engines."""
    inner = request.app
    parent = getattr(inner.state, "parent_app", None)
    if parent is None:
        raise RuntimeError("cost tracker view: parent_app reference missing")
    return parent


class LLMCostTrackerView(BaseView):
    name = "LLM Costs Tracker"
    icon = "fa-solid fa-coins"
    category = "Financial"
    identity = "llm-costs"

    @expose("/llm-costs", methods=["GET"])
    async def costs_page(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        async with engine.connect() as conn:
            # 1. Total spent (combined workflows + crawl runs)
            total_spent_res = await conn.execute(
                text(
                    """
                    SELECT 
                        (SELECT COALESCE(SUM(cost_usd), 0) FROM agent_workflows) +
                        (SELECT COALESCE(SUM(cost_usd), 0) FROM crawl_runs) AS total
                    """
                )
            )
            total_spent = float(total_spent_res.scalar() or 0.0)

            # 2. Daily spent last 30 days
            daily_spent_res = await conn.execute(
                text(
                    """
                    SELECT COALESCE(a.date, c.date) AS date,
                           COALESCE(a.cost, 0) + COALESCE(c.cost, 0) AS cost
                    FROM (
                        SELECT date_trunc('day', created_at)::date AS date,
                               SUM(cost_usd) AS cost
                        FROM agent_workflows
                        GROUP BY 1
                    ) a
                    FULL OUTER JOIN (
                        SELECT date_trunc('day', started_at)::date AS date,
                               SUM(cost_usd) AS cost
                        FROM crawl_runs
                        GROUP BY 1
                    ) c ON a.date = c.date
                    ORDER BY date DESC
                    LIMIT 30
                    """
                )
            )
            daily_spent = [
                {"date": str(r[0]), "cost": float(r[1])}
                for r in daily_spent_res.fetchall()
            ]

            # 3. Spent by Sector / Vision
            sector_spent_res = await conn.execute(
                text(
                    """
                    SELECT COALESCE(a.sector, c.sector, 'unknown') AS sector,
                           COALESCE(a.cost, 0) + COALESCE(c.cost, 0) AS cost
                    FROM (
                        SELECT input->>'sector_slug' AS sector, SUM(cost_usd) AS cost
                        FROM agent_workflows
                        WHERE input->>'sector_slug' IS NOT NULL
                        GROUP BY 1
                    ) a
                    FULL OUTER JOIN (
                        SELECT vision_slug AS sector, SUM(cost_usd) AS cost
                        FROM crawl_runs
                        GROUP BY 1
                    ) c ON a.sector = c.sector
                    ORDER BY cost DESC
                    """
                )
            )
            sector_spent = [
                {"sector": r[0], "cost": float(r[1])}
                for r in sector_spent_res.fetchall()
            ]

            # 4. Spent by Ingest Fetcher Category
            fetcher_spent_res = await conn.execute(
                text(
                    """
                    SELECT fetcher_kind, COUNT(*) AS count, SUM(cost_usd) AS cost
                    FROM crawl_runs
                    GROUP BY 1
                    ORDER BY cost DESC
                    """
                )
            )
            fetcher_spent = [
                {"fetcher_kind": r[0], "count": r[1], "cost": float(r[2] or 0.0)}
                for r in fetcher_spent_res.fetchall()
            ]

            # 5. Spent by Agent Workflow Category
            workflow_spent_res = await conn.execute(
                text(
                    """
                    SELECT kind, COUNT(*) AS count, SUM(cost_usd) AS cost
                    FROM agent_workflows
                    GROUP BY 1
                    ORDER BY cost DESC
                    """
                )
            )
            workflow_spent = [
                {"kind": r[0], "count": r[1], "cost": float(r[2] or 0.0)}
                for r in workflow_spent_res.fetchall()
            ]

            # 6. Granular details from recent completed workflows
            recent_workflows_res = await conn.execute(
                text(
                    """
                    SELECT id, kind, status, cost_usd, created_at
                    FROM agent_workflows
                    ORDER BY created_at DESC
                    LIMIT 20
                    """
                )
            )
            recent_workflows = [
                {
                    "id": r[0],
                    "kind": r[1],
                    "status": r[2],
                    "cost_usd": float(r[3] or 0.0),
                    "created_at": r[4],
                }
                for r in recent_workflows_res.fetchall()
            ]

        return await self.templates.TemplateResponse(
            request,
            "llm_costs.html",
            context={
                "title": "LLM Costs Tracker",
                "subtitle": (
                    "Financial engineering cockpit tracking real-time Google Gemini "
                    "usage, workflow costs, and temporal spend distributions."
                ),
                "total_spent": total_spent,
                "daily_spent": daily_spent,
                "sector_spent": sector_spent,
                "fetcher_spent": fetcher_spent,
                "workflow_spent": workflow_spent,
                "recent_workflows": recent_workflows,
                "now_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            },
        )
