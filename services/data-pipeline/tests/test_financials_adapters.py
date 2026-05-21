"""Unit tests for the M10b financials adapters.

EDGAR + DART HTTP clients are exercised end-to-end via the
`_aggregate` / `_accounting_to_quarter` pure-math helpers — we don't
hit real upstream URLs in tests. Real-network smoke can be triggered
via `INGEST_SOURCE=yfinance` (the default in dev compose) — see
`docs/tasks/current.md` for the manual check.
"""

from __future__ import annotations

from datetime import date

import pytest

from data_pipeline.adapters.dart_source import (
    DEFAULT_KRW_PER_USD,
    DartSource,
    _accounting_to_quarter,
)
from data_pipeline.adapters.edgar_source import (
    EdgarSource,
    _aggregate,
    _calendar_quarter,
    _pick_quarterly_facts,
)
from data_pipeline.adapters.fake_financials import FakeFinancialsSource


# ---------- FakeFinancialsSource ----------


@pytest.mark.asyncio
async def test_fake_returns_requested_quarters() -> None:
    src = FakeFinancialsSource()
    rows = await src.fetch_financials(
        ticker="MU", exchange="NASDAQ", country="US", quarters=8
    )
    assert len(rows) == 8


@pytest.mark.asyncio
async def test_fake_is_deterministic_per_ticker() -> None:
    src = FakeFinancialsSource()
    a = await src.fetch_financials(ticker="MU", exchange="NASDAQ", country="US", quarters=4)
    b = await src.fetch_financials(ticker="MU", exchange="NASDAQ", country="US", quarters=4)
    for r1, r2 in zip(a, b):
        assert r1.revenue_usd == r2.revenue_usd


@pytest.mark.asyncio
async def test_fake_differs_per_ticker() -> None:
    src = FakeFinancialsSource()
    a = await src.fetch_financials(ticker="MU", exchange="NASDAQ", country="US", quarters=4)
    b = await src.fetch_financials(ticker="INTC", exchange="NASDAQ", country="US", quarters=4)
    # Margins differ across tickers; not strictly guaranteed for every
    # field but at least gross_profit_usd should differ for most pairs.
    assert any(
        abs(x.gross_profit_usd - y.gross_profit_usd) > 1e-3
        for x, y in zip(a, b)
        if x.gross_profit_usd and y.gross_profit_usd
    )


@pytest.mark.asyncio
async def test_fake_accounting_identities_hold() -> None:
    src = FakeFinancialsSource()
    rows = await src.fetch_financials(
        ticker="MU", exchange="NASDAQ", country="US", quarters=8
    )
    for r in rows:
        assert r.revenue_usd is not None
        assert r.cogs_usd is not None
        assert r.gross_profit_usd is not None
        assert r.opex_usd is not None
        assert r.ebitda_usd is not None
        # revenue = cogs + gross
        assert r.revenue_usd == pytest.approx(r.cogs_usd + r.gross_profit_usd, rel=1e-9)
        # ebitda = gross - opex
        assert r.ebitda_usd == pytest.approx(r.gross_profit_usd - r.opex_usd, rel=1e-9)


@pytest.mark.asyncio
async def test_fake_sorted_oldest_to_newest() -> None:
    src = FakeFinancialsSource()
    rows = await src.fetch_financials(
        ticker="MU", exchange="NASDAQ", country="US", quarters=8
    )
    for i in range(1, len(rows)):
        assert rows[i].period_end > rows[i - 1].period_end


# ---------- EDGAR _calendar_quarter ----------


def test_calendar_quarter_boundaries() -> None:
    assert _calendar_quarter(date(2025, 1, 1)) == 1
    assert _calendar_quarter(date(2025, 3, 31)) == 1
    assert _calendar_quarter(date(2025, 4, 1)) == 2
    assert _calendar_quarter(date(2025, 6, 30)) == 2
    assert _calendar_quarter(date(2025, 9, 30)) == 3
    assert _calendar_quarter(date(2025, 12, 31)) == 4


# ---------- EDGAR _pick_quarterly_facts ----------


def _facts_envelope(concept: str, rows: list[dict]) -> dict:
    return {"facts": {"us-gaap": {concept: {"units": {"USD": rows}}}}}


def test_pick_quarterly_walks_fallback_chain() -> None:
    facts = _facts_envelope(
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        [
            {"end": "2025-03-31", "val": 100, "qtrs": 1, "fy": 2025, "fp": "Q1"},
            {"end": "2025-06-30", "val": 110, "qtrs": 1, "fy": 2025, "fp": "Q2"},
        ],
    )
    result = _pick_quarterly_facts(
        facts,
        ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    )
    assert len(result) == 2


def test_pick_quarterly_filters_to_qtrs_eq_1() -> None:
    facts = _facts_envelope(
        "Revenues",
        [
            {"end": "2025-12-31", "val": 1000, "qtrs": 4, "fy": 2025, "fp": "FY"},
            {"end": "2025-03-31", "val": 250, "qtrs": 1, "fy": 2025, "fp": "Q1"},
        ],
    )
    out = _pick_quarterly_facts(facts, ["Revenues"])
    assert len(out) == 1
    assert out[0]["fp"] == "Q1"


def test_pick_quarterly_returns_empty_when_no_match() -> None:
    facts = _facts_envelope("Revenues", [])
    assert _pick_quarterly_facts(facts, ["Revenues"]) == []
    assert _pick_quarterly_facts({"facts": {"us-gaap": {}}}, ["Revenues"]) == []


# ---------- EDGAR _aggregate ----------


def test_aggregate_emits_at_most_quarters_rows() -> None:
    revenue_facts = [
        {"end": f"2025-{m:02d}-{d:02d}", "val": 100 + i, "qtrs": 1, "fy": 2025, "fp": fp}
        for i, (m, d, fp) in enumerate([(3, 31, "Q1"), (6, 30, "Q2"), (9, 30, "Q3"), (12, 31, "Q4")])
    ]
    out = _aggregate({"revenue": revenue_facts}, quarters=2)
    assert len(out) == 2
    # Newest two should be present (Q4 + Q3) and sorted ascending in output.
    assert out[0].fiscal_quarter < out[1].fiscal_quarter


def test_aggregate_computes_gross_and_opex() -> None:
    facts = {
        "revenue": [{"end": "2025-03-31", "val": 1000, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "cogs": [{"end": "2025-03-31", "val": 600, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "op_income": [{"end": "2025-03-31", "val": 200, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "net_income": [{"end": "2025-03-31", "val": 150, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "capex": [{"end": "2025-03-31", "val": -80, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
    }
    out = _aggregate(facts, quarters=4)
    assert len(out) == 1
    r = out[0]
    assert r.revenue_usd == 1000
    assert r.cogs_usd == 600
    assert r.gross_profit_usd == 400  # 1000 - 600
    assert r.opex_usd == 200  # gross 400 - op_income 200
    assert r.ebitda_usd == 200
    assert r.net_income_usd == 150
    # Capex is recorded as outflow in EDGAR (negative) — adapter
    # returns abs() for clean charting.
    assert r.capex_usd == 80


def test_edgar_constructor_validates_user_agent() -> None:
    with pytest.raises(ValueError):
        EdgarSource(user_agent="")
    with pytest.raises(ValueError):
        EdgarSource(user_agent="no-email-here")
    # Valid one with contact email succeeds.
    EdgarSource(user_agent="sector-sim ops@example.com")


# ---------- DART _accounting_to_quarter ----------


def test_dart_accounting_extracts_revenue() -> None:
    rows = [
        {"fs_div": "CFS", "account_nm": "매출액", "thstrm_amount": "12,000,000,000"},
        {"fs_div": "CFS", "account_nm": "영업이익", "thstrm_amount": "1,500,000,000"},
        {"fs_div": "CFS", "account_nm": "당기순이익", "thstrm_amount": "1,000,000,000"},
        {"fs_div": "CFS", "account_nm": "매출원가", "thstrm_amount": "7,000,000,000"},
    ]
    q = _accounting_to_quarter(
        rows,
        fy=2025,
        reprt_code="11013",  # Q1
        krw_per_usd=1380.0,
    )
    assert q is not None
    assert q.fiscal_year == 2025
    assert q.fiscal_quarter == 1
    assert q.period_end == date(2025, 3, 31)
    # 12_000_000_000 KRW / 1380 ≈ $8.7M
    assert q.revenue_usd == pytest.approx(12_000_000_000 / 1380, rel=1e-6)
    # gross = revenue - cogs in KRW, then converted: (12e9 - 7e9) / 1380 ≈ $3.62M
    assert q.gross_profit_usd == pytest.approx((12_000_000_000 - 7_000_000_000) / 1380, rel=1e-6)
    assert q.source == "dart"
    assert q.capex_usd is None  # not in fnlttSinglAcnt


def test_dart_accounting_handles_missing_fields() -> None:
    rows = [
        {"fs_div": "CFS", "account_nm": "당기순이익", "thstrm_amount": "1,000,000,000"},
    ]
    q = _accounting_to_quarter(
        rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0
    )
    assert q is not None
    assert q.revenue_usd is None
    assert q.gross_profit_usd is None
    assert q.net_income_usd == pytest.approx(1_000_000_000 / 1380, rel=1e-6)


def test_dart_accounting_returns_none_when_empty() -> None:
    assert _accounting_to_quarter([], fy=2025, reprt_code="11013", krw_per_usd=1380.0) is None


def test_dart_accounting_handles_comma_or_dash() -> None:
    rows = [
        {"fs_div": "CFS", "account_nm": "매출액", "thstrm_amount": "-"},
        {"fs_div": "CFS", "account_nm": "당기순이익", "thstrm_amount": "500,000,000"},
    ]
    q = _accounting_to_quarter(
        rows, fy=2025, reprt_code="11014", krw_per_usd=DEFAULT_KRW_PER_USD
    )
    assert q is not None
    assert q.fiscal_quarter == 3
    assert q.revenue_usd is None
    assert q.net_income_usd is not None


def test_dart_constructor_requires_api_key() -> None:
    with pytest.raises(ValueError):
        DartSource(api_key="")
    # With a key the constructor succeeds.
    src = DartSource(api_key="x")
    assert src is not None
