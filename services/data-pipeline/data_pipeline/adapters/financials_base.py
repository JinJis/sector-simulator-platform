"""Financials adapters — milestone 10b.

Same shape as the quote/history adapters (base.py): a Protocol surface
+ pydantic models that the refresh job consumes. Real-data implementations
live in `dart_source.py` (KR) and `edgar_source.py` (US); a FakeFinancialsSource
keeps tests offline.

USD-normalized at the adapter layer because the upstreams report in
their native units (DART reports KRW, EDGAR reports USD). The job
doesn't FX-convert further — what the adapter returns is what gets
written to `equity_financials`.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Protocol

from pydantic import BaseModel, Field


class FinancialQuarter(BaseModel):
    """One quarterly fundamentals snapshot. All metrics are USD —
    adapters convert from the upstream's native currency before returning.

    `source` matches the value persisted to `equity_financials.source`
    so we can distinguish editorial mock data from real ingest.
    """

    fiscal_year: int
    fiscal_quarter: int = Field(..., ge=1, le=4)
    period_end: date
    revenue_usd: float | None = None
    cogs_usd: float | None = None
    gross_profit_usd: float | None = None
    opex_usd: float | None = None
    ebitda_usd: float | None = None
    net_income_usd: float | None = None
    capex_usd: float | None = None
    source: Literal["dart", "edgar", "fake"] = "fake"


class FinancialsSource(Protocol):
    """Country-specific upstream — DART for KR equities, EDGAR for US.

    `country` is passed so the job can route a single FakeFinancialsSource
    across both regions in tests without spinning up two adapters.
    """

    async def fetch_financials(
        self,
        *,
        ticker: str,
        exchange: str,
        country: str,
        quarters: int,
    ) -> list[FinancialQuarter]:
        """Last `quarters` quarters of fundamentals, ascending by
        period_end. Returns [] when the upstream has nothing for this
        equity. Raises on transport / auth failures (the job catches +
        counts them, same pattern as refresh_quote_history)."""
        ...
