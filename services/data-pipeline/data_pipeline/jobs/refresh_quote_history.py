"""refresh_quote_history — for each equity in `sector_equities`, fetch
the last N days of daily bars from the data source and upsert them
into `equity_quotes`.

Idempotent by ON CONFLICT (equity_id, trade_date) DO UPDATE — re-running
on the same day overwrites the previous fetch's bars. Safe to invoke
manually multiple times during dev (which is the M3 default workflow,
since the scheduler is off in local mode).

Failure isolation matches `refresh_quotes`:
- empty bars list from the upstream → counted in `empty`, no abort
- raised → counted in `errors`
- per-equity FX conversion happens here, not in the adapter
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from pydantic import BaseModel

from data_pipeline.adapters.base import DataSource
from data_pipeline.adapters.yfinance_source import exchange_to_symbol
from data_pipeline.repo import EquityRepository, QuoteBar

log = logging.getLogger(__name__)


class RefreshHistoryResult(BaseModel):
    started_at: datetime
    finished_at: datetime
    total: int
    updated: int
    bars_written: int
    empty: int
    errors: int
    days: int
    fx_rates: dict[str, float]
    failure_reasons: dict[str, str] = {}


async def refresh_quote_history(
    *,
    source: DataSource,
    repo: EquityRepository,
    days: int = 90,
    throttle_ms: int = 200,
) -> RefreshHistoryResult:
    started_at = datetime.now(UTC)
    equities = await repo.list_all()

    # FX rates: same pattern as refresh_quotes — fetch once per
    # currency. For history we apply the *current* FX to every bar in
    # the series. That's a known approximation (true historical FX
    # would need a separate time series); milestone 4 can backfill via
    # FRED's exchange-rate series if it matters.
    currencies = {e.currency for e in equities if e.currency} | {"USD"}
    fx: dict[str, float] = {}
    for cur in sorted(currencies):
        rate = await source.fetch_fx_to_usd(cur)
        if rate is not None:
            fx[cur] = rate
        else:
            log.warning("refresh_quote_history: no FX rate for %s", cur)

    updated = 0
    bars_written = 0
    empty = 0
    errors = 0
    failure_reasons: dict[str, str] = {}

    for eq in equities:
        symbol = exchange_to_symbol(eq.exchange, eq.ticker)
        try:
            history = await source.fetch_history(symbol, days=days)
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning(
                "refresh_quote_history: fetch raised for %s/%s (%s): %s",
                eq.sector_slug,
                eq.ticker,
                symbol,
                e,
            )
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"fetch raised: {e}"
            await _throttle(throttle_ms)
            continue

        if not history:
            empty += 1
            log.info(
                "refresh_quote_history: no history bars for %s/%s (%s)",
                eq.sector_slug,
                eq.ticker,
                symbol,
            )
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = "no history bars"
            await _throttle(throttle_ms)
            continue

        currency = (eq.currency or "USD").upper()
        usd_rate = fx.get(currency)
        bars = [
            QuoteBar(
                trade_date=h.trade_date,
                close_local=h.close_local,
                close_usd=h.close_local * usd_rate if usd_rate is not None else None,
                volume=h.volume,
                source="yfinance",
            )
            for h in history
        ]
        try:
            n = await repo.bulk_upsert_quote_history(eq.id, bars)
            bars_written += n
            updated += 1
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning("refresh_quote_history: upsert raised for %s: %s", eq.id, e)
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"upsert raised: {e}"

        await _throttle(throttle_ms)

    finished_at = datetime.now(UTC)
    log.info(
        "refresh_quote_history finished: total=%d updated=%d bars=%d empty=%d errors=%d duration_s=%.1f",
        len(equities),
        updated,
        bars_written,
        empty,
        errors,
        (finished_at - started_at).total_seconds(),
    )
    return RefreshHistoryResult(
        started_at=started_at,
        finished_at=finished_at,
        total=len(equities),
        updated=updated,
        bars_written=bars_written,
        empty=empty,
        errors=errors,
        days=days,
        fx_rates=fx,
        failure_reasons=failure_reasons,
    )


async def _throttle(ms: int) -> None:
    if ms > 0:
        await asyncio.sleep(ms / 1000.0)
