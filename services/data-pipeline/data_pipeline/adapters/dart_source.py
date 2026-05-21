"""OPEN DART adapter — milestone 10b + 10c.

Pulls quarterly fundamentals from the Korea Financial Supervisory
Service's public corporate filings API. Requires a free API key
(register at https://opendart.fss.or.kr/, key arrives by email).

API documentation: https://opendart.fss.or.kr/guide/main.do

M10c switches from the 주요계정 endpoint (`fnlttSinglAcnt.json`, ~10
line items) to 전체재무제표 (`fnlttSinglAcntAll.json`, full
statements). The full endpoint gives us cashflow items — most
importantly `ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAs...`
for capex — alongside the IS / BS items the simple endpoint already
covered. The IS endpoint is kept as a fallback so old `corp_code`
that don't file the full statement still produce data.

DART reports KRW; the adapter FX-converts to USD before returning.
M10c plumbs in an optional `fx_for` callable that returns the
quarter-end KRW/USD rate — wired in main.py to `FrankfurterFx` so
historical quarters use historical FX. If `fx_for` is None or
returns None for a given date we fall back to
`DEFAULT_KRW_PER_USD = 1380` (matching the seed snapshot date).

Ticker → corp_code mapping: DART exposes `corpCode.xml` (one-time
download, ~20MB). For MVP convenience we ship a hand-curated map for
the KR tickers in `seed-equities.ts` (Samsung, SK hynix, etc.).
Unmapped tickers return `[]` rather than fail loudly.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import date

from data_pipeline.adapters.dart_corp_codes import fetch_corp_code_map
from data_pipeline.adapters.financials_base import FinancialQuarter

log = logging.getLogger(__name__)

DART_ACCT_URL = "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json"
DART_ACCT_ALL_URL = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json"

# K-IFRS account_id values used by the full-statements endpoint.
# These are stable across companies / years (whereas account_nm is
# localized and varies). We match account_id first; account_nm
# substring is the fallback used by the simple endpoint.
ACCOUNT_ID_REVENUE = {"ifrs-full_Revenue", "ifrs_Revenue"}
ACCOUNT_ID_COGS = {"ifrs-full_CostOfSales", "ifrs_CostOfSales"}
ACCOUNT_ID_OP_INCOME = {"dart_OperatingIncomeLoss"}
ACCOUNT_ID_NET_INCOME = {
    "ifrs-full_ProfitLoss",
    "ifrs-full_ProfitLossAttributableToOwnersOfParent",
}
# Cashflow items — capex (CF). DART uses multiple labels for "PP&E
# acquisitions"; walking a set of known account_ids catches most.
ACCOUNT_ID_CAPEX = {
    "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "dart_PurchaseOfPropertyPlantAndEquipment",
    "dart_PaymentsToAcquireFixedAssetsTotalCFlow",
}
# D&A for true EBITDA.
ACCOUNT_ID_DA = {
    "ifrs-full_DepreciationExpense",
    "ifrs-full_DepreciationAndAmortisationExpense",
    "dart_DepreciationAndAmortizationExpense",
}
# Balance sheet (M10d). DART's full-statements endpoint reports the
# BS section with these account_ids. Equity total may appear under
# either label depending on whether non-controlling interest is
# broken out separately.
ACCOUNT_ID_TOTAL_ASSETS = {"ifrs-full_Assets"}
ACCOUNT_ID_TOTAL_LIABILITIES = {"ifrs-full_Liabilities"}
ACCOUNT_ID_TOTAL_EQUITY = {
    "ifrs-full_Equity",
    "ifrs-full_EquityAttributableToOwnersOfParent",
}

# DART quarter codes — the API surfaces reports under different
# `reprt_code` values per filing type:
#   11013 = 1분기 보고서      (Q1)
#   11012 = 반기 보고서       (cumulative H1; subtract Q1 to derive Q2)
#   11014 = 3분기 보고서      (cumulative 9M; subtract H1 to derive Q3)
#   11011 = 사업 보고서       (annual; subtract 9M to derive Q4)
# For MVP we only fetch the quarterly reports and approximate Q2/Q3/Q4
# as the *cumulative-to-date* values divided by the period count. A
# real time-series alignment slice lands as M10c.
REPORT_CODES = ["11013", "11012", "11014", "11011"]
REPORT_TO_QUARTER = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}

# Hand-curated corp_code mapping for the KR tickers we ship in
# seed-equities.ts. Each is the 8-character DART corp_code (zero-padded).
# Verified against https://opendart.fss.or.kr/disclosureinfo/biz/main.do
# circa 2025-Q1.
KR_CORP_CODES: dict[str, str] = {
    "005930": "00126380",  # Samsung Electronics
    "000660": "00164779",  # SK hynix
    "036930": "00159102",  # Jusung Engineering
    "240810": "01180185",  # Wonik IPS
    "058470": "00686588",  # Leeno Industrial
    "095340": "00138224",  # ISC
    "278280": "01281543",  # Hana Materials
    "067310": "00231148",  # HanaMicron
    "108860": "00715287",  # Cells (KX)
    "112040": "00827832",  # Wemade
    "036540": "00159107",  # SFA Semicon
    "086390": "00553130",  # Unitest
    "131370": "01151239",  # Park Systems
    # SOFC + space sector KR tickers
    "012450": "00159013",  # Hanwha Aerospace
    "047810": "00134032",  # Korea Aerospace Industries
    "079550": "00154950",  # LIG Nex1
    "298690": "01402601",  # AirBusan (placeholder; verify)
    "336260": "01612213",  # Doosan Fuel Cell
    "271940": "01371617",  # Iljin Hysolus
    "298540": "01401809",  # NextEye
    "001120": "00112450",  # LX International
}

# KRW → USD constant. Matches seed-equities.ts. Override via the
# constructor for tests or when you wire up a real FX feed.
DEFAULT_KRW_PER_USD = 1380.0


def _maybe_float(d: dict, key: str) -> float | None:
    raw = d.get(key)
    if raw is None or raw == "" or raw == "-":
        return None
    try:
        # DART returns numbers as comma-formatted strings, e.g. "12,345,678".
        return float(str(raw).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _quarter_end(year: int, q: int) -> date:
    return {1: date(year, 3, 31), 2: date(year, 6, 30), 3: date(year, 9, 30), 4: date(year, 12, 31)}[q]


def _accounting_to_quarter(
    rows: list[dict],
    *,
    fy: int,
    reprt_code: str,
    krw_per_usd: float,
) -> FinancialQuarter | None:
    """Aggregate one (fy, reprt) bundle of DART line items into a
    FinancialQuarter. Used for both the simple `fnlttSinglAcnt`
    endpoint (matches by Korean `account_nm` substring) and the
    full-statement `fnlttSinglAcntAll` endpoint (matches first by
    K-IFRS `account_id` — which is stable across companies — and
    falls back to substring if account_id is empty).
    """
    fields: dict[str, float | None] = {
        "revenue": None,
        "op_income": None,
        "net_income": None,
        "cogs": None,
        "capex": None,
        "d_and_a": None,
        "total_assets": None,
        "total_liabilities": None,
        "total_equity": None,
    }
    for row in rows:
        if row.get("fs_div") not in ("CFS", "OFS"):
            continue
        # Consolidated (CFS) preferred — fall back to standalone (OFS).
        account_id = (row.get("account_id") or "").strip()
        name = row.get("account_nm") or ""
        amount = _maybe_float(row, "thstrm_amount")
        if amount is None:
            continue

        if account_id in ACCOUNT_ID_REVENUE and fields["revenue"] is None:
            fields["revenue"] = amount
        elif account_id in ACCOUNT_ID_COGS and fields["cogs"] is None:
            fields["cogs"] = amount
        elif account_id in ACCOUNT_ID_OP_INCOME and fields["op_income"] is None:
            fields["op_income"] = amount
        elif account_id in ACCOUNT_ID_NET_INCOME and fields["net_income"] is None:
            fields["net_income"] = amount
        elif account_id in ACCOUNT_ID_CAPEX and fields["capex"] is None:
            # Reported as outflow (negative or absolute). Take abs so
            # the financials column always shows the cash amount spent.
            fields["capex"] = abs(amount)
        elif account_id in ACCOUNT_ID_DA and fields["d_and_a"] is None:
            fields["d_and_a"] = amount
        elif account_id in ACCOUNT_ID_TOTAL_ASSETS and fields["total_assets"] is None:
            fields["total_assets"] = amount
        elif account_id in ACCOUNT_ID_TOTAL_LIABILITIES and fields["total_liabilities"] is None:
            fields["total_liabilities"] = amount
        elif account_id in ACCOUNT_ID_TOTAL_EQUITY and fields["total_equity"] is None:
            fields["total_equity"] = amount
        # Fallback: Korean name substring (covers the simple endpoint
        # where account_id may be empty).
        elif not account_id:
            if "매출액" in name and fields["revenue"] is None:
                fields["revenue"] = amount
            elif "영업이익" in name and fields["op_income"] is None:
                fields["op_income"] = amount
            elif ("당기순이익" in name or "분기순이익" in name) and fields["net_income"] is None:
                fields["net_income"] = amount
            elif "매출원가" in name and fields["cogs"] is None:
                fields["cogs"] = amount

    if fields["revenue"] is None and fields["net_income"] is None:
        return None

    q = REPORT_TO_QUARTER[reprt_code]
    fx = krw_per_usd or DEFAULT_KRW_PER_USD

    def to_usd(v: float | None) -> float | None:
        return v / fx if v is not None else None

    revenue_usd = to_usd(fields["revenue"])
    cogs_usd = to_usd(fields["cogs"])
    op_income_usd = to_usd(fields["op_income"])
    net_income_usd = to_usd(fields["net_income"])
    capex_usd = to_usd(fields["capex"])
    d_and_a_usd = to_usd(fields["d_and_a"])
    total_assets_usd = to_usd(fields["total_assets"])
    total_liabilities_usd = to_usd(fields["total_liabilities"])
    total_equity_usd = to_usd(fields["total_equity"])
    gross_usd = (
        revenue_usd - cogs_usd if revenue_usd is not None and cogs_usd is not None else None
    )
    opex_usd = (
        gross_usd - op_income_usd
        if gross_usd is not None and op_income_usd is not None
        else None
    )
    # True EBITDA = OpIncome + D&A (M10c) when D&A is available;
    # fall back to op_income alone otherwise.
    if op_income_usd is not None and d_and_a_usd is not None:
        ebitda_usd = op_income_usd + d_and_a_usd
    else:
        ebitda_usd = op_income_usd
    return FinancialQuarter(
        fiscal_year=fy,
        fiscal_quarter=q,
        period_end=_quarter_end(fy, q),
        revenue_usd=revenue_usd,
        cogs_usd=cogs_usd,
        gross_profit_usd=gross_usd,
        opex_usd=opex_usd,
        ebitda_usd=ebitda_usd,
        net_income_usd=net_income_usd,
        capex_usd=capex_usd,
        total_assets_usd=total_assets_usd,
        total_liabilities_usd=total_liabilities_usd,
        total_equity_usd=total_equity_usd,
        source="dart",
    )


FxLookup = Callable[[date], Awaitable[float | None]]


class DartSource:
    def __init__(
        self,
        *,
        api_key: str,
        krw_per_usd: float = DEFAULT_KRW_PER_USD,
        corp_code_map: dict[str, str] | None = None,
        fx_for: FxLookup | None = None,
        use_full_statements: bool = True,
        autodiscover_corp_codes: bool = True,
    ) -> None:
        if not api_key:
            raise ValueError("DartSource requires DART_API_KEY")
        self._api_key = api_key
        self._krw_per_usd = krw_per_usd
        self._corp_code_map = dict(corp_code_map or KR_CORP_CODES)
        self._fx_for = fx_for
        self._use_full_statements = use_full_statements
        self._autodiscover = autodiscover_corp_codes
        # Cache of the auto-discovered corpCode.xml map. Loaded lazily
        # on the first miss against the hand-curated map.
        self._discovered_map: dict[str, str] | None = None
        self._discovery_lock = asyncio.Lock()

    async def _resolve_fx(self, period_end: date) -> float:
        """Quarter-end KRW/USD. Falls back to the constructor's
        constant when no historical FX lookup is wired in."""
        if self._fx_for is not None:
            rate = await self._fx_for(period_end)
            if rate is not None and rate > 0:
                return rate
        return self._krw_per_usd

    async def _resolve_corp_code(self, ticker: str) -> str | None:
        """Look up the corp_code for a KR stock ticker. Tries the
        hand-curated map first, then auto-discovery (if enabled), then
        gives up. Auto-discovery is cached in-memory for the lifetime
        of the source."""
        hit = self._corp_code_map.get(ticker)
        if hit:
            return hit
        if not self._autodiscover:
            return None
        if self._discovered_map is None:
            async with self._discovery_lock:
                if self._discovered_map is None:
                    try:
                        log.info("dart: fetching corpCode.xml (auto-discovery)…")
                        self._discovered_map = await fetch_corp_code_map(self._api_key)
                        log.info(
                            "dart: corpCode discovery loaded %d KR tickers",
                            len(self._discovered_map),
                        )
                    except Exception as e:  # noqa: BLE001
                        log.warning("dart: corpCode auto-discovery failed: %s", e)
                        # Cache empty dict so we don't retry every call.
                        self._discovered_map = {}
        return self._discovered_map.get(ticker)

    async def fetch_financials(
        self,
        *,
        ticker: str,
        exchange: str,
        country: str,
        quarters: int,
    ) -> list[FinancialQuarter]:
        if country.upper() != "KR":
            return []
        corp_code = await self._resolve_corp_code(ticker)
        if not corp_code:
            log.info("dart: no corp_code mapping for ticker %s", ticker)
            return []

        import httpx

        # Walk back from the current calendar year. DART's `bsns_year`
        # is the fiscal year string ("2025" etc.). We loop years until
        # we've collected `quarters` rows.
        from datetime import datetime

        current_year = datetime.utcnow().year
        rows: list[FinancialQuarter] = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            for year_offset in range(0, (quarters // 4) + 2):
                year = current_year - year_offset
                for reprt_code in REPORT_CODES:
                    if len(rows) >= quarters:
                        break
                    quarter = await self._fetch_one(
                        client=client,
                        corp_code=corp_code,
                        year=year,
                        reprt_code=reprt_code,
                    )
                    if quarter is not None:
                        rows.append(quarter)
                if len(rows) >= quarters:
                    break

        rows.sort(key=lambda r: r.period_end)
        return rows[-quarters:]

    async def _fetch_one(
        self,
        *,
        client: "httpx.AsyncClient",  # type: ignore[name-defined]  # noqa: F821
        corp_code: str,
        year: int,
        reprt_code: str,
    ) -> FinancialQuarter | None:
        """Fetch one (corp, year, reprt) bundle. Tries the full-statement
        endpoint first (covers IS + CF + BS in one call, gives us
        capex + D&A). If `use_full_statements=False` or the full call
        returns empty, falls back to the simple `fnlttSinglAcnt`."""
        params = {
            "crtfc_key": self._api_key,
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": reprt_code,
        }

        # Resolve FX once per quarter using the historical date.
        q_no = REPORT_TO_QUARTER[reprt_code]
        period_end = _quarter_end(year, q_no)
        krw_per_usd = await self._resolve_fx(period_end)

        async def call(url: str, extra: dict | None = None) -> list[dict]:
            full_params = {**params, **(extra or {})}
            r = await client.get(url, params=full_params)
            if r.status_code != 200:
                return []
            body = r.json()
            if body.get("status") != "000":
                return []
            return body.get("list", []) or []

        rows: list[dict] = []
        if self._use_full_statements:
            # fnlttSinglAcntAll requires fs_div. We try CFS (consolidated)
            # first; if empty, fall back to OFS (separate).
            rows = await call(DART_ACCT_ALL_URL, {"fs_div": "CFS"})
            if not rows:
                rows = await call(DART_ACCT_ALL_URL, {"fs_div": "OFS"})

        if not rows:
            rows = await call(DART_ACCT_URL)

        if not rows:
            return None

        return _accounting_to_quarter(
            rows,
            fy=year,
            reprt_code=reprt_code,
            krw_per_usd=krw_per_usd,
        )


__all__ = [
    "DartSource",
    "_accounting_to_quarter",
    "KR_CORP_CODES",
    "DEFAULT_KRW_PER_USD",
]
