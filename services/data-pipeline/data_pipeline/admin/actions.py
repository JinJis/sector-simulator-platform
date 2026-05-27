"""SQLAdmin row-action helpers.

Decorator-driven actions on ModelView subclasses (see `views.py`) all
funnel through these helpers so the trigger logic and the proposal
decide logic live in one place. Each helper:

  1. Reaches the parent FastAPI app's `state` (where the lifespan
     stashed the asyncpg repos + ARQ queue client + bot user id).
  2. Pulls the selected row(s) via SQLAdmin's own SQLAlchemy session.
  3. For trigger actions: writes a CrawlRun row + enqueues an ARQ job
     using the same `enqueue_*` helpers the HTTP `/fetchers/*/run`
     endpoints call — so the cockpit and the API can't drift apart.
  4. Returns a `RedirectResponse` back to the list page with a short
     summary in `?msg=...` (used by the list template for a flash, if
     the operator added one; otherwise just URL-visible state).

Why this module exists rather than calling the HTTP endpoints over
loopback: we're already in-process. The HTTP path would force JSON
serialization + an extra Uvicorn round-trip for no win.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, is_dataclass
from typing import Any

from fastapi import FastAPI
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import RedirectResponse

from data_pipeline.admin import models as m
from data_pipeline.crawl_run_repo import CrawlRunRepository
from data_pipeline.db.proposal_writer import DecideResult, ProposalWriter
from data_pipeline.deep_research.digest import (
    DigestRequest,
    enqueue_deep_research_digest,
)
from data_pipeline.deep_research.fetchers.actor import (
    ActorFetchRequest,
    enqueue_actor_fetcher,
)
from data_pipeline.deep_research.fetchers.capability import (
    CapabilityFetchRequest,
    enqueue_capability_fetcher,
)
from data_pipeline.deep_research.fetchers.hello_world import (
    HelloWorldRunRequest,
    enqueue_hello_world,
)
from data_pipeline.deep_research.fetchers.risk import (
    RiskFetchRequest,
    enqueue_risk_fetcher,
)
from data_pipeline.deep_research.fetchers.signal import (
    SignalFetchRequest,
    enqueue_signal_fetcher,
)
from data_pipeline.queue.client import (
    TASK_ACTOR,
    TASK_CAPABILITY,
    TASK_DIGEST,
    TASK_HELLO_WORLD,
    TASK_RISK,
    TASK_SIGNAL,
    QueueClient,
)

log = logging.getLogger(__name__)


# ─── parent-app lookup ────────────────────────────────────────────────


_PARENT_APP_ATTR = "parent_app"


def parent_app(request: Request) -> FastAPI:
    """SQLAdmin mounts its own Starlette under the FastAPI app, so
    `request.app` returns the inner Starlette. `mount.py` stashes a
    reference to the outer FastAPI on the inner app's state; pull it
    back here so the action can read the lifespan-built deps."""
    inner = request.app
    parent = getattr(inner.state, _PARENT_APP_ATTR, None)
    if parent is None:
        raise RuntimeError(
            "admin actions: parent_app reference not wired — check mount_admin"
        )
    return parent


def _crawl_repo(request: Request) -> CrawlRunRepository:
    state = parent_app(request).state
    repo = getattr(state, "crawl_runs_repo", None)
    if repo is None:
        raise RuntimeError(
            "admin actions: data-pipeline not ready — crawl_runs_repo unset "
            "(DATABASE_URL missing or DB unreachable)"
        )
    return repo


def _queue(request: Request) -> QueueClient:
    state = parent_app(request).state
    q = getattr(state, "queue_client", None)
    if q is None:
        raise RuntimeError(
            "admin actions: queue client unavailable — REDIS_URL missing or Redis "
            "unreachable; the worker can't pick up jobs"
        )
    return q


def _proposal_writer(request: Request) -> ProposalWriter:
    state = parent_app(request).state
    w = getattr(state, "proposal_writer", None)
    if w is None:
        raise RuntimeError(
            "admin actions: proposal_writer unavailable — DATABASE_URL not set"
        )
    return w


def _admin_user_label(request: Request) -> str:
    """Audit author for actions taken from SQLAdmin. We don't have a
    user record per-session in this single-account scheme — stamp the
    configured ADMIN_EMAIL when available, fall back to a stable label
    so the audit row never has NULL author."""
    import os  # noqa: PLC0415

    email = os.environ.get("ADMIN_EMAIL", "").strip()
    return email or "admin@sqladmin"


# ─── enqueue helpers (one per fetcher kind) ───────────────────────────


def _request_to_dict(req: Any) -> dict[str, Any]:
    """Same shape as `main.py :: _request_to_dict` — kept in sync so the
    ARQ wire format stays identical regardless of producer."""
    if is_dataclass(req):
        return asdict(req)
    return dict(req)


async def enqueue_capability(
    request: Request, *, vision_slug: str, capability_key: str
) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = CapabilityFetchRequest(
        vision_slug=vision_slug, capability_key=capability_key
    )
    run = await enqueue_capability_fetcher(req, runs_repo=repo)
    await queue.enqueue(TASK_CAPABILITY, run.id, _request_to_dict(req), job_id=run.id)
    log.info(
        "admin action: capability enqueued vision=%s cap=%s run=%s",
        vision_slug,
        capability_key,
        run.id,
    )
    return run.id


async def enqueue_actor(
    request: Request, *, vision_slug: str, actor_key: str
) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = ActorFetchRequest(vision_slug=vision_slug, actor_key=actor_key)
    run = await enqueue_actor_fetcher(req, runs_repo=repo)
    await queue.enqueue(TASK_ACTOR, run.id, _request_to_dict(req), job_id=run.id)
    log.info(
        "admin action: actor enqueued vision=%s actor=%s run=%s",
        vision_slug,
        actor_key,
        run.id,
    )
    return run.id


async def enqueue_risk(
    request: Request, *, vision_slug: str, risk_key: str
) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = RiskFetchRequest(vision_slug=vision_slug, risk_key=risk_key)
    run = await enqueue_risk_fetcher(req, runs_repo=repo)
    await queue.enqueue(TASK_RISK, run.id, _request_to_dict(req), job_id=run.id)
    log.info(
        "admin action: risk enqueued vision=%s risk=%s run=%s",
        vision_slug,
        risk_key,
        run.id,
    )
    return run.id


async def enqueue_signal(
    request: Request, *, vision_slug: str, capability_key: str
) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = SignalFetchRequest(vision_slug=vision_slug, capability_key=capability_key)
    run = await enqueue_signal_fetcher(req, runs_repo=repo)
    await queue.enqueue(TASK_SIGNAL, run.id, _request_to_dict(req), job_id=run.id)
    log.info(
        "admin action: signal enqueued vision=%s cap=%s run=%s",
        vision_slug,
        capability_key,
        run.id,
    )
    return run.id


async def enqueue_hello(request: Request, *, vision_slug: str) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = HelloWorldRunRequest(vision_slug=vision_slug)
    run = await enqueue_hello_world(req, repo=repo)
    await queue.enqueue(TASK_HELLO_WORLD, run.id, _request_to_dict(req), job_id=run.id)
    log.info("admin action: hello-world enqueued vision=%s run=%s", vision_slug, run.id)
    return run.id


async def enqueue_digest(request: Request, *, vision_slug: str) -> str:
    repo = _crawl_repo(request)
    queue = _queue(request)
    req = DigestRequest(vision_slug=vision_slug)
    run = await enqueue_deep_research_digest(req, runs_repo=repo)
    await queue.enqueue(TASK_DIGEST, run.id, _request_to_dict(req), job_id=run.id)
    log.info("admin action: digest enqueued vision=%s run=%s", vision_slug, run.id)
    return run.id


# ─── proposal decide ──────────────────────────────────────────────────


async def decide_proposals(
    request: Request, ids: list[str], *, status: str
) -> DecideResult:
    """Bulk-decide community proposals. Mirrors the sector-service
    `bulkDecide` mutation but routed through the in-process asyncpg
    writer so the cockpit doesn't need to roundtrip to the Node service.
    """
    writer = _proposal_writer(request)
    return await writer.decide(
        ids,
        status=status,
        reason=None,  # no free-text reason from the SQLAdmin button; rev-up if needed
        decided_by_id=None,  # single-account admin doesn't have a user row
        decided_by_label=_admin_user_label(request),
    )


# ─── row lookups via SQLAdmin session ─────────────────────────────────


async def load_pks_as_sectors(view: Any, pks: list[str]) -> list[m.Sector]:
    """Fetch Sector rows by PK list. Uses the ModelView's session_maker
    so we share its engine/pool rather than building a parallel one."""
    if not pks:
        return []
    async with view.session_maker() as session:
        rows = (await session.execute(select(m.Sector).where(m.Sector.id.in_(pks)))).scalars().all()
    return list(rows)


async def load_pks_as_capabilities(view: Any, pks: list[str]) -> list[m.Capability]:
    if not pks:
        return []
    async with view.session_maker() as session:
        rows = (
            await session.execute(
                select(m.Capability).where(m.Capability.id.in_(pks))
            )
        ).scalars().all()
    return list(rows)


async def load_pks_as_risks(view: Any, pks: list[str]) -> list[m.Risk]:
    if not pks:
        return []
    async with view.session_maker() as session:
        rows = (
            await session.execute(select(m.Risk).where(m.Risk.id.in_(pks)))
        ).scalars().all()
    return list(rows)


async def load_pks_as_vision_actors(
    view: Any, pks: list[str]
) -> list[tuple[m.VisionActor, m.Actor]]:
    """VisionActor rows joined to their Actor — the trigger needs the
    actor's `key` (slug) but the join table only stores actor_id."""
    if not pks:
        return []
    async with view.session_maker() as session:
        result = await session.execute(
            select(m.VisionActor, m.Actor)
            .join(m.Actor, m.Actor.id == m.VisionActor.actor_id)
            .where(m.VisionActor.id.in_(pks))
        )
        return [(va, actor) for va, actor in result.all()]


def back_to_list(request: Request, identity: str, msg: str) -> RedirectResponse:
    """Build a redirect back to the model's list page with a message
    query-stringed on. SQLAdmin's default list template doesn't render
    `?msg=`, but the URL is human-readable and curl-friendly, and
    leaving the hook here means a custom template (or the queue page)
    can pick it up later."""
    url = request.url_for("admin:list", identity=identity).include_query_params(
        msg=msg
    )
    return RedirectResponse(url, status_code=303)


def parse_pks(request: Request) -> list[str]:
    raw = request.query_params.get("pks", "")
    return [p for p in raw.split(",") if p]
