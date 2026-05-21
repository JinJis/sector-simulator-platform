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
    _pick_instant_facts,
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
        # M10d: BS identity — assets = liabilities + equity (mock-honest)
        assert r.total_assets_usd is not None
        assert r.total_liabilities_usd is not None
        assert r.total_equity_usd is not None
        assert r.total_assets_usd == pytest.approx(
            r.total_liabilities_usd + r.total_equity_usd, rel=1e-9
        )


@pytest.mark.asyncio
async def test_fake_bs_grows_with_company() -> None:
    """M10d: total_assets grows over quarters — leverage ratio holds."""
    src = FakeFinancialsSource()
    rows = await src.fetch_financials(
        ticker="MU", exchange="NASDAQ", country="US", quarters=8
    )
    first_assets = rows[0].total_assets_usd or 0
    last_assets = rows[-1].total_assets_usd or 0
    assert last_assets > first_assets  # company grew
    # Per-row leverage ratios should be in a reasonable band (35-70%).
    for r in rows:
        lev = (r.total_liabilities_usd or 0) / (r.total_assets_usd or 1)
        assert 0.30 < lev < 0.75


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
    # Without D&A, ebitda falls back to operating income (M10b behavior).
    assert r.ebitda_usd == 200
    assert r.net_income_usd == 150
    # Capex is recorded as outflow in EDGAR (negative) — adapter
    # returns abs() for clean charting.
    assert r.capex_usd == 80


def test_aggregate_adds_da_to_ebitda_when_present() -> None:
    """M10c: ebitda = OpIncome + D&A when the adapter sees a
    DepreciationAndAmortization fact for the same period."""
    facts = {
        "revenue": [{"end": "2025-03-31", "val": 1000, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "cogs": [{"end": "2025-03-31", "val": 600, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "op_income": [{"end": "2025-03-31", "val": 200, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "net_income": [{"end": "2025-03-31", "val": 150, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "capex": [{"end": "2025-03-31", "val": -80, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "d_and_a": [{"end": "2025-03-31", "val": 50, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
    }
    out = _aggregate(facts, quarters=4)
    r = out[0]
    # ebitda = 200 (op_income) + 50 (D&A) = 250
    assert r.ebitda_usd == 250


def test_aggregate_falls_back_to_op_income_when_da_missing() -> None:
    """No D&A facts → ebitda = OpIncome (matches M10b)."""
    facts = {
        "revenue": [{"end": "2025-03-31", "val": 1000, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "op_income": [{"end": "2025-03-31", "val": 200, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        "d_and_a": [],
    }
    out = _aggregate(facts, quarters=4)
    assert out[0].ebitda_usd == 200


def test_pick_instant_facts_filters_to_instant_rows() -> None:
    """Balance-sheet items in EDGAR have no `qtrs` field. Picker must
    pass those through while still rejecting quarterly rows."""
    facts = {
        "facts": {
            "us-gaap": {
                "Assets": {
                    "units": {
                        "USD": [
                            {"end": "2025-03-31", "val": 1_000_000_000},  # no qtrs → instant
                            {"end": "2025-03-31", "val": 999, "qtrs": 1, "fp": "Q1"},  # quarterly span (rejected)
                        ],
                    },
                },
            },
        },
    }
    out = _pick_instant_facts(facts, ["Assets"])
    assert len(out) == 1
    assert out[0]["val"] == 1_000_000_000


def test_aggregate_emits_balance_sheet_when_instants_provided() -> None:
    """Instant facts joined onto the matching quarter by `end` date."""
    facts = {
        "revenue": [{"end": "2025-03-31", "val": 1000, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
        # No `qtrs` — BS instants
        "assets": [{"end": "2025-03-31", "val": 50_000}],
        "liabilities": [{"end": "2025-03-31", "val": 20_000}],
        "equity": [{"end": "2025-03-31", "val": 30_000}],
    }
    out = _aggregate(facts, quarters=4)
    assert len(out) == 1
    r = out[0]
    assert r.total_assets_usd == 50_000
    assert r.total_liabilities_usd == 20_000
    assert r.total_equity_usd == 30_000


def test_aggregate_emits_null_bs_when_instants_absent() -> None:
    facts = {
        "revenue": [{"end": "2025-03-31", "val": 1000, "qtrs": 1, "fy": 2025, "fp": "Q1"}],
    }
    out = _aggregate(facts, quarters=4)
    assert out[0].total_assets_usd is None
    assert out[0].total_liabilities_usd is None
    assert out[0].total_equity_usd is None


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


def test_dart_matches_by_account_id_first() -> None:
    """M10c: full-statements rows carry K-IFRS `account_id` codes.
    Matching by account_id avoids ambiguity from localized names."""
    rows = [
        # account_id present — preferred path
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Revenue",
            "account_nm": "수익(매출액)",  # different label than the simple endpoint uses
            "thstrm_amount": "10,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_CostOfSales",
            "account_nm": "매출원가",
            "thstrm_amount": "6,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "dart_OperatingIncomeLoss",
            "account_nm": "영업이익(손실)",
            "thstrm_amount": "1,500,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_ProfitLoss",
            "account_nm": "당기순이익(손실)",
            "thstrm_amount": "1,200,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
            "account_nm": "유형자산의 취득",
            "thstrm_amount": "-500,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_DepreciationExpense",
            "account_nm": "감가상각비",
            "thstrm_amount": "300,000,000",
        },
    ]
    q = _accounting_to_quarter(rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0)
    assert q is not None
    assert q.revenue_usd == pytest.approx(10_000_000_000 / 1380, rel=1e-6)
    assert q.cogs_usd == pytest.approx(6_000_000_000 / 1380, rel=1e-6)
    # Capex is reported as outflow (negative); adapter uses abs().
    assert q.capex_usd == pytest.approx(500_000_000 / 1380, rel=1e-6)
    # ebitda = op_income + D&A
    expected_ebitda = (1_500_000_000 + 300_000_000) / 1380
    assert q.ebitda_usd == pytest.approx(expected_ebitda, rel=1e-6)
    assert q.net_income_usd == pytest.approx(1_200_000_000 / 1380, rel=1e-6)


def test_dart_account_id_takes_precedence_over_account_nm() -> None:
    """When account_id is present we must NOT fall back to the
    Korean substring match — the substring branch is for the simple
    endpoint only."""
    rows = [
        {
            "fs_div": "CFS",
            "account_id": "some_unrelated_id",  # NOT in our id sets
            "account_nm": "매출액",  # substring would match revenue
            "thstrm_amount": "999,999,999",
        },
    ]
    q = _accounting_to_quarter(rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0)
    # Neither account_id nor account_nm path matched → revenue None;
    # but net_income also None → adapter returns None.
    assert q is None


def test_dart_legacy_substring_still_works_when_account_id_empty() -> None:
    """Simple endpoint rows have account_id="". Substring fallback
    keeps that path alive."""
    rows = [
        {
            "fs_div": "CFS",
            "account_id": "",
            "account_nm": "매출액",
            "thstrm_amount": "1,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "",
            "account_nm": "당기순이익",
            "thstrm_amount": "100,000,000",
        },
    ]
    q = _accounting_to_quarter(rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0)
    assert q is not None
    assert q.revenue_usd == pytest.approx(1_000_000_000 / 1380, rel=1e-6)


@pytest.mark.asyncio
async def test_dart_autodiscovery_falls_back_when_ticker_unmapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M10d: when a ticker isn't in the hand-curated KR_CORP_CODES map,
    the source asks corpCode.xml auto-discovery. We monkey-patch the
    fetcher so the test stays offline."""
    from data_pipeline.adapters import dart_source as ds_mod

    calls = {"n": 0}

    async def fake_fetch(api_key: str, *, timeout_s: float = 60.0) -> dict[str, str]:
        calls["n"] += 1
        return {"999999": "01234567"}  # a synthetic ticker not in the hand-map

    monkeypatch.setattr(ds_mod, "fetch_corp_code_map", fake_fetch)
    src = ds_mod.DartSource(api_key="x", corp_code_map={"005930": "00126380"})
    # Hit a ticker NOT in the curated map → triggers discovery.
    hit = await src._resolve_corp_code("999999")
    assert hit == "01234567"
    assert calls["n"] == 1
    # Second call hits the same auto-discovered map → no second network call.
    hit2 = await src._resolve_corp_code("999999")
    assert hit2 == "01234567"
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_dart_autodiscovery_skipped_when_curated_map_hits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hand-curated map wins — no network call for known tickers."""
    from data_pipeline.adapters import dart_source as ds_mod

    calls = {"n": 0}

    async def fake_fetch(api_key: str, *, timeout_s: float = 60.0) -> dict[str, str]:
        calls["n"] += 1
        return {}

    monkeypatch.setattr(ds_mod, "fetch_corp_code_map", fake_fetch)
    src = ds_mod.DartSource(api_key="x", corp_code_map={"005930": "00126380"})
    hit = await src._resolve_corp_code("005930")
    assert hit == "00126380"
    assert calls["n"] == 0  # no auto-discovery


@pytest.mark.asyncio
async def test_dart_autodiscovery_disabled_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `autodiscover_corp_codes=False`, missing ticker → None
    without any network attempt."""
    from data_pipeline.adapters import dart_source as ds_mod

    calls = {"n": 0}

    async def fake_fetch(api_key: str, *, timeout_s: float = 60.0) -> dict[str, str]:
        calls["n"] += 1
        return {"999999": "01234567"}

    monkeypatch.setattr(ds_mod, "fetch_corp_code_map", fake_fetch)
    src = ds_mod.DartSource(
        api_key="x",
        corp_code_map={"005930": "00126380"},
        autodiscover_corp_codes=False,
    )
    hit = await src._resolve_corp_code("999999")
    assert hit is None
    assert calls["n"] == 0


@pytest.mark.asyncio
async def test_dart_autodiscovery_caches_empty_on_fetch_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A network failure shouldn't retry on every subsequent lookup —
    we cache empty dict and move on."""
    from data_pipeline.adapters import dart_source as ds_mod

    calls = {"n": 0}

    async def fake_fetch(api_key: str, *, timeout_s: float = 60.0) -> dict[str, str]:
        calls["n"] += 1
        raise RuntimeError("DART corpCode endpoint is down")

    monkeypatch.setattr(ds_mod, "fetch_corp_code_map", fake_fetch)
    src = ds_mod.DartSource(api_key="x", corp_code_map={})
    assert await src._resolve_corp_code("999999") is None
    assert await src._resolve_corp_code("888888") is None
    # Discovery was attempted exactly once.
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_dart_resolve_fx_uses_lookup_when_available() -> None:
    """M10c: historical FX via the fx_for callable. We don't make a
    real network call here — just confirm the constructor wires the
    callable through and that the fallback constant is used when the
    lookup returns None."""
    from datetime import date as _date

    async def lookup(d: _date) -> float | None:
        # Per-quarter override: pretend KRW weakened drastically in 2024 Q3.
        if d == _date(2024, 9, 30):
            return 1500.0
        return None

    src = DartSource(api_key="x", fx_for=lookup, krw_per_usd=1380.0)
    rate_a = await src._resolve_fx(_date(2024, 9, 30))
    rate_b = await src._resolve_fx(_date(2024, 12, 31))
    assert rate_a == 1500.0  # historical
    assert rate_b == 1380.0  # fallback to constructor constant


@pytest.mark.asyncio
async def test_dart_resolve_fx_ignores_non_positive_results() -> None:
    """A negative or zero rate from the lookup is bogus — fall back."""
    from datetime import date as _date

    async def bad_lookup(d: _date) -> float | None:
        return -1.0

    src = DartSource(api_key="x", fx_for=bad_lookup, krw_per_usd=1380.0)
    rate = await src._resolve_fx(_date(2025, 3, 31))
    assert rate == 1380.0


def test_dart_extracts_balance_sheet_totals() -> None:
    """M10d: full-statements endpoint exposes BS items under
    ifrs-full_Assets / Liabilities / Equity. Persist as absolute USD."""
    rows = [
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Revenue",
            "account_nm": "수익",
            "thstrm_amount": "10,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Assets",
            "account_nm": "자산총계",
            "thstrm_amount": "200,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Liabilities",
            "account_nm": "부채총계",
            "thstrm_amount": "80,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Equity",
            "account_nm": "자본총계",
            "thstrm_amount": "120,000,000,000",
        },
    ]
    q = _accounting_to_quarter(rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0)
    assert q is not None
    assert q.total_assets_usd == pytest.approx(200_000_000_000 / 1380, rel=1e-6)
    assert q.total_liabilities_usd == pytest.approx(80_000_000_000 / 1380, rel=1e-6)
    assert q.total_equity_usd == pytest.approx(120_000_000_000 / 1380, rel=1e-6)
    # Accounting identity sanity check (within FP error).
    assert q.total_assets_usd == pytest.approx(
        q.total_liabilities_usd + q.total_equity_usd, rel=1e-9
    )


def test_dart_capex_taken_as_absolute_value() -> None:
    """DART reports PP&E acquisitions as a negative cashflow.
    Persisted capex must be positive (absolute amount spent)."""
    rows = [
        {
            "fs_div": "CFS",
            "account_id": "ifrs-full_Revenue",
            "account_nm": "수익",
            "thstrm_amount": "1,000,000,000",
        },
        {
            "fs_div": "CFS",
            "account_id": "dart_PurchaseOfPropertyPlantAndEquipment",
            "account_nm": "유형자산의 취득",
            "thstrm_amount": "-200,000,000",
        },
    ]
    q = _accounting_to_quarter(rows, fy=2025, reprt_code="11013", krw_per_usd=1380.0)
    assert q is not None
    assert q.capex_usd is not None
    assert q.capex_usd > 0
    assert q.capex_usd == pytest.approx(200_000_000 / 1380, rel=1e-6)
