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

from datetime import UTC, date, datetime
from typing import Any, Protocol

from pydantic import BaseModel


def _naive_utc(dt: datetime) -> datetime:
    """asyncpg → Postgres TIMESTAMP (no TZ) refuses tz-aware datetimes.
    Normalize on the way in. See the longer note in
    `agent-orchestration/repo.py:_naive_utc`."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)


class EquityRecord(BaseModel):
    """Minimal projection of `sector_equities` for the refresh path."""

    id: str
    sector_slug: str
    ticker: str
    exchange: str
    iso_country: str
    currency: str | None


class QuoteBar(BaseModel):
    """Single row destined for `equity_quotes`. The adapter's `HistoryBar`
    has only `trade_date / close_local / volume` — the job fills in the
    USD conversion + source label before handing rows to the repo."""

    trade_date: date
    close_local: float
    close_usd: float | None = None
    volume: float | None = None
    source: str = "yfinance"


class FinancialRow(BaseModel):
    """Single row destined for `equity_financials`. Adapter-produced —
    adapters convert to USD before handing to the job, so the repo
    treats values as already-USD."""

    fiscal_year: int
    fiscal_quarter: int
    period_end: date
    revenue_usd: float | None = None
    cogs_usd: float | None = None
    gross_profit_usd: float | None = None
    opex_usd: float | None = None
    ebitda_usd: float | None = None
    net_income_usd: float | None = None
    capex_usd: float | None = None
    # Balance sheet (M10d)
    total_assets_usd: float | None = None
    total_liabilities_usd: float | None = None
    total_equity_usd: float | None = None
    source: str = "dart"


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

    async def bulk_upsert_quote_history(
        self, equity_id: str, bars: list[QuoteBar]
    ) -> int:
        """Insert (or overwrite on PK conflict) the given bars. Returns
        the number of rows accepted by the database. Caller is expected
        to chunk if it ever has thousands of bars per call."""
        ...

    async def bulk_upsert_financials(
        self, equity_id: str, rows: list[FinancialRow]
    ) -> int:
        """Insert (or overwrite on PK conflict on
        (equity_id, fiscal_year, fiscal_quarter)) the given financial
        rows. Returns the number of rows written."""
        ...

    async def close(self) -> None: ...


# ---- In-memory --------------------------------------------------------


class InMemoryEquityRepository:
    """Test backing. Constructed with a list of seed records and
    captures all writes for assertions."""

    def __init__(self, records: list[EquityRecord]) -> None:
        self._records: dict[str, EquityRecord] = {r.id: r for r in records}
        # Test-visible: latest write per equity id, in update order.
        self.writes: list[dict[str, Any]] = []
        # equity_id → date → bar  — simulates the (equity_id, trade_date)
        # composite PK with upsert-on-conflict semantics.
        self.history: dict[str, dict[date, QuoteBar]] = {}
        # equity_id → (fy, fq) → row — simulates the (equity_id, fy, fq)
        # PK on equity_financials.
        self.financials: dict[str, dict[tuple[int, int], FinancialRow]] = {}

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

    async def bulk_upsert_quote_history(
        self, equity_id: str, bars: list[QuoteBar]
    ) -> int:
        if equity_id not in self._records:
            raise KeyError(f"unknown equity: {equity_id}")
        store = self.history.setdefault(equity_id, {})
        for bar in bars:
            store[bar.trade_date] = bar
        return len(bars)

    async def bulk_upsert_financials(
        self, equity_id: str, rows: list[FinancialRow]
    ) -> int:
        if equity_id not in self._records:
            raise KeyError(f"unknown equity: {equity_id}")
        store = self.financials.setdefault(equity_id, {})
        for r in rows:
            store[(r.fiscal_year, r.fiscal_quarter)] = r
        return len(rows)

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

_UPSERT_QUOTE_HISTORY_SQL = """
INSERT INTO equity_quotes
    (equity_id, trade_date, close_local, close_usd, volume, source)
VALUES
    ($1, $2, $3, $4, $5, $6)
ON CONFLICT (equity_id, trade_date)
DO UPDATE SET
    close_local = EXCLUDED.close_local,
    close_usd = EXCLUDED.close_usd,
    volume = EXCLUDED.volume,
    source = EXCLUDED.source,
    inserted_at = now()
"""

_UPSERT_FINANCIALS_SQL = """
INSERT INTO equity_financials
    (equity_id, fiscal_year, fiscal_quarter, period_end,
     revenue_usd, cogs_usd, gross_profit_usd, opex_usd, ebitda_usd,
     net_income_usd, capex_usd,
     total_assets_usd, total_liabilities_usd, total_equity_usd,
     source)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (equity_id, fiscal_year, fiscal_quarter)
DO UPDATE SET
    period_end = EXCLUDED.period_end,
    revenue_usd = EXCLUDED.revenue_usd,
    cogs_usd = EXCLUDED.cogs_usd,
    gross_profit_usd = EXCLUDED.gross_profit_usd,
    opex_usd = EXCLUDED.opex_usd,
    ebitda_usd = EXCLUDED.ebitda_usd,
    net_income_usd = EXCLUDED.net_income_usd,
    capex_usd = EXCLUDED.capex_usd,
    total_assets_usd = EXCLUDED.total_assets_usd,
    total_liabilities_usd = EXCLUDED.total_liabilities_usd,
    total_equity_usd = EXCLUDED.total_equity_usd,
    source = EXCLUDED.source,
    inserted_at = now()
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
                _naive_utc(last_close_date),
                market_cap_usd,
                currency,
            )

    async def bulk_upsert_quote_history(
        self, equity_id: str, bars: list[QuoteBar]
    ) -> int:
        if not bars:
            return 0
        rows = [
            (
                equity_id,
                bar.trade_date,
                bar.close_local,
                bar.close_usd,
                bar.volume,
                bar.source,
            )
            for bar in bars
        ]
        async with self._pool.acquire() as conn:
            # `executemany` runs the upsert per row but inside one
            # connection round-trip + one prepared statement — fine for
            # the ~90 bars × ~50 equities scale we're at. If this ever
            # crosses ~10k rows per call, switch to COPY.
            await conn.executemany(_UPSERT_QUOTE_HISTORY_SQL, rows)
        return len(rows)

    async def bulk_upsert_financials(
        self, equity_id: str, rows: list[FinancialRow]
    ) -> int:
        if not rows:
            return 0
        payload = [
            (
                equity_id,
                r.fiscal_year,
                r.fiscal_quarter,
                r.period_end,
                r.revenue_usd,
                r.cogs_usd,
                r.gross_profit_usd,
                r.opex_usd,
                r.ebitda_usd,
                r.net_income_usd,
                r.capex_usd,
                r.total_assets_usd,
                r.total_liabilities_usd,
                r.total_equity_usd,
                r.source,
            )
            for r in rows
        ]
        async with self._pool.acquire() as conn:
            await conn.executemany(_UPSERT_FINANCIALS_SQL, payload)
        return len(payload)

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
