"""crawler FastAPI app.

Endpoints:
- GET  /health                                  → liveness + ready flags
- POST /fetchers/hello-world/run                → smoke trigger (M48c)
- POST /fetchers/capability/run                 → CapabilityFetcher (M49a)
- POST /fetchers/actor/run                      → ActorFetcher (M49b)
- POST /fetchers/signal/run                     → SignalFetcher (M49c)
- POST /fetchers/risk/run                       → RiskFetcher (M49d)
- POST /jobs/orchestrator/tick?dry_run=         → Orchestrator (M49f)
- POST /jobs/discovery/run                      → Bot discovery (M50)
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
from crawler.data_pipeline import (
    DataPipelineClient,
    HttpDataPipelineClient,
    default_data_pipeline_url,
)
from crawler.db.actor_reader import (
    ActorReader,
    PostgresActorReader,
)
from crawler.db.capability_reader import (
    CapabilityReader,
    PostgresCapabilityReader,
)
from crawler.db.discovery_reader import (
    DiscoveryReader,
    PostgresDiscoveryReader,
)
from crawler.db.orchestrator_repo import (
    OrchestratorReader,
    PostgresOrchestratorReader,
)
from crawler.db.proposal_writer import (
    PostgresProposalWriter,
    ProposalWriter,
)
from crawler.db.risk_reader import (
    PostgresRiskReader,
    RiskReader,
)
from crawler.db.signal_writer import PostgresSignalWriter, SignalWriter
from crawler.discovery.runner import run_discovery
from crawler.dispatcher import DispatcherClients, dispatch_tick
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
from crawler.fetchers.risk import (
    RiskFetcherError,
    RiskFetchRequest,
    run_risk_fetcher,
)
from crawler.fetchers.signal import (
    SignalFetcherError,
    SignalFetchRequest,
    run_signal_fetcher,
)
from crawler.orchestrator import pick_for_tick
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


class SignalTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    capability_key: str = Field(..., min_length=1, max_length=128)
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


class SignalTriggerOut(BaseModel):
    run: CrawlRunOut
    raw_signals_fetched: int
    signals_written: int
    extractor_failures: int
    extractor_total_cost_usd: float


class RiskTriggerBody(BaseModel):
    vision_slug: str = Field(..., min_length=1, max_length=128)
    risk_key: str = Field(..., min_length=1, max_length=128)
    prompt: str | None = Field(default=None, max_length=4000)


class RiskTriggerOut(BaseModel):
    run: CrawlRunOut
    signal_id: str | None
    dr_cached: bool
    scoring_confidence: float | None
    primary_capability_key: str | None
    risk_severity: str
    risk_likelihood: str


class OrchestratorCandidateOut(BaseModel):
    vision_slug: str
    fetcher_kind: str
    key: str
    anchor_composite: float | None
    stale_hours: float
    estimated_cost_usd: float
    ranking_score: float


class OrchestratorTickBody(BaseModel):
    pinned_visions: list[str] | None = Field(default=None, max_length=50)


class OrchestratorTickOut(BaseModel):
    dry_run: bool
    total_candidates: int
    over_budget_skipped: int
    picked: list[OrchestratorCandidateOut]
    per_vision_remaining_usd: dict[str, float]
    # Populated only on dry_run=false.
    dispatch_summary: dict[str, Any] | None = None


class DiscoveryRunBody(BaseModel):
    # Empty list / null → all eligible visions from the orchestrator
    # reader (matches the per-vision $/day cap path).
    vision_slugs: list[str] | None = Field(default=None, max_length=50)
    min_signal_count: int = Field(default=2, ge=1, le=20)
    lookback_days: int = Field(default=7, ge=1, le=30)
    fuzzy_threshold: float = Field(default=0.92, ge=0.5, le=1.0)


class DiscoveryRunOut(BaseModel):
    summary: dict[str, Any]


# --------------------------------------------------------------------------
# Bootstrap helpers (separated so tests can inject)
# --------------------------------------------------------------------------


def _build_deep_research_client() -> DeepResearchClient | None:
    """Construct a DeepResearchClient backed by the real google-genai
    client. Vertex AI is the **only** supported auth path because the
    deep-research-* models live on the Vertex Interactions API; the
    AI Studio `GEMINI_API_KEY` endpoint returns HTML 404 for those
    model names and the resulting failure mode is opaque.

    Returns None — fetcher endpoints then 503 with a clear remediation
    hint — in any of these cases:
      - google-genai SDK not installed
      - `GOOGLE_GENAI_USE_VERTEXAI` is not truthy
      - `GOOGLE_APPLICATION_CREDENTIALS` is empty
      - the SA JSON file at that path doesn't exist
      - Vertex client construction raises

    Setup: drop a Vertex service-account JSON at
    `infra/secrets/vertex-ai-sa.json` per `infra/secrets/README.md`,
    set the four `GOOGLE_*` env vars in `.env`, restart the container.
    """
    try:
        from google import genai  # noqa: PLC0415  (optional dep)
    except ImportError:
        log.warning("crawler: google-genai not installed — Deep Research disabled")
        return None

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    has_api_key = bool((os.environ.get("GEMINI_API_KEY") or "").strip())

    if not use_vertex:
        log.warning(
            "crawler: Deep Research disabled — GOOGLE_GENAI_USE_VERTEXAI is "
            "not set to true. Fetcher endpoints will 503."
            + (
                "  (GEMINI_API_KEY is present but cannot serve deep-research-* models.)"
                if has_api_key
                else ""
            )
        )
        return None
    if not creds:
        log.warning(
            "crawler: Deep Research disabled — GOOGLE_APPLICATION_CREDENTIALS "
            "unset. Set it to /secrets/vertex-ai-sa.json (in-container path)."
        )
        return None
    if not os.path.exists(creds):
        log.error(
            "crawler: Deep Research disabled — SA JSON not found at %s. "
            "Drop a Vertex AI service-account key at infra/secrets/"
            "vertex-ai-sa.json on the host (see infra/secrets/README.md); "
            "docker-compose mounts that directory read-only into /secrets.",
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
            "crawler: Vertex AI client construction failed (%s). "
            "Verify GOOGLE_CLOUD_PROJECT + the SA's roles/aiplatform.user grant.",
            exc,
        )
        return None
    log.info("crawler: Deep Research enabled via Vertex AI (sa=%s)", creds)
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

    # M49d — risk lookup; same shared pool.
    if not hasattr(app.state, "risk_reader"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.risk_reader = PostgresRiskReader(repo.pool)
        else:
            app.state.risk_reader = None

    # M49f — orchestrator reader; same shared pool.
    if not hasattr(app.state, "orchestrator_reader"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.orchestrator_reader = PostgresOrchestratorReader(repo.pool)
        else:
            app.state.orchestrator_reader = None

    # M50 — discovery reader + proposal writer + bot user id resolution.
    # The bot user is created by `pnpm db:seed`; we look it up by
    # bot_kind on startup so reseeding (id rotation) is handled.
    if not hasattr(app.state, "discovery_reader"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.discovery_reader = PostgresDiscoveryReader(repo.pool)
        else:
            app.state.discovery_reader = None
    if not hasattr(app.state, "proposal_writer"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            app.state.proposal_writer = PostgresProposalWriter(repo.pool)
        else:
            app.state.proposal_writer = None
    if not hasattr(app.state, "bot_user_id"):
        repo = getattr(app.state, "repo", None)
        if isinstance(repo, PostgresCrawlRunRepository):
            row = await repo.pool.fetchrow(
                "SELECT id FROM users WHERE bot_kind = 'research_agent' AND is_bot = true LIMIT 1"
            )
            app.state.bot_user_id = row["id"] if row is not None else None
            if app.state.bot_user_id is None:
                log.warning(
                    "crawler: no @feasibility_bot user found — discovery "
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
                "crawler: AGENT_ORCHESTRATION_URL unset — CapabilityFetcher "
                "will return 503 (no SignalExtractor reachable)"
            )
            app.state.agent_client = None

    # M49c — SignalFetcher delegates to data-pipeline's scoped ingest.
    if not hasattr(app.state, "data_pipeline_client"):
        base = default_data_pipeline_url()
        if base:
            app.state.data_pipeline_client = HttpDataPipelineClient(base_url=base)
        else:
            log.warning(
                "crawler: DATA_PIPELINE_URL unset — SignalFetcher "
                "will return 503 (no data-pipeline reachable)"
            )
            app.state.data_pipeline_client = None

    log.info(
        "crawler ready (repo=%s · deep_research=%s · agent_client=%s)",
        "on" if getattr(app.state, "repo", None) is not None else "off",
        "on" if getattr(app.state, "deep_research", None) is not None else "off",
        "on" if getattr(app.state, "agent_client", None) is not None else "off",
    )

    # M49f — 15-minute orchestrator cron, gated on CRAWLER_SCHEDULE
    # env. Default "off" so dev / tests / CI don't auto-burn LLM
    # budget. Set CRAWLER_SCHEDULE=on (or any non-"off" value) in
    # prod to enable; per-vision $/day cap inside the picker keeps
    # cost bounded.
    schedule_mode = os.environ.get("CRAWLER_SCHEDULE", "off").lower()
    if schedule_mode != "off" and not hasattr(app.state, "scheduler"):
        try:
            from apscheduler.schedulers.asyncio import (  # noqa: PLC0415
                AsyncIOScheduler,
            )
            from apscheduler.triggers.interval import (  # noqa: PLC0415
                IntervalTrigger,
            )

            scheduler = AsyncIOScheduler()
            scheduler.add_job(
                _run_orchestrator_tick_job,
                trigger=IntervalTrigger(minutes=15),
                kwargs={"app": app},
                id="orchestrator_tick_15min",
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
            scheduler.start()
            app.state.scheduler = scheduler
            log.info(
                "crawler: orchestrator cron armed (every 15min) — CRAWLER_SCHEDULE=%s",
                schedule_mode,
            )
        except Exception as exc:  # noqa: BLE001 — APScheduler may be missing
            log.error("crawler: failed to start orchestrator cron: %s", exc)
            app.state.scheduler = None
    else:
        app.state.scheduler = getattr(app.state, "scheduler", None)
        if schedule_mode == "off":
            log.info(
                "crawler: orchestrator cron disabled (CRAWLER_SCHEDULE=off) — "
                "use POST /jobs/orchestrator/tick for manual runs"
            )

    try:
        yield
    finally:
        scheduler = getattr(app.state, "scheduler", None)
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
            except Exception:  # noqa: BLE001
                pass
        repo = getattr(app.state, "repo", None)
        if repo is not None and isinstance(repo, PostgresCrawlRunRepository):
            await repo.close()


async def _run_orchestrator_tick_job(*, app: FastAPI) -> None:
    """Cron entrypoint — wraps `pick_for_tick` + `dispatch_tick` with
    full client wiring from app.state. Logs + swallows errors so a bad
    tick doesn't kill the scheduler."""
    reader = getattr(app.state, "orchestrator_reader", None)
    if reader is None:
        log.warning("crawler cron: orchestrator_reader unset — skipping tick")
        return
    try:
        pick = await pick_for_tick(reader=reader)
        if not pick.picked:
            log.info(
                "crawler cron: tick picked 0/%d candidates (over_budget_skipped=%d)",
                pick.total_candidates,
                pick.over_budget_skipped,
            )
            return
        # Best-effort: only dispatch if every client is wired. If any
        # is missing we log + skip rather than partial-execute.
        deps = [
            getattr(app.state, "repo", None),
            getattr(app.state, "deep_research", None),
            getattr(app.state, "agent_client", None),
            getattr(app.state, "capability_reader", None),
            getattr(app.state, "actor_reader", None),
            getattr(app.state, "risk_reader", None),
            getattr(app.state, "signal_writer", None),
            getattr(app.state, "data_pipeline_client", None),
        ]
        if any(d is None for d in deps):
            log.warning(
                "crawler cron: missing client(s) — skipping dispatch "
                "(repo=%s dr=%s agent=%s cap=%s actor=%s risk=%s writer=%s pipeline=%s)",
                *["on" if d is not None else "off" for d in deps],
            )
            return
        clients = DispatcherClients(
            runs_repo=deps[0],
            capability_reader=deps[3],
            actor_reader=deps[4],
            risk_reader=deps[5],
            signal_writer=deps[6],
            deep_research=deps[1],
            agent_client=deps[2],
            data_pipeline=deps[7],
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        app.state.last_orchestrator_tick = summary.to_summary_dict()
    except Exception as exc:  # noqa: BLE001
        log.error("crawler cron: orchestrator tick failed: %s", exc)


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
                    "Deep Research not configured. The deep-research-* "
                    "models live on the Vertex AI Interactions API; the "
                    "AI Studio GEMINI_API_KEY endpoint cannot serve them. "
                    "(1) Drop a Vertex SA JSON at "
                    "infra/secrets/vertex-ai-sa.json (see "
                    "infra/secrets/README.md). "
                    "(2) Set GOOGLE_GENAI_USE_VERTEXAI=true + "
                    "GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS="
                    "/secrets/vertex-ai-sa.json in .env. "
                    "(3) Restart the crawler container."
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

    def _require_risk_reader() -> RiskReader:
        reader = getattr(app.state, "risk_reader", None)
        if reader is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — risk_reader not configured (needs DATABASE_URL)",
            )
        return reader

    def _require_orchestrator_reader() -> OrchestratorReader:
        reader = getattr(app.state, "orchestrator_reader", None)
        if reader is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "crawler unavailable — orchestrator_reader not configured (needs DATABASE_URL)"
                ),
            )
        return reader

    def _require_discovery_reader() -> DiscoveryReader:
        reader = getattr(app.state, "discovery_reader", None)
        if reader is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — discovery_reader not configured",
            )
        return reader

    def _require_proposal_writer() -> ProposalWriter:
        writer = getattr(app.state, "proposal_writer", None)
        if writer is None:
            raise HTTPException(
                status_code=503,
                detail="crawler unavailable — proposal_writer not configured",
            )
        return writer

    def _require_bot_user_id() -> str:
        bot_id = getattr(app.state, "bot_user_id", None)
        if not bot_id:
            raise HTTPException(
                status_code=503,
                detail=("crawler unavailable — no @feasibility_bot user; run `pnpm db:seed`"),
            )
        return bot_id

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

    def _require_data_pipeline_client() -> DataPipelineClient:
        client = getattr(app.state, "data_pipeline_client", None)
        if client is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "crawler unavailable — DATA_PIPELINE_URL not configured "
                    "(SignalFetcher cannot reach the M39 ingest pipeline)"
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
                "data_pipeline_client": getattr(app.state, "data_pipeline_client", None)
                is not None,
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
            scoring_confidence=out.scoring.scoring.confidence if out.scoring is not None else None,
        )

    @app.post("/jobs/discovery/run", response_model=DiscoveryRunOut)
    async def discovery_run(body: DiscoveryRunBody | None = None) -> DiscoveryRunOut:
        """M50 — scan untagged signals for unknown actor candidates and
        draft `add_actor` CommunityProposal rows. Idempotent: same
        candidate name within the open-proposal window is skipped."""
        discovery_reader = _require_discovery_reader()
        proposal_writer = _require_proposal_writer()
        bot_id = _require_bot_user_id()
        body = body or DiscoveryRunBody()

        slugs = body.vision_slugs
        if not slugs:
            orch_reader = _require_orchestrator_reader()
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

    @app.post("/jobs/orchestrator/tick", response_model=OrchestratorTickOut)
    async def orchestrator_tick(
        body: OrchestratorTickBody | None = None,
        dry_run: bool = True,
    ) -> OrchestratorTickOut:
        """Pick the next batch of (vision × fetcher × key) to run.

        `dry_run=true` (default) returns what *would* run without
        executing — cheap, no LLM cost. `dry_run=false` dispatches
        each picked candidate through the matching fetcher and
        returns a per-outcome summary.
        """
        reader = _require_orchestrator_reader()
        pinned = set(body.pinned_visions) if body and body.pinned_visions else set()
        pick = await pick_for_tick(reader=reader, pinned_visions=pinned)

        picked_out = [
            OrchestratorCandidateOut(
                vision_slug=c.vision_slug,
                fetcher_kind=c.fetcher_kind,
                key=c.key,
                anchor_composite=c.anchor_composite,
                stale_hours=round(c.stale_hours, 2),
                estimated_cost_usd=round(c.estimated_cost_usd, 4),
                ranking_score=round(c.ranking_score, 2),
            )
            for c in pick.picked
        ]

        if dry_run:
            return OrchestratorTickOut(
                dry_run=True,
                total_candidates=pick.total_candidates,
                over_budget_skipped=pick.over_budget_skipped,
                picked=picked_out,
                per_vision_remaining_usd={
                    k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
                },
                dispatch_summary=None,
            )

        # Execute. All per-fetcher clients must be wired or we 503.
        repo = _require_repo()
        dr = _require_deep_research()
        agent = _require_agent_client()
        cap_reader = _require_capability_reader()
        actor_reader = _require_actor_reader()
        risk_reader = _require_risk_reader()
        writer = _require_signal_writer()
        pipeline = _require_data_pipeline_client()
        clients = DispatcherClients(
            runs_repo=repo,
            capability_reader=cap_reader,
            actor_reader=actor_reader,
            risk_reader=risk_reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
            data_pipeline=pipeline,
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        return OrchestratorTickOut(
            dry_run=False,
            total_candidates=pick.total_candidates,
            over_budget_skipped=pick.over_budget_skipped,
            picked=picked_out,
            per_vision_remaining_usd={
                k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
            },
            dispatch_summary=summary.to_summary_dict(),
        )

    @app.post("/fetchers/risk/run", response_model=RiskTriggerOut)
    async def risk_run(body: RiskTriggerBody) -> RiskTriggerOut:
        repo = _require_repo()
        dr = _require_deep_research()
        reader = _require_risk_reader()
        writer = _require_signal_writer()
        agent = _require_agent_client()
        log.info(
            "crawler: risk triggered vision=%s risk=%s",
            body.vision_slug,
            body.risk_key,
        )
        try:
            out = await run_risk_fetcher(
                RiskFetchRequest(
                    vision_slug=body.vision_slug,
                    risk_key=body.risk_key,
                    prompt=body.prompt,
                ),
                runs_repo=repo,
                risk_reader=reader,
                signal_writer=writer,
                deep_research=dr,
                agent_client=agent,
            )
        except RiskFetcherError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return RiskTriggerOut(
            run=CrawlRunOut.from_row(out.run),
            signal_id=out.signal_id,
            dr_cached=out.deep_research.cached,
            scoring_confidence=out.scoring.scoring.confidence if out.scoring is not None else None,
            primary_capability_key=out.risk.primary_capability.key
            if out.risk.primary_capability is not None
            else None,
            risk_severity=out.risk.severity,
            risk_likelihood=out.risk.likelihood,
        )

    @app.post("/fetchers/signal/run", response_model=SignalTriggerOut)
    async def signal_run(body: SignalTriggerBody) -> SignalTriggerOut:
        repo = _require_repo()
        reader = _require_capability_reader()
        pipeline = _require_data_pipeline_client()
        log.info(
            "crawler: signal triggered vision=%s cap=%s",
            body.vision_slug,
            body.capability_key,
        )
        try:
            out = await run_signal_fetcher(
                SignalFetchRequest(
                    vision_slug=body.vision_slug,
                    capability_key=body.capability_key,
                    lookback_days=body.lookback_days,
                    per_capability_limit=body.per_capability_limit,
                ),
                runs_repo=repo,
                capability_reader=reader,
                data_pipeline=pipeline,
            )
        except SignalFetcherError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return SignalTriggerOut(
            run=CrawlRunOut.from_row(out.run),
            raw_signals_fetched=out.ingest.raw_signals_fetched if out.ingest else 0,
            signals_written=out.ingest.signals_written if out.ingest else 0,
            extractor_failures=out.ingest.extractor_failures if out.ingest else 0,
            extractor_total_cost_usd=out.ingest.extractor_total_cost_usd if out.ingest else 0.0,
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
            scoring_confidence=out.scoring.scoring.confidence if out.scoring is not None else None,
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
