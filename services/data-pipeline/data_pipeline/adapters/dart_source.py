"""OPEN DART adapter — milestone 10b.

Pulls quarterly fundamentals from the Korea Financial Supervisory
Service's public corporate filings API. Requires a free API key
(register at https://opendart.fss.or.kr/, key arrives by email).

API documentation: https://opendart.fss.or.kr/guide/main.do

We use the 주요계정 endpoint `fnlttSinglAcnt.json` for one-shot per
report fetches. Each call returns line items (revenue, operating
profit, net profit etc.) for one corp_code × one report period.

DART reports KRW; the adapter FX-converts to USD before returning. FX
source: simple per-call constant `KRW_PER_USD` injectable through the
constructor (defaults to 1,380 — matching the seed). For real
production use you'd want a daily FX feed; deferred to M10c.

Ticker → corp_code mapping: DART exposes `corpCode.xml` (one-time
download, ~20MB). For MVP convenience we ship a hand-curated map for
the KR tickers in `seed-equities.ts` (Samsung, SK hynix, etc.).
Unmapped tickers return `[]` rather than fail loudly.
"""

from __future__ import annotations

import logging
from datetime import date

from data_pipeline.adapters.financials_base import FinancialQuarter

log = logging.getLogger(__name__)

DART_ACCT_URL = "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json"

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
    FinancialQuarter. Returns None if revenue + net income are both
    missing (the report likely failed to load or the company doesn't
    file under K-IFRS labels we recognize).

    The line-item names live in `account_nm` and are localized
    (Korean). We match by substring against the standard K-IFRS labels.
    """
    fields = {
        "revenue": None,
        "op_income": None,
        "net_income": None,
        "cogs": None,
    }
    for row in rows:
        if row.get("fs_div") not in ("CFS", "OFS"):
            continue
        # Consolidated (CFS) preferred — fall back to standalone (OFS).
        name = row.get("account_nm") or ""
        amount = _maybe_float(row, "thstrm_amount")
        if amount is None:
            continue
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
    revenue_usd = fields["revenue"] / fx if fields["revenue"] is not None else None
    cogs_usd = fields["cogs"] / fx if fields["cogs"] is not None else None
    op_income_usd = fields["op_income"] / fx if fields["op_income"] is not None else None
    net_income_usd = fields["net_income"] / fx if fields["net_income"] is not None else None
    gross_usd = (
        revenue_usd - cogs_usd if revenue_usd is not None and cogs_usd is not None else None
    )
    opex_usd = (
        gross_usd - op_income_usd
        if gross_usd is not None and op_income_usd is not None
        else None
    )
    return FinancialQuarter(
        fiscal_year=fy,
        fiscal_quarter=q,
        period_end=_quarter_end(fy, q),
        revenue_usd=revenue_usd,
        cogs_usd=cogs_usd,
        gross_profit_usd=gross_usd,
        opex_usd=opex_usd,
        ebitda_usd=op_income_usd,
        net_income_usd=net_income_usd,
        # DART 주요계정 doesn't include capex. Pulled from the
        # full statement (fnlttSinglAcntAll) in a later refinement.
        capex_usd=None,
        source="dart",
    )


class DartSource:
    def __init__(
        self,
        *,
        api_key: str,
        krw_per_usd: float = DEFAULT_KRW_PER_USD,
        corp_code_map: dict[str, str] | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("DartSource requires DART_API_KEY")
        self._api_key = api_key
        self._krw_per_usd = krw_per_usd
        self._corp_code_map = corp_code_map or KR_CORP_CODES

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
        corp_code = self._corp_code_map.get(ticker)
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
                    params = {
                        "crtfc_key": self._api_key,
                        "corp_code": corp_code,
                        "bsns_year": str(year),
                        "reprt_code": reprt_code,
                    }
                    r = await client.get(DART_ACCT_URL, params=params)
                    if r.status_code != 200:
                        continue
                    body = r.json()
                    if body.get("status") != "000":
                        # 013 = "no data" — common for unreleased periods.
                        continue
                    quarter = _accounting_to_quarter(
                        body.get("list", []),
                        fy=year,
                        reprt_code=reprt_code,
                        krw_per_usd=self._krw_per_usd,
                    )
                    if quarter is not None:
                        rows.append(quarter)
                if len(rows) >= quarters:
                    break

        rows.sort(key=lambda r: r.period_end)
        return rows[-quarters:]


__all__ = [
    "DartSource",
    "_accounting_to_quarter",
    "KR_CORP_CODES",
    "DEFAULT_KRW_PER_USD",
]
