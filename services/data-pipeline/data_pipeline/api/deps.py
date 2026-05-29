"""Dependency providers for the data-pipeline router modules.

Each ``require_*`` reads its slot off ``app.state`` and raises a 503 with
a copy-paste-fixable error message when the underlying client / pool /
seed isn't configured. Free functions taking ``app: FastAPI`` instead
of FastAPI ``Depends`` so router modules can call them directly without
threading ``Request`` through every signature.
"""

from __future__ import annotations

from agent_tools import GroundedResearchClient
from fastapi import FastAPI, HTTPException

from data_pipeline.agents import AgentClient
from data_pipeline.crawl_run_repo import CrawlRunRepository
from data_pipeline.db.actor_reader import ActorReader
from data_pipeline.db.capability_reader import CapabilityReader
from data_pipeline.db.discovery_reader import DiscoveryReader
from data_pipeline.db.orchestrator_repo import OrchestratorReader
from data_pipeline.db.proposal_writer import ProposalWriter
from data_pipeline.db.risk_reader import RiskReader
from data_pipeline.db.signal_writer import SignalWriter
from data_pipeline.deep_research.fetchers.signal import SignalIngestFn
from data_pipeline.queue import QueueClient


def require_crawl_repo(app: FastAPI) -> CrawlRunRepository:
    repo = getattr(app.state, "crawl_runs_repo", None)
    if repo is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — DATABASE_URL not configured",
        )
    return repo


def require_deep_research(app: FastAPI) -> GroundedResearchClient:
    dr = getattr(app.state, "deep_research", None)
    if dr is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Grounded research not configured. Two auth paths supported "
                "(env-driven): "
                "(A) Vertex AI — drop a Vertex SA JSON at "
                "infra/secrets/vertex-ai-sa.json + set GOOGLE_GENAI_USE_VERTEXAI=true + "
                "GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json in .env. "
                "(B) AI Studio — set GEMINI_API_KEY in .env. "
                "Restart the data-pipeline container after either."
            ),
        )
    return dr


def require_capability_reader(app: FastAPI) -> CapabilityReader:
    r = getattr(app.state, "capability_reader", None)
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — capability_reader not configured (DATABASE_URL)",
        )
    return r


def require_actor_reader(app: FastAPI) -> ActorReader:
    r = getattr(app.state, "actor_reader", None)
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — actor_reader not configured (DATABASE_URL)",
        )
    return r


def require_risk_reader(app: FastAPI) -> RiskReader:
    r = getattr(app.state, "risk_reader", None)
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — risk_reader not configured (DATABASE_URL)",
        )
    return r


def require_orchestrator_reader(app: FastAPI) -> OrchestratorReader:
    r = getattr(app.state, "orchestrator_reader", None)
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — orchestrator_reader not configured (DATABASE_URL)",
        )
    return r


def require_discovery_reader(app: FastAPI) -> DiscoveryReader:
    r = getattr(app.state, "discovery_reader", None)
    if r is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — discovery_reader not configured",
        )
    return r


def require_proposal_writer(app: FastAPI) -> ProposalWriter:
    w = getattr(app.state, "proposal_writer", None)
    if w is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — proposal_writer not configured",
        )
    return w


def require_bot_user_id(app: FastAPI) -> str:
    bot_id = getattr(app.state, "bot_user_id", None)
    if not bot_id:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — no @feasibility_bot user; run `pnpm db:seed`",
        )
    return bot_id


def require_signal_writer(app: FastAPI) -> SignalWriter:
    w = getattr(app.state, "signal_writer", None)
    if w is None:
        raise HTTPException(
            status_code=503,
            detail="data-pipeline unavailable — signal_writer not configured (DATABASE_URL)",
        )
    return w


def require_agent_client(app: FastAPI) -> AgentClient:
    c = getattr(app.state, "agent_client", None)
    if c is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "data-pipeline unavailable — AGENT_ORCHESTRATION_URL not configured "
                "(SignalExtractor unreachable)"
            ),
        )
    return c


def require_signal_ingest_fn(app: FastAPI) -> SignalIngestFn:
    fn = getattr(app.state, "signal_ingest_fn", None)
    if fn is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "data-pipeline unavailable — DATABASE_URL not configured "
                "(SignalFetcher needs signal_repo to run M39 ingest)"
            ),
        )
    return fn


def require_queue(app: FastAPI) -> QueueClient:
    q = getattr(app.state, "queue_client", None)
    if q is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "data-pipeline unavailable — REDIS_URL not configured "
                "or Redis unreachable (no worker queue)"
            ),
        )
    return q
