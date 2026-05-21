"""SEC EDGAR adapter — milestone 10b.

Pulls quarterly fundamentals from SEC's public XBRL Facts API. No API
key required — SEC just expects a polite User-Agent string with a
contact email (required by their fair-access policy).

Architecture:
  1. On first call we cache `https://www.sec.gov/files/company_tickers.json`
     locally to resolve ticker → CIK.
  2. For each request we hit
     `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` and
     extract the standard us-gaap concepts:
       - Revenues / RevenueFromContractWithCustomerExcludingAssessedTax
       - CostOfRevenue / CostOfGoodsAndServicesSold
       - OperatingIncomeLoss
       - NetIncomeLoss
       - PaymentsToAcquirePropertyPlantAndEquipment
  3. We then group facts by (fiscal_year, fiscal_quarter, period_end),
     producing one FinancialQuarter row per quarter.

SEC publishes USD values already, so no FX conversion is needed.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

from data_pipeline.adapters.financials_base import FinancialQuarter

log = logging.getLogger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# Concept fallback chains — EDGAR uses different tags per company /
# accounting standard. Walking the list picks the first that has
# non-empty facts.
REVENUE_CONCEPTS = [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
]
COGS_CONCEPTS = [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
]
OPERATING_INCOME_CONCEPTS = ["OperatingIncomeLoss"]
NET_INCOME_CONCEPTS = ["NetIncomeLoss"]
CAPEX_CONCEPTS = ["PaymentsToAcquirePropertyPlantAndEquipment"]

# Quarter mapping from fp (fiscal period) string.
FP_TO_QUARTER = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}


def _parse_period_end(s: str) -> date:
    return datetime.fromisoformat(s).date()


def _calendar_quarter(d: date) -> int:
    """Return the calendar quarter (1..4) that contains date `d`.

    SEC sometimes reports `fp = "FY"` on the annual filing alongside Q4
    figures, so when fp doesn't directly match we infer from the
    period_end date.
    """
    return (d.month - 1) // 3 + 1


def _pick_quarterly_facts(
    facts_json: dict[str, Any], concepts: list[str]
) -> list[dict[str, Any]]:
    """Walk the concept fallback chain; return the first non-empty 'USD'
    fact list under us-gaap. Quarterly view = `frame` containing 'Q' or
    `fp` in {Q1, Q2, Q3, Q4}.

    SEC pads each filing with multiple values — annuals, YTD, and
    actual-quarter — distinguished by `fp` and `qtrs` (the
    "covered quarters" count). For quarterly granularity we want
    `qtrs == 1` rows.
    """
    us_gaap = facts_json.get("facts", {}).get("us-gaap", {})
    for c in concepts:
        units = us_gaap.get(c, {}).get("units", {})
        usd = units.get("USD") or units.get("USD/shares") or []
        if not usd:
            continue
        # Filter to single-quarter rows. Some concepts publish only
        # annual rows; we skip those silently and the caller falls back
        # to None.
        quarterly = [f for f in usd if f.get("qtrs") == 1 or f.get("fp") in FP_TO_QUARTER]
        if quarterly:
            return quarterly
    return []


def _aggregate(
    facts_by_concept: dict[str, list[dict[str, Any]]],
    quarters: int,
) -> list[FinancialQuarter]:
    """Group facts by (fy, fq) and emit at most `quarters` rows,
    descending by period_end, then re-sort ascending to match the
    adapter contract."""
    # Index by (year, quarter, period_end_iso) for easy joining.
    by_period: dict[tuple[int, int, str], dict[str, float]] = {}
    for concept, facts in facts_by_concept.items():
        for f in facts:
            try:
                end_iso = f["end"]
                end_date = _parse_period_end(end_iso)
                fy = int(f.get("fy") or end_date.year)
                # Prefer fp mapping; fall back to inferring from end month.
                fp = f.get("fp")
                fq = FP_TO_QUARTER.get(fp) if isinstance(fp, str) else None
                if fq is None:
                    fq = _calendar_quarter(end_date)
                val = float(f["val"])
            except (KeyError, ValueError, TypeError):
                continue
            key = (fy, fq, end_iso)
            slot = by_period.setdefault(key, {})
            # If we already have a value for this concept at this key,
            # prefer the larger absolute value (annual filings sometimes
            # restate intermediate quarters with corrected numbers).
            existing = slot.get(concept)
            if existing is None or abs(val) >= abs(existing):
                slot[concept] = val

    items = sorted(by_period.items(), key=lambda kv: kv[0][2], reverse=True)[:quarters]
    rows: list[FinancialQuarter] = []
    for (fy, fq, end_iso), m in items:
        revenue = m.get("revenue")
        cogs = m.get("cogs")
        op_income = m.get("op_income")
        net = m.get("net_income")
        capex = m.get("capex")
        gross = revenue - cogs if revenue is not None and cogs is not None else None
        # Approximate opex from operating income: opex ≈ gross - op_income.
        opex = (gross - op_income) if gross is not None and op_income is not None else None
        # EBITDA ≈ operating income + depreciation. We don't fetch D&A
        # explicitly here, so we use operating income as a proxy. Real
        # EBITDA needs us-gaap:DepreciationAndAmortization; M10c refinement.
        ebitda = op_income
        rows.append(
            FinancialQuarter(
                fiscal_year=fy,
                fiscal_quarter=fq,
                period_end=_parse_period_end(end_iso),
                revenue_usd=revenue,
                cogs_usd=cogs,
                gross_profit_usd=gross,
                opex_usd=opex,
                ebitda_usd=ebitda,
                net_income_usd=net,
                capex_usd=abs(capex) if capex is not None else None,
                source="edgar",
            )
        )
    rows.sort(key=lambda r: r.period_end)
    return rows


class EdgarSource:
    """SEC EDGAR adapter.

    `user_agent` is required — SEC rejects requests without a contact
    email in the UA string. Default constructed via env var
    `EDGAR_USER_AGENT` in the wiring code.
    """

    def __init__(self, user_agent: str) -> None:
        if not user_agent or "@" not in user_agent:
            raise ValueError(
                "EdgarSource requires a User-Agent with a contact email "
                "per SEC fair-access policy: 'Project Name email@example.com'"
            )
        self._user_agent = user_agent
        self._ticker_to_cik: dict[str, int] | None = None
        self._ticker_lock = asyncio.Lock()

    async def _load_ticker_map(self) -> dict[str, int]:
        if self._ticker_to_cik is not None:
            return self._ticker_to_cik
        async with self._ticker_lock:
            if self._ticker_to_cik is not None:
                return self._ticker_to_cik
            import httpx

            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(
                    SEC_TICKERS_URL,
                    headers={"User-Agent": self._user_agent},
                )
                r.raise_for_status()
                data = r.json()
            # The endpoint returns a dict keyed by integer-as-string,
            # each value has { "cik_str": int, "ticker": str, "title": str }.
            m: dict[str, int] = {}
            for v in data.values():
                ticker = str(v.get("ticker", "")).upper()
                cik = int(v.get("cik_str", 0))
                if ticker and cik:
                    m[ticker] = cik
            self._ticker_to_cik = m
            log.info("edgar: loaded %d ticker→CIK mappings", len(m))
            return m

    async def fetch_financials(
        self,
        *,
        ticker: str,
        exchange: str,
        country: str,
        quarters: int,
    ) -> list[FinancialQuarter]:
        if country.upper() != "US":
            return []
        ticker_map = await self._load_ticker_map()
        cik = ticker_map.get(ticker.upper())
        if cik is None:
            log.info("edgar: no CIK for ticker %s", ticker)
            return []

        import httpx

        url = SEC_COMPANY_FACTS.format(cik=cik)
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(url, headers={"User-Agent": self._user_agent})
            if r.status_code == 404:
                return []
            r.raise_for_status()
            facts = r.json()

        facts_by_concept = {
            "revenue": _pick_quarterly_facts(facts, REVENUE_CONCEPTS),
            "cogs": _pick_quarterly_facts(facts, COGS_CONCEPTS),
            "op_income": _pick_quarterly_facts(facts, OPERATING_INCOME_CONCEPTS),
            "net_income": _pick_quarterly_facts(facts, NET_INCOME_CONCEPTS),
            "capex": _pick_quarterly_facts(facts, CAPEX_CONCEPTS),
        }
        return _aggregate(facts_by_concept, quarters=quarters)


__all__ = ["EdgarSource", "_aggregate", "_pick_quarterly_facts", "_calendar_quarter"]
