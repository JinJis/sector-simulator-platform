"""Adapter unit tests — FakeSource contract + symbol mapping."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from data_pipeline.adapters.base import Quote
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.adapters.yfinance_source import exchange_to_symbol


class TestExchangeMapping:
    def test_us_passes_through(self) -> None:
        assert exchange_to_symbol("NASDAQ", "NVDA") == "NVDA"
        assert exchange_to_symbol("NYSE", "BE") == "BE"

    def test_kr_gets_suffix(self) -> None:
        assert exchange_to_symbol("KOSPI", "005930") == "005930.KS"
        assert exchange_to_symbol("KOSDAQ", "042700") == "042700.KQ"

    def test_case_insensitive(self) -> None:
        assert exchange_to_symbol("nasdaq", "AMD") == "AMD"
        assert exchange_to_symbol("kospi", "000660") == "000660.KS"

    def test_unknown_exchange_passes_through(self) -> None:
        # Caller error to fix in the seed — we shouldn't paper over it.
        assert exchange_to_symbol("LSE", "ARM") == "ARM"


class TestFakeSource:
    @pytest.mark.asyncio
    async def test_returns_seeded_quote(self) -> None:
        ts = datetime.now(UTC)
        q = Quote(
            symbol="NVDA",
            last_close_local=130.0,
            currency="USD",
            last_close_date=ts,
            market_cap_local=3.2e12,
        )
        s = FakeSource(quotes={"NVDA": q})
        got = await s.fetch_quote("NVDA")
        assert got == q
        assert s.fetch_calls == ["NVDA"]

    @pytest.mark.asyncio
    async def test_missing_symbol_returns_none(self) -> None:
        s = FakeSource(missing_symbols={"DELISTED"})
        assert await s.fetch_quote("DELISTED") is None

    @pytest.mark.asyncio
    async def test_raise_on_simulates_upstream_error(self) -> None:
        s = FakeSource(raise_on={"BROKEN"})
        with pytest.raises(RuntimeError, match="BROKEN"):
            await s.fetch_quote("BROKEN")

    @pytest.mark.asyncio
    async def test_fx_lookup(self) -> None:
        s = FakeSource(fx={"USD": 1.0, "KRW": 1 / 1380})
        assert await s.fetch_fx_to_usd("USD") == 1.0
        assert (await s.fetch_fx_to_usd("KRW") or 0) == pytest.approx(1 / 1380)
        assert await s.fetch_fx_to_usd("JPY") is None
