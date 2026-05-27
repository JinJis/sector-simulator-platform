"""ARQ task functions — the worker-side entry points.

Each `*_task` corresponds to one task name registered in client.py.
Signatures are positional-friendly because ARQ serializes args via
msgpack — we keep the wire shape small + boring (run_id + a request
dict). The task pulls deps from `ctx` (populated by `WorkerSettings.
on_startup`) and delegates to the existing `run_*_fetcher` functions
with `existing_run` set to the row the HTTP trigger already created.

All tasks share the same error contract: don't raise out of the
task. The underlying fetcher already records errors on the CrawlRun
row; the cockpit reads from there. Raising would mark the ARQ job
itself as failed, which Redis stores separately and the user can't
see — duplicates state with no upside.
"""

from __future__ import annotations

import logging
from typing import Any

from data_pipeline.deep_research.digest import (
    DigestRequest,
    run_deep_research_digest,
)
from data_pipeline.deep_research.fetchers.actor import (
    ActorFetchRequest,
    run_actor_fetcher,
)
from data_pipeline.deep_research.fetchers.capability import (
    CapabilityFetchRequest,
    run_capability_fetcher,
)
from data_pipeline.deep_research.fetchers.hello_world import (
    HelloWorldRunRequest,
    run_hello_world,
)
from data_pipeline.deep_research.fetchers.risk import (
    RiskFetchRequest,
    run_risk_fetcher,
)
from data_pipeline.deep_research.fetchers.signal import (
    SignalFetchRequest,
    run_signal_fetcher,
)

log = logging.getLogger(__name__)


async def _load_existing_run(ctx: dict[str, Any], run_id: str):
    """Common path: look up the queued CrawlRun the HTTP trigger
    created. Returns None when the row vanished (manually deleted, or
    the queue picked up a job from a previous deploy whose DB was
    wiped) — task is a no-op in that case."""
    runs_repo = ctx["runs_repo"]
    row = await runs_repo.get(run_id)
    if row is None:
        log.warning("task: CrawlRun %s not found, skipping", run_id)
    return row


# --------------------------------------------------------------------------
# One function per fetcher kind. Signatures must match the names
# registered in `WorkerSettings.functions` (the function's __name__
# is what ARQ stores in Redis).
# --------------------------------------------------------------------------


async def hello_world(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_hello_world(
            HelloWorldRunRequest(**request),
            repo=ctx["runs_repo"],
            deep_research=ctx["deep_research"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("hello_world task crashed for run %s: %s", run_id, exc)


async def capability(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_capability_fetcher(
            CapabilityFetchRequest(**request),
            runs_repo=ctx["runs_repo"],
            capability_reader=ctx["capability_reader"],
            signal_writer=ctx["signal_writer"],
            deep_research=ctx["deep_research"],
            agent_client=ctx["agent_client"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("capability task crashed for run %s: %s", run_id, exc)


async def actor(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_actor_fetcher(
            ActorFetchRequest(**request),
            runs_repo=ctx["runs_repo"],
            actor_reader=ctx["actor_reader"],
            signal_writer=ctx["signal_writer"],
            deep_research=ctx["deep_research"],
            agent_client=ctx["agent_client"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("actor task crashed for run %s: %s", run_id, exc)


async def risk(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_risk_fetcher(
            RiskFetchRequest(**request),
            runs_repo=ctx["runs_repo"],
            risk_reader=ctx["risk_reader"],
            signal_writer=ctx["signal_writer"],
            deep_research=ctx["deep_research"],
            agent_client=ctx["agent_client"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("risk task crashed for run %s: %s", run_id, exc)


async def signal(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_signal_fetcher(
            SignalFetchRequest(**request),
            runs_repo=ctx["runs_repo"],
            capability_reader=ctx["capability_reader"],
            signal_ingest_fn=ctx["signal_ingest_fn"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("signal task crashed for run %s: %s", run_id, exc)


async def digest(ctx: dict[str, Any], run_id: str, request: dict[str, Any]) -> None:
    run = await _load_existing_run(ctx, run_id)
    if run is None:
        return
    try:
        await run_deep_research_digest(
            DigestRequest(**request),
            runs_repo=ctx["runs_repo"],
            signal_repo=ctx["signal_repo"],
            signal_writer=ctx["signal_writer"],
            deep_research=ctx["deep_research"],
            agent_client=ctx["agent_client"],
            existing_run=run,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("digest task crashed for run %s: %s", run_id, exc)


# Exported list — must match the task name constants in client.py.
# WorkerSettings.functions = TASK_FUNCTIONS.
TASK_FUNCTIONS = [hello_world, capability, actor, risk, signal, digest]
