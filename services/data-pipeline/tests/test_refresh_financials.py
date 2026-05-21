"""End-to-end test for refresh_financials with FakeFinancialsSource +
InMemoryEquityRepository. Verifies routing (US vs KR), upsert counts,
and failure isolation."""

from __future__ import annotations

import pytest

from data_pipeline.adapters.fake_financials import FakeFinancialsSource
from data_pipeline.adapters.financials_base import FinancialQuarter
from data_pipeline.jobs.refresh_financials import refresh_financials
from data_pipeline.repo import EquityRecord, InMemoryEquityRepository


def _records() -> list[EquityRecord]:
    return [
        EquityRecord(
            id="eq_us_1",
            sector_slug="memory-semi",
            ticker="MU",
            exchange="NASDAQ",
            iso_country="US",
            currency="USD",
        ),
        EquityRecord(
            id="eq_kr_1",
            sector_slug="memory-semi",
            ticker="005930",
            exchange="KOSPI",
            iso_country="KR",
            currency="KRW",
        ),
        EquityRecord(
            id="eq_other_1",
            sector_slug="memory-semi",
            ticker="ASML",
            exchange="AMS",
            iso_country="NL",
            currency="EUR",
        ),
    ]


@pytest.mark.asyncio
async def test_refresh_writes_us_and_kr_when_both_sources_present() -> None:
    repo = InMemoryEquityRepository(_records())
    fake = FakeFinancialsSource()
    result = await refresh_financials(
        us_source=fake, kr_source=fake, repo=repo, quarters=8, throttle_ms=0
    )
    assert result.total == 3
    assert result.updated == 2  # US + KR; NL is skipped (unsupported country)
    assert result.rows_written == 16  # 2 equities × 8 quarters
    assert result.empty == 1  # NL skipped
    assert result.errors == 0
    # Each US/KR equity has 8 rows persisted.
    assert len(repo.financials["eq_us_1"]) == 8
    assert len(repo.financials["eq_kr_1"]) == 8
    assert "eq_other_1" not in repo.financials


@pytest.mark.asyncio
async def test_refresh_skips_kr_when_kr_source_missing() -> None:
    repo = InMemoryEquityRepository(_records())
    fake = FakeFinancialsSource()
    result = await refresh_financials(
        us_source=fake, kr_source=None, repo=repo, quarters=4, throttle_ms=0
    )
    # KR has no source — counted as empty, not error.
    assert result.updated == 1  # only the US ticker
    assert result.empty == 2  # KR (no source) + NL (unsupported country)
    assert result.errors == 0
    assert "eq_us_1" in repo.financials
    assert "eq_kr_1" not in repo.financials


class _RaisingSource:
    async def fetch_financials(
        self, *, ticker: str, exchange: str, country: str, quarters: int
    ) -> list[FinancialQuarter]:
        raise RuntimeError(f"upstream is down for {ticker}")


@pytest.mark.asyncio
async def test_refresh_failure_isolated_per_equity() -> None:
    repo = InMemoryEquityRepository(_records())
    fake = FakeFinancialsSource()
    raising = _RaisingSource()
    # US raises, KR succeeds — total result still completes.
    result = await refresh_financials(
        us_source=raising,  # type: ignore[arg-type]
        kr_source=fake,
        repo=repo,
        quarters=4,
        throttle_ms=0,
    )
    assert result.errors == 1
    assert result.updated == 1  # KR succeeded
    assert "eq_us_1" in result.failure_reasons
    assert "upstream is down" in result.failure_reasons["eq_us_1"]


@pytest.mark.asyncio
async def test_refresh_empty_upstream_counted_separately() -> None:
    class _EmptySource:
        async def fetch_financials(
            self, *, ticker: str, exchange: str, country: str, quarters: int
        ) -> list[FinancialQuarter]:
            return []

    repo = InMemoryEquityRepository(_records())
    result = await refresh_financials(
        us_source=_EmptySource(),  # type: ignore[arg-type]
        kr_source=_EmptySource(),  # type: ignore[arg-type]
        repo=repo,
        quarters=4,
        throttle_ms=0,
    )
    # All US + KR fetches return [] → empty; NL skipped (unsupported)
    assert result.updated == 0
    assert result.empty == 3
    assert result.errors == 0
