"""Equity repository — read+write the `sector_equities` Postgres table.

Same shape as `agent-orchestration/repo.py`: Protocol + InMemory + Postgres
implementations. Production uses asyncpg (no Prisma JS on the Python side),
tests use the in-memory backing.

We only model the *narrow* surface the refresh job needs:
  - list every (id, sector_slug, ticker, exchange, currency) row so the
    job can iterate the basket
  - update the denormalized quote snapshot for one id
The editorial fields (sector_exposure_pct, rationale, driver_links) live
in the seed script and aren't written here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel


class EquityRecord(BaseModel):
    """Minimal projection of `sector_equities` for the refresh path."""

    id: str
    sector_slug: str
    ticker: str
    exchange: str
    iso_country: str
    currency: str | None


class EquityRepository(Protocol):
    async def list_all(self) -> list[EquityRecord]: ...

    async def update_quote(
        self,
        equity_id: str,
        *,
        last_close_local: float,
        last_close_usd: float | None,
        last_close_date: datetime,
        market_cap_usd: float | None,
        currency: str,
    ) -> None: ...

    async def close(self) -> None: ...


# ---- In-memory --------------------------------------------------------


class InMemoryEquityRepository:
    """Test backing. Constructed with a list of seed records and
    captures all writes for assertions."""

    def __init__(self, records: list[EquityRecord]) -> None:
        self._records: dict[str, EquityRecord] = {r.id: r for r in records}
        # Test-visible: latest write per equity id, in update order.
        self.writes: list[dict[str, Any]] = []

    async def list_all(self) -> list[EquityRecord]:
        return list(self._records.values())

    async def update_quote(
        self,
        equity_id: str,
        *,
        last_close_local: float,
        last_close_usd: float | None,
        last_close_date: datetime,
        market_cap_usd: float | None,
        currency: str,
    ) -> None:
        if equity_id not in self._records:
            raise KeyError(f"unknown equity: {equity_id}")
        self.writes.append(
            {
                "equity_id": equity_id,
                "last_close_local": last_close_local,
                "last_close_usd": last_close_usd,
                "last_close_date": last_close_date,
                "market_cap_usd": market_cap_usd,
                "currency": currency,
            }
        )

    async def close(self) -> None:
        return None


# ---- Postgres (asyncpg) -----------------------------------------------


_LIST_SQL = """
SELECT id, sector_slug, ticker, exchange, iso_country, currency
FROM sector_equities
ORDER BY sector_slug ASC, display_order ASC, ticker ASC
"""

_UPDATE_QUOTE_SQL = """
UPDATE sector_equities
SET
    last_close_local = $2,
    last_close_usd = $3,
    last_close_date = $4,
    market_cap_usd = $5,
    currency = $6,
    updated_at = now()
WHERE id = $1
"""


class PostgresEquityRepository:
    def __init__(self, pool: Any) -> None:  # asyncpg.Pool
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> PostgresEquityRepository:
        import asyncpg

        pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5)
        return cls(pool)

    async def list_all(self) -> list[EquityRecord]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_SQL)
        return [
            EquityRecord(
                id=r["id"],
                sector_slug=r["sector_slug"],
                ticker=r["ticker"],
                exchange=r["exchange"],
                iso_country=r["iso_country"],
                currency=r["currency"],
            )
            for r in rows
        ]

    async def update_quote(
        self,
        equity_id: str,
        *,
        last_close_local: float,
        last_close_usd: float | None,
        last_close_date: datetime,
        market_cap_usd: float | None,
        currency: str,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                _UPDATE_QUOTE_SQL,
                equity_id,
                last_close_local,
                last_close_usd,
                last_close_date,
                market_cap_usd,
                currency,
            )

    async def close(self) -> None:
        await self._pool.close()


# ---- Factory ----------------------------------------------------------


async def build_repository(database_url: str | None) -> EquityRepository:
    """Build a Postgres-backed repo when `database_url` is set; otherwise
    raise — unlike the agent-orchestration runner, this service has no
    sensible in-memory fallback (it needs the seeded equity rows to
    iterate). Tests construct InMemoryEquityRepository directly."""
    if not database_url:
        raise RuntimeError(
            "data-pipeline requires DATABASE_URL — there is no in-memory fallback "
            "because the refresh job needs the seeded equity rows to iterate."
        )
    return await PostgresEquityRepository.connect(database_url)
