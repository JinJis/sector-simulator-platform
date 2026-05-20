"""Workflow protocol + runner + first concrete workflow.

The protocol mirrors Temporal's shape so the runner can be swapped for
a Temporal-backed implementation later without touching consumers:

- A workflow is async, takes a typed input, returns a typed output.
- The runner assigns an `id`, kicks the coroutine off, and tracks status.
- Status transitions: pending → running → (succeeded | failed | cancelled).

State persistence goes through a `WorkflowRepository` (see repo.py).
The default in-memory repo preserves the previous behavior; pass a
`PostgresWorkflowRepository` to survive process restarts.

What this runner deliberately does NOT do:
- Retries, timeouts, signals — that's all Temporal's job.
- Concurrency limits — every workflow gets its own task. Phase 3 problem.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Generic, Protocol, TypeVar

from agent_tools import CostMeter, LLMClient
from pydantic import BaseModel

from agent_orchestration.prompts import load_prompt
from agent_orchestration.repo import InMemoryWorkflowRepository, WorkflowRepository
from agent_orchestration.schemas import (
    Decomposition,
    DecompositionRequest,
    WorkflowRecord,
    WorkflowStatus,
)

log = logging.getLogger("agent_orchestration")


InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)


class Workflow(Protocol, Generic[InputT, OutputT]):
    """Minimal Temporal-shaped contract every workflow implements."""

    kind: str

    async def run(self, request: InputT, *, cost_meter: CostMeter) -> OutputT: ...


# ---- The runner ----------------------------------------------------------


class WorkflowRunner:
    """Scheduler with pluggable persistence.

    `start()` returns the assigned id immediately; the workflow body
    executes in a background task and writes state changes through the
    `WorkflowRepository`. The HTTP layer polls via `get()` and `list()`,
    which read from the repo (so a workflow created in a previous
    process is still visible).

    The runner still keeps per-workflow `CostMeter`s in memory — they
    don't outlive the process, which is fine because they're only used
    for the final cost roll-up at workflow completion. Restart safety
    for in-flight workflows is handled by `mark_dangling_as_failed()`
    on startup (see main.py).
    """

    def __init__(self, repo: WorkflowRepository | None = None) -> None:
        self._repo: WorkflowRepository = repo or InMemoryWorkflowRepository()
        self._meters: dict[str, CostMeter] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._lock = asyncio.Lock()

    @property
    def repo(self) -> WorkflowRepository:
        return self._repo

    # ---- mutation ----

    async def start(
        self,
        *,
        kind: str,
        request: BaseModel,
        run: Callable[[CostMeter], Awaitable[BaseModel]],
    ) -> WorkflowRecord:
        """Schedule a workflow. `run(cost_meter)` is the coroutine factory —
        accepted as a callable so callers can close over their workflow
        instance + the typed input without us needing generic gymnastics
        in the runner."""
        wid = f"wf_{secrets.token_hex(8)}"
        now = datetime.now(UTC)
        meter = CostMeter()
        record = WorkflowRecord(
            id=wid,
            kind=kind,
            status=WorkflowStatus.pending,
            created_at=now,
            updated_at=now,
            input=request.model_dump(),
        )
        async with self._lock:
            self._meters[wid] = meter
        await self._repo.create(record)

        task = asyncio.create_task(self._execute(wid, run, meter))
        self._tasks[wid] = task
        return record

    async def _execute(
        self,
        wid: str,
        run: Callable[[CostMeter], Awaitable[BaseModel]],
        meter: CostMeter,
    ) -> None:
        await self._transition(wid, WorkflowStatus.running)
        try:
            output = await run(meter)
            await self._finish(wid, status=WorkflowStatus.succeeded, output=output)
        except asyncio.CancelledError:
            await self._finish(
                wid, status=WorkflowStatus.cancelled, error="cancelled"
            )
            raise
        except Exception as e:
            log.exception("workflow %s failed", wid)
            await self._finish(wid, status=WorkflowStatus.failed, error=str(e))

    async def _transition(self, wid: str, status: WorkflowStatus) -> None:
        rec = await self._repo.get(wid)
        if rec is None:
            log.warning("workflow %s vanished mid-transition", wid)
            return
        updated = rec.model_copy(
            update={"status": status, "updated_at": datetime.now(UTC)}
        )
        await self._repo.update(updated)

    async def _finish(
        self,
        wid: str,
        *,
        status: WorkflowStatus,
        output: BaseModel | None = None,
        error: str | None = None,
    ) -> None:
        rec = await self._repo.get(wid)
        if rec is None:
            log.warning("workflow %s vanished before finish", wid)
            return
        meter = self._meters.get(wid)
        cost = round(meter.total_usd, 6) if meter else rec.cost_usd
        updated = rec.model_copy(
            update={
                "status": status,
                "updated_at": datetime.now(UTC),
                "output": output.model_dump() if output is not None else None,
                "error": error,
                "cost_usd": cost,
            }
        )
        await self._repo.update(updated)

    async def cancel(self, wid: str) -> WorkflowRecord | None:
        task = self._tasks.get(wid)
        if task is None or task.done():
            return await self.get(wid)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return await self.get(wid)

    # ---- read ----

    async def get(self, wid: str) -> WorkflowRecord | None:
        return await self._repo.get(wid)

    async def list(self, *, limit: int = 50, kind: str | None = None) -> list[WorkflowRecord]:
        # Repo handles ordering + filtering uniformly across in-memory
        # and Postgres backends.
        return await self._repo.list(limit=limit, kind=kind)

    def cost_meter(self, wid: str) -> CostMeter | None:
        return self._meters.get(wid)


# ---- DecompositionWorkflow -----------------------------------------------


class DecompositionWorkflow:
    """Wraps the decomposition agent call. Loads the system prompt from
    `prompts/decomposition.md`, calls Claude Opus 4.7 with the user's
    description, validates the structured output."""

    kind = "decomposition"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: DecompositionRequest, *, cost_meter: CostMeter
    ) -> Decomposition:
        # `cost_meter` is the per-workflow meter; rebind the client onto
        # it so each call rolls into the right ledger.
        llm = LLMClient(client=self._llm._client, cost_meter=cost_meter)  # noqa: SLF001
        system = load_prompt("decomposition")
        user_parts = [request.description]
        if request.reference_data:
            user_parts.append(
                "\n\n## Reference data\n\n" + request.reference_data
            )
        # messages.parse() is sync in the Anthropic SDK; offload to a
        # thread so the event loop stays free for other workflows.
        result = await asyncio.to_thread(
            llm.call,
            tier="opus",
            system=system,
            user="\n".join(user_parts),
            max_tokens=8192,
            adaptive_thinking=True,
            response_model=Decomposition,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"decomposition agent returned unparseable output (stop_reason={result.stop_reason})"
            )
        # mypy can't narrow result.parsed via response_model — assert here.
        assert isinstance(result.parsed, Decomposition)
        return result.parsed
