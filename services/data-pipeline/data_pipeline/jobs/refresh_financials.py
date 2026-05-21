"""refresh_financials — milestone 10b.

For each equity in `sector_equities`, fetch the last `quarters` quarters
of fundamentals from the country-appropriate source (DART for KR,
EDGAR for US), and upsert into `equity_financials`.

Routing is per-equity by `iso_country`; we accept two FinancialsSource
instances so the job remains source-agnostic (a tests run with a single
FakeFinancialsSource for both countries).

Failure isolation matches `refresh_quote_history`:
- empty list from the upstream → counted in `empty`
- raised → counted in `errors`, captured in `failure_reasons` (first 50)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from pydantic import BaseModel

from data_pipeline.adapters.financials_base import FinancialsSource
from data_pipeline.repo import EquityRepository, FinancialRow

log = logging.getLogger(__name__)


class RefreshFinancialsResult(BaseModel):
    started_at: datetime
    finished_at: datetime
    total: int
    updated: int
    rows_written: int
    empty: int
    errors: int
    quarters: int
    failure_reasons: dict[str, str] = {}


async def refresh_financials(
    *,
    us_source: FinancialsSource,
    kr_source: FinancialsSource | None,
    repo: EquityRepository,
    quarters: int = 8,
    throttle_ms: int = 200,
) -> RefreshFinancialsResult:
    """Run the refresh.

    `us_source` is required (EDGAR has no key). `kr_source` is optional
    — if `DART_API_KEY` is unset we skip KR equities rather than crash.
    """
    started_at = datetime.now(UTC)
    equities = await repo.list_all()

    updated = 0
    rows_written = 0
    empty = 0
    errors = 0
    failure_reasons: dict[str, str] = {}

    for eq in equities:
        country = eq.iso_country.upper()
        source: FinancialsSource | None
        if country == "US":
            source = us_source
        elif country == "KR":
            source = kr_source
        else:
            log.info(
                "refresh_financials: skipping %s (unsupported country %s)",
                eq.ticker,
                country,
            )
            empty += 1
            continue

        if source is None:
            log.info(
                "refresh_financials: no source for country %s (ticker %s)",
                country,
                eq.ticker,
            )
            empty += 1
            await _throttle(throttle_ms)
            continue

        try:
            quarters_data = await source.fetch_financials(
                ticker=eq.ticker,
                exchange=eq.exchange,
                country=country,
                quarters=quarters,
            )
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning(
                "refresh_financials: fetch raised for %s/%s: %s",
                eq.sector_slug,
                eq.ticker,
                e,
            )
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"fetch raised: {e}"
            await _throttle(throttle_ms)
            continue

        if not quarters_data:
            empty += 1
            log.info(
                "refresh_financials: no rows for %s/%s",
                eq.sector_slug,
                eq.ticker,
            )
            await _throttle(throttle_ms)
            continue

        rows = [
            FinancialRow(
                fiscal_year=q.fiscal_year,
                fiscal_quarter=q.fiscal_quarter,
                period_end=q.period_end,
                revenue_usd=q.revenue_usd,
                cogs_usd=q.cogs_usd,
                gross_profit_usd=q.gross_profit_usd,
                opex_usd=q.opex_usd,
                ebitda_usd=q.ebitda_usd,
                net_income_usd=q.net_income_usd,
                capex_usd=q.capex_usd,
                source=q.source,
            )
            for q in quarters_data
        ]
        try:
            n = await repo.bulk_upsert_financials(eq.id, rows)
            rows_written += n
            updated += 1
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning("refresh_financials: upsert raised for %s: %s", eq.id, e)
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"upsert raised: {e}"

        await _throttle(throttle_ms)

    finished_at = datetime.now(UTC)
    log.info(
        "refresh_financials finished: total=%d updated=%d rows=%d empty=%d errors=%d duration_s=%.1f",
        len(equities),
        updated,
        rows_written,
        empty,
        errors,
        (finished_at - started_at).total_seconds(),
    )
    return RefreshFinancialsResult(
        started_at=started_at,
        finished_at=finished_at,
        total=len(equities),
        updated=updated,
        rows_written=rows_written,
        empty=empty,
        errors=errors,
        quarters=quarters,
        failure_reasons=failure_reasons,
    )


async def _throttle(ms: int) -> None:
    if ms > 0:
        await asyncio.sleep(ms / 1000.0)
