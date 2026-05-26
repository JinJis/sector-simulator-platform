"""crawler FastAPI app.

Endpoints:
- GET  /health                                  → liveness + ready flags
- POST /fetchers/hello-world/run                → smoke trigger (M48c)
- POST /fetchers/capability/run                 → CapabilityFetcher (M49a)
- POST /fetchers/actor/run                      → ActorFetcher (M49b)
- GET  /jobs/runs?vision=&fetcher=&status=&limit=   → recent CrawlRuns
- GET  /jobs/runs/{run_id}                      → single CrawlRun

Configuration (env):
  DATABASE_URL                  — required for non-degraded mode
  GOOGLE_APPLICATION_CREDENTIALS — Vertex AI SA JSON path
  GOOGLE_CLOUD_LOCATION         — default "global"
  AGENT_ORCHESTRATION_URL       — SignalExtractor + ScoreUpdater base URL
                                  (e.g. http://agent-orchestration:8002)
  CRAWLER_SCHEDULE              — set to "off" to silence the scheduler
                                  (M49f wires real cron jobs here)
  LOG_LEVEL                     — default INFO

When `DATABASE_URL` / `AGENT_ORCHESTRATION_URL` are missing the
service still serves /health (with ready=false) so docker-compose
stays green during local smoke — the fetcher endpoints return 503.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from agent_tools import DeepResearchClient
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from crawler.agents import (
    AgentClient,
    HttpAgentClient,
    default_agent_orchestration_url,
)
from crawler.db.actor_reader import (
    ActorReader,
    PostgresActorReader,
)
from crawler.db.capability_reader import (
    CapabilityReader,
    PostgresCapabilityReader,
)
from crawler.db.signal_writer import PostgresSignalWriter, SignalWriter
from crawler.fetchers.actor import (
    ActorFetcherError,
    ActorFetchRequest,
    run_actor_fetcher,
)
from crawler.fetchers.capability import (
    CapabilityFetcherError,
    CapabilityFetchRequest,
    run_capability_fetcher,
)
from crawler.fetchers.hello_world import (
    HelloWorldRunRequest,
    run_hello_world,
)
from crawler.repo import (
    CrawlRunRepository,
    CrawlRunRow,
    PostgresCrawlRunRepository,
)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
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


# --------------------------------------------------------------------------
# Bootstrap helpers (separated so tests can inject)
# --------------------------------------------------------------------------


def _build_deep_research_client() -> DeepResearchClient | None:
    """Construct a DeepResearchClient backed by the real google-genai
    client. Two auth paths, tried in order:

      1. **Vertex AI (production)** — requires
         `GOOGLE_GENAI_USE_VERTEXAI=true` +
         `GOOGLE_APPLICATION_CREDENTIALS=/path/to/vertex-ai-sa.json`.
      2. **Gemini API key (dev fallback)** — requires `GEMINI_API_KEY`
         from https://aistudio.google.com/apikey. Cheaper to wire up;
         not for prod but unblocks local crawler smoke without an
         SA JSON mount.

    Returns None when neither is wired — the fetcher endpoints then
    503 with a remediation hint instead of crashing on startup, so
    docker-compose stays green.
    """
    try:
        from google import genai  # noqa: PLC0415  (optional dep)
    except ImportError:
        log.warning("crawler: google-genai not installed — Deep Research disabled")
        return None

    # Path 1 — Vertex AI.
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1", "true", "yes", "on"
    }
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if use_vertex and creds and os.path.exists(creds):
        try:
            client = genai.Client(
                vertexai=True,
                location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            )
            log.info("crawler: Deep Research enabled via Vertex AI (sa=%s)", creds)
            return DeepResearchClient(genai_client=client)
        except Exception as exc:  # pragma: no cover — exercised in compose
            log.error("crawler: Vertex AI client construction failed: %s", exc)

    # Path 2 — Gemini API key (AI Studio).
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            log.info("crawler: Deep Research enabled via Gemini API key (AI Studio)")
            return DeepResearchClient(genai_client=client)
        except Exception as exc:  # pragma: no cover — exercised in compose
            log.error("crawler: API key client construction failed: %s", exc)

    log.warning(
        "crawler: Deep Research disabled — neither Vertex AI "
        "(GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_APPLICATION_CREDENTIALS) "
        "nor GEMINI_API_KEY is configured. Fetcher endpoints will 503."
    )
    return None


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

    # M49a — share the asyncpg pool across the sibling repos so the
    # crawler stays at a single connection bucket per container.
    if not hasattr(app.state, "capability_reader"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.capability_reader = PostgresCapabilityReader(repo.pool)
        else:
            app.state.capability_reader = None

    if not hasattr(app.state, "signal_writer"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.signal_writer = PostgresSignalWriter(repo.pool)
        else:
            app.state.signal_writer = None

    # M49b — actor lookup reuses the shared asyncpg pool.
    if not hasattr(app.state, "actor_reader"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.actor_reader = PostgresActorReader(repo.pool)
        else:
            app.state.actor_reader = None

    if not hasattr(app.state, "agent_client"):
        base = default_agent_orchestration_url()
        if base:
            app.state.agent_client = HttpAgentClient(base_url=base)
        else:
            log.warning(
                "crawler: AGENT_ORCHESTRATION_URL unset — CapabilityFetcher "
                "will return 503 (no SignalExtractor reachable)"
            )
            app.state.agent_client = None

    log.info(
        "crawler ready (repo=%s · deep_research=%s · agent_client=%s)",
        "on" if getattr(app.state, "repo", None) is not None else "off",
        "on" if getattr(app.state, "deep_research", None) is not None else "off",
        "on" if getattr(app.state, "agent_client", None) is not None else "off",
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
                    "Deep Research is not configured. Set ONE of: "
                    "(A) GEMINI_API_KEY=<aistudio.google.com/apikey> "
                    "in your .env (simplest for dev); "
                    "(B) GOOGLE_GENAI_USE_VERTEXAI=true + "
                    "GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json "
                    "(production). Restart the crawler container after."
                ),
            )
        return dr

    def _require_capability_reader() -> CapabilityReader:
        reader = getattr(app.state, "capability_reader", None)
        if reader is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — capability_reader not configured (needs DATABASE_URL)",
            )
        return reader

    def _require_actor_reader() -> ActorReader:
        reader = getattr(app.state, "actor_reader", None)
        if reader is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — actor_reader not configured (needs DATABASE_URL)",
            )
        return reader

    def _require_signal_writer() -> SignalWriter:
        writer = getattr(app.state, "signal_writer", None)
        if writer is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — signal_writer not configured (needs DATABASE_URL)",
            )
        return writer

    def _require_agent_client() -> AgentClient:
        client = getattr(app.state, "agent_client", None)
        if client is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "crawler unavailable — AGENT_ORCHESTRATION_URL not configured "
                    "(SignalExtractor unreachable)"
                ),
            )
        return client

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "now": datetime.now(UTC).isoformat(),
            "ready": {
                "repo": getattr(app.state, "repo", None) is not None,
                "deep_research": getattr(app.state, "deep_research", None) is not None,
                "agent_client": getattr(app.state, "agent_client", None) is not None,
            },
        }

    @app.post("/fetchers/capability/run", response_model=CapabilityTriggerOut)
    async def capability_run(body: CapabilityTriggerBody) -> CapabilityTriggerOut:
        repo = _require_repo()
        dr = _require_deep_research()
        reader = _require_capability_reader()
        writer = _require_signal_writer()
        agent = _require_agent_client()
        log.info(
            "crawler: capability triggered vision=%s cap=%s",
            body.vision_slug,
            body.capability_key,
        )
        try:
            out = await run_capability_fetcher(
                CapabilityFetchRequest(
                    vision_slug=body.vision_slug,
                    capability_key=body.capability_key,
                    prompt=body.prompt,
                ),
                runs_repo=repo,
                capability_reader=reader,
                signal_writer=writer,
                deep_research=dr,
                agent_client=agent,
            )
        except CapabilityFetcherError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return CapabilityTriggerOut(
            run=CrawlRunOut.from_row(out.run),
            signal_id=out.signal_id,
            dr_cached=out.deep_research.cached,
            scoring_confidence=out.scoring.scoring.confidence
            if out.scoring is not None
            else None,
        )

    @app.post("/fetchers/actor/run", response_model=ActorTriggerOut)
    async def actor_run(body: ActorTriggerBody) -> ActorTriggerOut:
        repo = _require_repo()
        dr = _require_deep_research()
        reader = _require_actor_reader()
        writer = _require_signal_writer()
        agent = _require_agent_client()
        log.info(
            "crawler: actor triggered vision=%s actor=%s",
            body.vision_slug,
            body.actor_key,
        )
        try:
            out = await run_actor_fetcher(
                ActorFetchRequest(
                    vision_slug=body.vision_slug,
                    actor_key=body.actor_key,
                    prompt=body.prompt,
                ),
                runs_repo=repo,
                actor_reader=reader,
                signal_writer=writer,
                deep_research=dr,
                agent_client=agent,
            )
        except ActorFetcherError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return ActorTriggerOut(
            run=CrawlRunOut.from_row(out.run),
            signal_id=out.signal_id,
            dr_cached=out.deep_research.cached,
            scoring_confidence=out.scoring.scoring.confidence
            if out.scoring is not None
            else None,
            matched_actor_key=out.scoring.scoring.matched_actor_key
            if out.scoring is not None
            else None,
            primary_capability_key=out.actor.primary_capability.key
            if out.actor.primary_capability is not None
            else None,
        )

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
