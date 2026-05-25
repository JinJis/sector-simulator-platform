"""asyncpg-backed repository for the `crawl_runs` table.

Read + write surface kept narrow on purpose — only what M48c needs.
The orchestrator (M49) extends this with status-based fetch queries
+ cost-rollup aggregations.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import asyncpg


@dataclass(frozen=True, slots=True)
class CrawlRunRow:
    """Snapshot of one `crawl_runs` row. Mirrors the Prisma model
    field-for-field, kept dataclass-frozen so callers can pass it to
    Pydantic responses without surprises."""

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


class CrawlRunRepository(Protocol):
    """Protocol so tests can inject an in-memory fake."""

    async def create_queued(
        self,
        *,
        vision_slug: str,
        fetcher_kind: str,
        plan: dict[str, Any],
    ) -> CrawlRunRow: ...

    async def mark_running(self, run_id: str) -> None: ...

    async def mark_complete(
        self,
        run_id: str,
        *,
        status: str,
        result_summary: dict[str, Any] | None,
        cost_usd: float | None,
        signals_written: int,
        proposals_written: int,
        error: str | None,
    ) -> None: ...

    async def get(self, run_id: str) -> CrawlRunRow | None: ...

    async def list_recent(
        self,
        *,
        vision_slug: str | None = None,
        fetcher_kind: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[CrawlRunRow]: ...


# --------------------------------------------------------------------------
# Postgres impl
# --------------------------------------------------------------------------


class PostgresCrawlRunRepository:
    """Wraps an asyncpg pool. Cheap pooled writes; no transactions
    needed for this table (one row per run, no FKs to chase)."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> PostgresCrawlRunRepository:
        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
        if pool is None:
            raise RuntimeError("asyncpg.create_pool returned None")
        return cls(pool)

    async def close(self) -> None:
        await self._pool.close()

    async def create_queued(
        self,
        *,
        vision_slug: str,
        fetcher_kind: str,
        plan: dict[str, Any],
    ) -> CrawlRunRow:
        row = await self._pool.fetchrow(
            """
            INSERT INTO crawl_runs (
                id, vision_slug, fetcher_kind, status, plan
            )
            VALUES (
                CONCAT('cr_', encode(gen_random_bytes(12), 'hex')),
                $1, $2, 'queued', $3::jsonb
            )
            RETURNING id, vision_slug, fetcher_kind, status, plan,
                      result_summary, cost_usd, signals_written,
                      proposals_written, error, started_at, ended_at
            """,
            vision_slug,
            fetcher_kind,
            json.dumps(plan),
        )
        assert row is not None
        return _row_to_dataclass(row)

    async def mark_running(self, run_id: str) -> None:
        await self._pool.execute(
            "UPDATE crawl_runs SET status = 'running' WHERE id = $1",
            run_id,
        )

    async def mark_complete(
        self,
        run_id: str,
        *,
        status: str,
        result_summary: dict[str, Any] | None,
        cost_usd: float | None,
        signals_written: int,
        proposals_written: int,
        error: str | None,
    ) -> None:
        await self._pool.execute(
            """
            UPDATE crawl_runs
            SET status            = $2,
                result_summary    = $3::jsonb,
                cost_usd          = $4,
                signals_written   = $5,
                proposals_written = $6,
                error             = $7,
                ended_at          = NOW()
            WHERE id = $1
            """,
            run_id,
            status,
            json.dumps(result_summary) if result_summary is not None else None,
            cost_usd,
            signals_written,
            proposals_written,
            error,
        )

    async def get(self, run_id: str) -> CrawlRunRow | None:
        row = await self._pool.fetchrow(
            """
            SELECT id, vision_slug, fetcher_kind, status, plan,
                   result_summary, cost_usd, signals_written,
                   proposals_written, error, started_at, ended_at
            FROM crawl_runs
            WHERE id = $1
            """,
            run_id,
        )
        return _row_to_dataclass(row) if row is not None else None

    async def list_recent(
        self,
        *,
        vision_slug: str | None = None,
        fetcher_kind: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[CrawlRunRow]:
        # Build a small WHERE clause from the optional filters. Cheap
        # path because we have indexes on each filterable column +
        # started_at desc.
        clauses: list[str] = []
        args: list[Any] = []
        if vision_slug is not None:
            args.append(vision_slug)
            clauses.append(f"vision_slug = ${len(args)}")
        if fetcher_kind is not None:
            args.append(fetcher_kind)
            clauses.append(f"fetcher_kind = ${len(args)}")
        if status is not None:
            args.append(status)
            clauses.append(f"status = ${len(args)}")
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        args.append(int(limit))
        sql = f"""
            SELECT id, vision_slug, fetcher_kind, status, plan,
                   result_summary, cost_usd, signals_written,
                   proposals_written, error, started_at, ended_at
            FROM crawl_runs
            {where}
            ORDER BY started_at DESC
            LIMIT ${len(args)}
        """
        rows = await self._pool.fetch(sql, *args)
        return [_row_to_dataclass(r) for r in rows]


def _row_to_dataclass(row: asyncpg.Record) -> CrawlRunRow:
    cost = row["cost_usd"]
    return CrawlRunRow(
        id=row["id"],
        vision_slug=row["vision_slug"],
        fetcher_kind=row["fetcher_kind"],
        status=row["status"],
        plan=_load_json(row["plan"]),
        result_summary=_load_json(row["result_summary"])
        if row["result_summary"] is not None
        else None,
        cost_usd=float(cost) if cost is not None else None,
        signals_written=int(row["signals_written"]),
        proposals_written=int(row["proposals_written"]),
        error=row["error"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
    )


def _load_json(value: Any) -> dict[str, Any]:
    """asyncpg gives us back JSONB as a `str` by default. Defensive
    decode so callers always get a dict."""
    if isinstance(value, str):
        return json.loads(value)
    if isinstance(value, dict):
        return value
    return {}
