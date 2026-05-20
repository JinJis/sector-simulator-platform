"""Persistence layer for `WorkflowRecord`s.

Two implementations:

- `InMemoryWorkflowRepository` — dict-backed, used in tests and as the
  default when `DATABASE_URL` isn't configured.
- `PostgresWorkflowRepository` — asyncpg, schema mirrored from the
  `agent_workflows` Prisma model (`packages/db/prisma/schema.prisma`).

The runner depends on the `WorkflowRepository` protocol, so the swap is
local: pass a different instance at construction time. Tests keep
working without a DB.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any, Protocol

from agent_orchestration.schemas import WorkflowRecord, WorkflowStatus


class WorkflowRepository(Protocol):
    async def create(self, record: WorkflowRecord) -> None: ...
    async def update(self, record: WorkflowRecord) -> None: ...
    async def get(self, wid: str) -> WorkflowRecord | None: ...
    async def list(
        self, *, limit: int = 50, kind: str | None = None
    ) -> list[WorkflowRecord]: ...
    async def mark_dangling_as_failed(
        self, *, statuses: list[str], stale_before: datetime, reason: str
    ) -> int:
        """On startup, sweep workflows that were `pending` or `running`
        when the process died. They can never complete (the task that
        was driving them is gone), so flip them to `failed` with a
        descriptive error. Returns the number of records updated."""
        ...

    async def close(self) -> None:
        """Release any underlying resources. No-op for in-memory."""


# ---- In-memory --------------------------------------------------------


class InMemoryWorkflowRepository:
    """Default repo when no Postgres is configured. Behaviour is the
    same as the previous dict-based runner state — restart loses
    everything."""

    def __init__(self) -> None:
        self._records: dict[str, WorkflowRecord] = {}
        self._lock = asyncio.Lock()

    async def create(self, record: WorkflowRecord) -> None:
        async with self._lock:
            self._records[record.id] = record

    async def update(self, record: WorkflowRecord) -> None:
        async with self._lock:
            self._records[record.id] = record

    async def get(self, wid: str) -> WorkflowRecord | None:
        async with self._lock:
            return self._records.get(wid)

    async def list(
        self, *, limit: int = 50, kind: str | None = None
    ) -> list[WorkflowRecord]:
        async with self._lock:
            records = list(self._records.values())
        records.sort(key=lambda r: r.created_at, reverse=True)
        if kind is not None:
            records = [r for r in records if r.kind == kind]
        return records[:limit]

    async def mark_dangling_as_failed(
        self, *, statuses: list[str], stale_before: datetime, reason: str
    ) -> int:
        # No persistence → no dangling records on a fresh process.
        return 0

    async def close(self) -> None:
        return None


# ---- Postgres (asyncpg) -----------------------------------------------


_CREATE_SQL = """
INSERT INTO agent_workflows
    (id, kind, status, input, output, error, cost_usd, created_at, updated_at)
VALUES
    ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
"""

_UPDATE_SQL = """
UPDATE agent_workflows
SET
    status = $2,
    output = $3::jsonb,
    error = $4,
    cost_usd = $5,
    updated_at = $6
WHERE id = $1
"""

_GET_SQL = """
SELECT id, kind, status, input, output, error, cost_usd, created_at, updated_at
FROM agent_workflows
WHERE id = $1
"""

_LIST_SQL = """
SELECT id, kind, status, input, output, error, cost_usd, created_at, updated_at
FROM agent_workflows
WHERE ($1::text IS NULL OR kind = $1)
ORDER BY created_at DESC
LIMIT $2
"""

_SWEEP_SQL = """
UPDATE agent_workflows
SET status = 'failed',
    error = $1,
    updated_at = now()
WHERE status = ANY($2)
  AND updated_at < $3
RETURNING id
"""


class PostgresWorkflowRepository:
    def __init__(self, pool: Any) -> None:
        """`pool` is an asyncpg.Pool. Typed as Any here because we don't
        want to bake an asyncpg dependency into module-load even when
        the in-memory repo is the one in use (some test envs don't have
        asyncpg installed)."""
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> PostgresWorkflowRepository:
        import asyncpg  # local import — only needed for the Postgres repo

        pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5)
        return cls(pool)

    async def create(self, record: WorkflowRecord) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                _CREATE_SQL,
                record.id,
                record.kind,
                record.status.value if isinstance(record.status, WorkflowStatus) else record.status,
                json.dumps(record.input),
                json.dumps(record.output) if record.output is not None else None,
                record.error,
                record.cost_usd,
                record.created_at,
                record.updated_at,
            )

    async def update(self, record: WorkflowRecord) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                _UPDATE_SQL,
                record.id,
                record.status.value if isinstance(record.status, WorkflowStatus) else record.status,
                json.dumps(record.output) if record.output is not None else None,
                record.error,
                record.cost_usd,
                record.updated_at,
            )

    async def get(self, wid: str) -> WorkflowRecord | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_GET_SQL, wid)
        if row is None:
            return None
        return _row_to_record(row)

    async def list(
        self, *, limit: int = 50, kind: str | None = None
    ) -> list[WorkflowRecord]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_SQL, kind, limit)
        return [_row_to_record(r) for r in rows]

    async def mark_dangling_as_failed(
        self, *, statuses: list[str], stale_before: datetime, reason: str
    ) -> int:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_SWEEP_SQL, reason, statuses, stale_before)
        return len(rows)

    async def close(self) -> None:
        await self._pool.close()


def _row_to_record(row: Any) -> WorkflowRecord:
    """Translate an asyncpg.Record to our Pydantic envelope. asyncpg
    returns JSONB as Python strings (not auto-decoded), so we parse
    here. created_at / updated_at land as tz-aware datetimes already."""
    raw_input = row["input"]
    raw_output = row["output"]
    return WorkflowRecord(
        id=row["id"],
        kind=row["kind"],
        status=WorkflowStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        input=json.loads(raw_input) if isinstance(raw_input, str) else (raw_input or {}),
        output=(
            json.loads(raw_output)
            if isinstance(raw_output, str)
            else (raw_output if raw_output is not None else None)
        ),
        error=row["error"],
        cost_usd=float(row["cost_usd"] or 0.0),
    )


# ---- Convenience -------------------------------------------------------


async def build_repository(
    database_url: str | None,
) -> WorkflowRepository:
    """Pick the repo implementation based on whether a DATABASE_URL is
    configured. Used by `main.py`'s lifespan startup."""
    if not database_url:
        return InMemoryWorkflowRepository()
    return await PostgresWorkflowRepository.connect(database_url)


# Re-export this so callers don't need to know about `datetime`.
def utc_now() -> datetime:
    return datetime.now(UTC)
