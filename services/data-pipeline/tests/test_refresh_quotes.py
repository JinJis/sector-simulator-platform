"""End-to-end behavior test for the refresh_quotes job.

Wires FakeSource + InMemoryEquityRepository so the entire happy /
degraded / failed path runs through the same orchestrator the FastAPI
endpoint uses."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from data_pipeline.adapters.base import Quote
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.jobs.refresh_quotes import refresh_quotes
from data_pipeline.repo import EquityRecord, InMemoryEquityRepository


def _record(eid: str, ticker: str, exchange: str, currency: str | None = None) -> EquityRecord:
    iso = "US" if exchange in {"NYSE", "NASDAQ"} else "KR"
    return EquityRecord(
        id=eid,
        sector_slug="memory-semi",
        ticker=ticker,
        exchange=exchange,
        iso_country=iso,
        currency=currency,
    )


def _quote(symbol: str, currency: str, price: float, cap: float | None = None) -> Quote:
    return Quote(
        symbol=symbol,
        last_close_local=price,
        currency=currency,
        last_close_date=datetime.now(UTC),
        market_cap_local=cap,
    )


@pytest.mark.asyncio
async def test_happy_path_us_and_kr() -> None:
    """One US, one KR equity. Both get fresh prices and FX-converted USD."""
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "005930", "KOSPI", "KRW"),
        ]
    )
    source = FakeSource(
        quotes={
            "NVDA": _quote("NVDA", "USD", 130.0, 3.2e12),
            "005930.KS": _quote("005930.KS", "KRW", 78_000, 5.0e14),
        },
        fx={"USD": 1.0, "KRW": 1 / 1380.0},
    )

    result = await refresh_quotes(source=source, repo=repo, throttle_ms=0)

    assert result.total == 2
    assert result.updated == 2
    assert result.missing == 0
    assert result.errors == 0
    assert result.fx_rates["USD"] == 1.0
    assert result.fx_rates["KRW"] == pytest.approx(1 / 1380.0)

    writes_by_id = {w["equity_id"]: w for w in repo.writes}
    assert writes_by_id["e1"]["last_close_local"] == 130.0
    assert writes_by_id["e1"]["last_close_usd"] == 130.0
    assert writes_by_id["e1"]["market_cap_usd"] == pytest.approx(3.2e12)

    assert writes_by_id["e2"]["last_close_local"] == 78_000
    assert writes_by_id["e2"]["last_close_usd"] == pytest.approx(78_000 / 1380.0)
    assert writes_by_id["e2"]["market_cap_usd"] == pytest.approx(5.0e14 / 1380.0)


@pytest.mark.asyncio
async def test_symbol_mapping_picks_kosdaq_suffix() -> None:
    """A KOSDAQ ticker should be queried with the `.KQ` suffix."""
    repo = InMemoryEquityRepository([_record("e1", "042700", "KOSDAQ", "KRW")])
    source = FakeSource(
        quotes={"042700.KQ": _quote("042700.KQ", "KRW", 110_000, None)},
        fx={"USD": 1.0, "KRW": 1 / 1380.0},
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=0)
    assert result.updated == 1
    assert source.fetch_calls == ["042700.KQ"]


@pytest.mark.asyncio
async def test_missing_quote_is_counted_not_fatal() -> None:
    """If yfinance returns None for one symbol, the rest still update."""
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "GHOST", "NASDAQ", "USD"),
        ]
    )
    source = FakeSource(
        quotes={"NVDA": _quote("NVDA", "USD", 130.0, 3.2e12)},
        missing_symbols={"GHOST"},
        fx={"USD": 1.0},
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=0)
    assert result.updated == 1
    assert result.missing == 1
    assert result.errors == 0
    assert "e2" in result.failure_reasons


@pytest.mark.asyncio
async def test_upstream_exception_is_caught() -> None:
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "BROKEN", "NASDAQ", "USD"),
        ]
    )
    source = FakeSource(
        quotes={"NVDA": _quote("NVDA", "USD", 130.0, None)},
        raise_on={"BROKEN"},
        fx={"USD": 1.0},
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=0)
    assert result.updated == 1
    assert result.errors == 1
    assert "e2" in result.failure_reasons


@pytest.mark.asyncio
async def test_missing_fx_clears_usd_fields_but_writes_local() -> None:
    """If we can't get an FX rate, we still record the local price and
    null out the USD-converted fields so the UI shows the gap."""
    repo = InMemoryEquityRepository([_record("e1", "005930", "KOSPI", "KRW")])
    source = FakeSource(
        quotes={"005930.KS": _quote("005930.KS", "KRW", 78_000, 5.0e14)},
        fx={"USD": 1.0},  # no KRW
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=0)
    assert result.updated == 1
    write = repo.writes[0]
    assert write["last_close_local"] == 78_000
    assert write["last_close_usd"] is None
    assert write["market_cap_usd"] is None
    assert write["currency"] == "KRW"


@pytest.mark.asyncio
async def test_fx_prefetched_once_per_currency() -> None:
    """Multiple equities in the same currency should share an FX lookup."""

    class CountingSource(FakeSource):
        def __init__(self, **kw: object) -> None:
            super().__init__(**kw)
            self.fx_calls: list[str] = []

        async def fetch_fx_to_usd(self, currency: str) -> float | None:  # type: ignore[override]
            self.fx_calls.append(currency)
            return await super().fetch_fx_to_usd(currency)

    repo = InMemoryEquityRepository(
        [
            _record("e1", "005930", "KOSPI", "KRW"),
            _record("e2", "000660", "KOSPI", "KRW"),
            _record("e3", "NVDA", "NASDAQ", "USD"),
        ]
    )
    source = CountingSource(
        quotes={
            "005930.KS": _quote("005930.KS", "KRW", 78_000, None),
            "000660.KS": _quote("000660.KS", "KRW", 220_000, None),
            "NVDA": _quote("NVDA", "USD", 130.0, None),
        },
        fx={"USD": 1.0, "KRW": 1 / 1380.0},
    )
    await refresh_quotes(source=source, repo=repo, throttle_ms=0)
    # USD + KRW, one call each — not one per equity.
    assert sorted(source.fx_calls) == ["KRW", "USD"]
