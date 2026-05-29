"""On-demand /fetchers/* endpoints — enqueue one ARQ job per call.

Each handler is the thin HTTP face for one deep_research fetcher. The
HTTP layer writes the CrawlRun row + pushes the request to ARQ; the
worker side (data_pipeline.queue.worker) dequeues and runs the actual
grounded-research call. Returns the CrawlRun row immediately so the
cockpit can poll for completion.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, FastAPI

from data_pipeline.api.deps import require_crawl_repo, require_queue
from data_pipeline.api.schemas import (
    ActorTriggerBody,
    ActorTriggerOut,
    CapabilityTriggerBody,
    CapabilityTriggerOut,
    CrawlRunOut,
    HelloWorldTriggerBody,
    HelloWorldTriggerOut,
    RiskTriggerBody,
    RiskTriggerOut,
    SignalTriggerBody,
    SignalTriggerOut,
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
    TASK_HELLO_WORLD,
    TASK_RISK,
    TASK_SIGNAL,
)

log = logging.getLogger("data_pipeline")


def _request_to_dict(req: Any) -> dict[str, Any]:
    """Serialize a ``@dataclass(frozen=True, slots=True)`` FetchRequest
    into a msgpack-safe dict for ARQ's wire format. Worker side rehydrates
    via ``Request(**dict)``."""
    from dataclasses import asdict, is_dataclass  # noqa: PLC0415

    if is_dataclass(req):
        return asdict(req)
    return dict(req)


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["fetchers"])

    @router.post("/fetchers/capability/run", response_model=CapabilityTriggerOut)
    async def capability_run(body: CapabilityTriggerBody) -> CapabilityTriggerOut:
        repo = require_crawl_repo(app)
        queue = require_queue(app)
        log.info(
            "capability enqueued vision=%s cap=%s", body.vision_slug, body.capability_key
        )
        req = CapabilityFetchRequest(
            vision_slug=body.vision_slug,
            capability_key=body.capability_key,
            prompt=body.prompt,
        )
        run = await enqueue_capability_fetcher(req, runs_repo=repo)
        await queue.enqueue(
            TASK_CAPABILITY, run.id, _request_to_dict(req), job_id=run.id
        )
        return CapabilityTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
        )

    @router.post("/fetchers/actor/run", response_model=ActorTriggerOut)
    async def actor_run(body: ActorTriggerBody) -> ActorTriggerOut:
        repo = require_crawl_repo(app)
        queue = require_queue(app)
        log.info(
            "actor enqueued vision=%s actor=%s", body.vision_slug, body.actor_key
        )
        req = ActorFetchRequest(
            vision_slug=body.vision_slug,
            actor_key=body.actor_key,
            prompt=body.prompt,
        )
        run = await enqueue_actor_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_ACTOR, run.id, _request_to_dict(req), job_id=run.id)
        return ActorTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
            matched_actor_key=None,
            primary_capability_key=None,
        )

    @router.post("/fetchers/risk/run", response_model=RiskTriggerOut)
    async def risk_run(body: RiskTriggerBody) -> RiskTriggerOut:
        repo = require_crawl_repo(app)
        queue = require_queue(app)
        log.info("risk enqueued vision=%s risk=%s", body.vision_slug, body.risk_key)
        req = RiskFetchRequest(
            vision_slug=body.vision_slug,
            risk_key=body.risk_key,
            prompt=body.prompt,
        )
        run = await enqueue_risk_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_RISK, run.id, _request_to_dict(req), job_id=run.id)
        return RiskTriggerOut(
            run=CrawlRunOut.from_row(run),
            signal_id=None,
            dr_cached=False,
            scoring_confidence=None,
            primary_capability_key=None,
            risk_severity="unknown",
            risk_likelihood="unknown",
        )

    @router.post("/fetchers/signal/run", response_model=SignalTriggerOut)
    async def signal_run(body: SignalTriggerBody) -> SignalTriggerOut:
        repo = require_crawl_repo(app)
        queue = require_queue(app)
        log.info("signal enqueued vision=%s cap=%s", body.vision_slug, body.capability_key)
        req = SignalFetchRequest(
            vision_slug=body.vision_slug,
            capability_key=body.capability_key,
            lookback_days=body.lookback_days,
            per_capability_limit=body.per_capability_limit,
        )
        run = await enqueue_signal_fetcher(req, runs_repo=repo)
        await queue.enqueue(TASK_SIGNAL, run.id, _request_to_dict(req), job_id=run.id)
        return SignalTriggerOut(
            run=CrawlRunOut.from_row(run),
            raw_signals_fetched=0,
            signals_written=0,
            extractor_failures=0,
            extractor_total_cost_usd=0.0,
        )

    @router.post("/fetchers/hello-world/run", response_model=HelloWorldTriggerOut)
    async def hello_world_run(body: HelloWorldTriggerBody) -> HelloWorldTriggerOut:
        repo = require_crawl_repo(app)
        queue = require_queue(app)
        log.info("hello-world enqueued vision=%s", body.vision_slug)
        req = HelloWorldRunRequest(
            vision_slug=body.vision_slug, prompt=body.prompt
        )
        run = await enqueue_hello_world(req, repo=repo)
        await queue.enqueue(
            TASK_HELLO_WORLD, run.id, _request_to_dict(req), job_id=run.id
        )
        return HelloWorldTriggerOut(
            run=CrawlRunOut.from_row(run),
            cached=False,
        )

    return router
