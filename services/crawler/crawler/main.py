"""crawler FastAPI app.

Endpoints (M48c):
- GET  /health                                  → liveness + ready flags
- POST /fetchers/hello-world/run                → trigger smoke fetcher
- GET  /jobs/runs?vision=&fetcher=&status=&limit=   → recent CrawlRuns
- GET  /jobs/runs/{run_id}                      → single CrawlRun

Configuration (env):
  DATABASE_URL                  — required for non-degraded mode
  GOOGLE_APPLICATION_CREDENTIALS — Vertex AI SA JSON path
  GOOGLE_CLOUD_LOCATION         — default "global"
  CRAWLER_SCHEDULE              — set to "off" to silence the scheduler
                                  (M49+ will register cron jobs here)
  LOG_LEVEL                     — default INFO

When `DATABASE_URL` is missing the service still serves /health (with
ready=false) so docker-compose stays green during local smoke without
a DB — the fetcher endpoints return 503.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_tools import DeepResearchClient
from crawler.fetchers.hello_world import (
    HelloWorldRunRequest,
    run_hello_world,
)
from crawler.repo import (
    CrawlRunRepository,
    CrawlRunRow,
    PostgresCrawlRunRepository,
)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("crawler")


# --------------------------------------------------------------------------
# Pydantic response shapes
# --------------------------------------------------------------------------


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
    def from_row(cls, row: CrawlRunRow) -> "CrawlRunOut":
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


# --------------------------------------------------------------------------
# Bootstrap helpers (separated so tests can inject)
# --------------------------------------------------------------------------


def _build_deep_research_client() -> DeepResearchClient | None:
    """Construct a DeepResearchClient backed by the real google-genai
    client when the env is wired (Vertex AI SA JSON + project + region).
    Returns None otherwise — the HelloWorld endpoint then 503s instead
    of crashing on startup, which keeps docker-compose green when the
    SA JSON isn't mounted yet."""
    try:
        from google import genai  # noqa: PLC0415  (optional dep)
    except ImportError:
        log.warning("crawler: google-genai not installed — Deep Research disabled")
        return None

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1", "true", "yes", "on"
    }
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not (use_vertex and creds and os.path.exists(creds)):
        log.warning(
            "crawler: GOOGLE_GENAI_USE_VERTEXAI/GOOGLE_APPLICATION_CREDENTIALS "
            "not wired — Deep Research disabled (HelloWorld will return 503)"
        )
        return None

    try:
        client = genai.Client(
            vertexai=True,
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
        )
    except Exception as exc:  # pragma: no cover — exercised in compose, not unit tests
        log.error("crawler: genai.Client() construction failed: %s", exc)
        return None

    return DeepResearchClient(genai_client=client)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    # Tests pre-wire app.state.repo / app.state.deep_research to inject
    # fakes; in production we build them here.
    if not hasattr(app.state, "repo"):
        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            try:
                app.state.repo = await PostgresCrawlRunRepository.connect(dsn)
            except Exception as exc:
                log.error("crawler: repo connect failed: %s", exc)
                app.state.repo = None
        else:
            log.warning("crawler: DATABASE_URL unset — fetchers disabled")
            app.state.repo = None

    if not hasattr(app.state, "deep_research"):
        app.state.deep_research = _build_deep_research_client()

    log.info(
        "crawler ready (repo=%s · deep_research=%s)",
        "on" if getattr(app.state, "repo", None) is not None else "off",
        "on" if getattr(app.state, "deep_research", None) is not None else "off",
    )
    try:
        yield
    finally:
        repo = getattr(app.state, "repo", None)
        if repo is not None and isinstance(repo, PostgresCrawlRunRepository):
            await repo.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="crawler",
        version="0.1.0",
        description=(
            "Phase 4 real-time crawler — runs per-surface fetchers + "
            "Gemini Deep Research Agent; writes CrawlRun + Signal rows."
        ),
        lifespan=lifespan,
    )
    # Web + admin call the crawler indirectly via tRPC, but we leave
    # CORS open to the same dev hosts for direct curl/POST during
    # smoke testing.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3100"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _require_repo() -> CrawlRunRepository:
        repo = getattr(app.state, "repo", None)
        if repo is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — DATABASE_URL not configured",
            )
        return repo

    def _require_deep_research() -> DeepResearchClient:
        dr = getattr(app.state, "deep_research", None)
        if dr is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "crawler unavailable — DeepResearchClient not configured "
                    "(GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_APPLICATION_CREDENTIALS)"
                ),
            )
        return dr

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "now": datetime.now(UTC).isoformat(),
            "ready": {
                "repo": getattr(app.state, "repo", None) is not None,
                "deep_research": getattr(app.state, "deep_research", None) is not None,
            },
        }

    @app.post("/fetchers/hello-world/run", response_model=HelloWorldTriggerOut)
    async def hello_world_run(body: HelloWorldTriggerBody) -> HelloWorldTriggerOut:
        repo = _require_repo()
        dr = _require_deep_research()
        log.info("crawler: hello-world triggered vision=%s", body.vision_slug)
        out = await run_hello_world(
            HelloWorldRunRequest(vision_slug=body.vision_slug, prompt=body.prompt),
            repo=repo,
            deep_research=dr,
        )
        return HelloWorldTriggerOut(
            run=CrawlRunOut.from_row(out.run),
            cached=out.cached,
        )

    @app.get("/jobs/runs", response_model=list[CrawlRunOut])
    async def list_runs(
        vision: str | None = Query(None, alias="vision"),
        fetcher: str | None = Query(None, alias="fetcher"),
        status: str | None = Query(None, alias="status"),
        limit: int = Query(50, ge=1, le=200),
    ) -> list[CrawlRunOut]:
        repo = _require_repo()
        rows = await repo.list_recent(
            vision_slug=vision,
            fetcher_kind=fetcher,
            status=status,
            limit=limit,
        )
        return [CrawlRunOut.from_row(r) for r in rows]

    @app.get("/jobs/runs/{run_id}", response_model=CrawlRunOut)
    async def get_run(run_id: str) -> CrawlRunOut:
        repo = _require_repo()
        row = await repo.get(run_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"run {run_id} not found")
        return CrawlRunOut.from_row(row)

    return app


app = create_app()
