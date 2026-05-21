"""End-to-end tests for refresh_quote_history."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from data_pipeline.adapters.base import HistoryBar
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.jobs.refresh_quote_history import refresh_quote_history
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


def _bars(n: int, *, start: float = 100.0, step: float = 1.0) -> list[HistoryBar]:
    """Ascending series of n daily bars ending today."""
    today = date(2026, 5, 21)
    out: list[HistoryBar] = []
    for i in range(n):
        d = today - timedelta(days=n - 1 - i)
        out.append(HistoryBar(trade_date=d, close_local=start + i * step, volume=1000.0))
    return out


@pytest.mark.asyncio
async def test_happy_path_writes_bars_with_usd_conversion() -> None:
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "005930", "KOSPI", "KRW"),
        ]
    )
    source = FakeSource(
        history={
            "NVDA": _bars(5, start=120.0, step=2.0),
            "005930.KS": _bars(5, start=75_000, step=500),
        },
        fx={"USD": 1.0, "KRW": 1 / 1380.0},
    )
    result = await refresh_quote_history(source=source, repo=repo, days=5, throttle_ms=0)

    assert result.total == 2
    assert result.updated == 2
    assert result.bars_written == 10
    assert result.empty == 0
    assert result.errors == 0
    assert result.days == 5

    # USD equity — close_usd should equal close_local.
    usd_bars = list(repo.history["e1"].values())
    assert all(b.close_usd == b.close_local for b in usd_bars)

    # KR equity — close_usd should equal local × (1/1380).
    krw_bars = list(repo.history["e2"].values())
    for b in krw_bars:
        assert b.close_usd is not None
        assert b.close_usd == pytest.approx(b.close_local / 1380.0)


@pytest.mark.asyncio
async def test_kosdaq_suffix_used() -> None:
    repo = InMemoryEquityRepository([_record("e1", "042700", "KOSDAQ", "KRW")])
    source = FakeSource(
        history={"042700.KQ": _bars(3)},
        fx={"USD": 1.0, "KRW": 1 / 1380.0},
    )
    await refresh_quote_history(source=source, repo=repo, days=3, throttle_ms=0)
    assert source.history_calls == [("042700.KQ", 3)]


@pytest.mark.asyncio
async def test_empty_history_counted_not_fatal() -> None:
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "GHOST", "NASDAQ", "USD"),
        ]
    )
    source = FakeSource(
        history={"NVDA": _bars(2)},  # GHOST has no history
        fx={"USD": 1.0},
    )
    result = await refresh_quote_history(source=source, repo=repo, days=2, throttle_ms=0)
    assert result.updated == 1
    assert result.empty == 1
    assert result.errors == 0
    assert "e2" in result.failure_reasons


@pytest.mark.asyncio
async def test_upstream_exception_isolated() -> None:
    repo = InMemoryEquityRepository(
        [
            _record("e1", "NVDA", "NASDAQ", "USD"),
            _record("e2", "BROKEN", "NASDAQ", "USD"),
        ]
    )
    source = FakeSource(
        history={"NVDA": _bars(2)},
        raise_on={"BROKEN"},
        fx={"USD": 1.0},
    )
    result = await refresh_quote_history(source=source, repo=repo, days=2, throttle_ms=0)
    assert result.updated == 1
    assert result.errors == 1
    assert "e2" in result.failure_reasons


@pytest.mark.asyncio
async def test_missing_fx_nulls_close_usd_but_writes_local() -> None:
    repo = InMemoryEquityRepository([_record("e1", "005930", "KOSPI", "KRW")])
    source = FakeSource(
        history={"005930.KS": _bars(2, start=75_000, step=500)},
        fx={"USD": 1.0},  # no KRW
    )
    await refresh_quote_history(source=source, repo=repo, days=2, throttle_ms=0)
    bars = list(repo.history["e1"].values())
    assert all(b.close_local > 0 for b in bars)
    assert all(b.close_usd is None for b in bars)


@pytest.mark.asyncio
async def test_idempotent_upsert_on_repeat() -> None:
    """Running the job twice should leave the same number of bars
    (overwrite-on-conflict), not double them up."""
    repo = InMemoryEquityRepository([_record("e1", "NVDA", "NASDAQ", "USD")])
    source = FakeSource(history={"NVDA": _bars(4)}, fx={"USD": 1.0})

    await refresh_quote_history(source=source, repo=repo, days=4, throttle_ms=0)
    await refresh_quote_history(source=source, repo=repo, days=4, throttle_ms=0)

    assert len(repo.history["e1"]) == 4
