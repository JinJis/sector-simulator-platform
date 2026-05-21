"""DataSource Protocol — minimal surface that the refresh jobs need.

A source is "the thing that knows how to talk to one upstream". It
exposes two coroutines:

  - `fetch_quote(symbol)` — last close, market cap, currency for one
    ticker. Returns None if the symbol isn't found (vs. raising — that's
    reserved for transport/auth failures).
  - `fetch_fx_to_usd(currency)` — current USD-per-1-unit rate for the
    given currency, used to populate `last_close_usd` and
    `market_cap_usd` from local-currency fields. Returns None if the
    currency isn't supported.

The job orchestrator depends only on this Protocol — production code
swaps in yfinance, tests use the FakeSource.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, Field


class Quote(BaseModel):
    """Point-in-time snapshot for one ticker. All fields are optional
    except `symbol` / `last_close_local` / `currency` so we can ingest
    partial data when an upstream omits e.g. market cap for a small cap."""

    symbol: str = Field(..., description="Vendor symbol — `<6-digit>.KS` for KOSPI etc.")
    last_close_local: float
    currency: str  # ISO-4217 — "USD", "KRW"
    last_close_date: datetime
    market_cap_local: float | None = None


class DataSource(Protocol):
    async def fetch_quote(self, symbol: str) -> Quote | None: ...

    async def fetch_fx_to_usd(self, currency: str) -> float | None:
        """Return how many USD = 1 unit of `currency`. So for KRW this
        is ~0.00072 (since 1 KRW ≈ $0.00072 = $1/1,380)."""
        ...
