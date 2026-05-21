"""refresh_quotes — for each equity in the sector_equities table, ask
the data source for a fresh close + market cap, FX-convert if needed,
upsert back.

This is the only write job in Milestone 2. It's idempotent (always
re-runs the full basket) and bounded (a few dozen equities). Caller is
expected to throttle externally via `min_interval_sec` — by default
we sleep 200ms between symbols so we don't hammer yfinance.

Failure modes:
  - symbol not on the upstream (None Quote): skipped, counted in
    `missing`. Does not abort the job.
  - upstream raised: caught, counted in `errors`, equity left as-is.
  - missing FX rate for a currency we encounter: the equity is still
    updated with `last_close_local` and `currency`, but `last_close_usd`
    / `market_cap_usd` are nulled so the UI shows the gap cleanly.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from pydantic import BaseModel

from data_pipeline.adapters.base import DataSource
from data_pipeline.adapters.yfinance_source import exchange_to_symbol
from data_pipeline.repo import EquityRecord, EquityRepository

log = logging.getLogger(__name__)


class RefreshQuotesResult(BaseModel):
    started_at: datetime
    finished_at: datetime
    total: int
    updated: int
    missing: int
    errors: int
    fx_rates: dict[str, float]
    # equity_id → human readable reason; capped at 50 entries so a fully
    # broken run doesn't balloon the response payload.
    failure_reasons: dict[str, str] = {}


async def refresh_quotes(
    *,
    source: DataSource,
    repo: EquityRepository,
    throttle_ms: int = 200,
) -> RefreshQuotesResult:
    started_at = datetime.now(UTC)
    equities = await repo.list_all()

    # Pre-fetch FX rates we'll need so we make one network call per
    # currency rather than one per equity. Currencies that aren't on
    # any row simply don't get fetched.
    currencies = {e.currency for e in equities if e.currency} | {"USD"}
    fx: dict[str, float] = {}
    for cur in sorted(currencies):
        rate = await source.fetch_fx_to_usd(cur)
        if rate is not None:
            fx[cur] = rate
        else:
            log.warning("refresh_quotes: no FX rate for %s", cur)

    updated = 0
    missing = 0
    errors = 0
    failure_reasons: dict[str, str] = {}

    for eq in equities:
        symbol = exchange_to_symbol(eq.exchange, eq.ticker)
        try:
            quote = await source.fetch_quote(symbol)
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning(
                "refresh_quotes: fetch raised for %s/%s (%s): %s",
                eq.sector_slug,
                eq.ticker,
                symbol,
                e,
            )
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"fetch raised: {e}"
            await _throttle(throttle_ms)
            continue

        if quote is None:
            missing += 1
            log.info(
                "refresh_quotes: upstream returned None for %s/%s (%s)",
                eq.sector_slug,
                eq.ticker,
                symbol,
            )
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = "upstream returned no quote"
            await _throttle(throttle_ms)
            continue

        currency = quote.currency.upper()
        usd_rate = fx.get(currency)
        last_close_usd = quote.last_close_local * usd_rate if usd_rate else None
        market_cap_usd = (
            quote.market_cap_local * usd_rate
            if (quote.market_cap_local is not None and usd_rate is not None)
            else None
        )
        try:
            await repo.update_quote(
                eq.id,
                last_close_local=quote.last_close_local,
                last_close_usd=last_close_usd,
                last_close_date=quote.last_close_date,
                market_cap_usd=market_cap_usd,
                currency=currency,
            )
            updated += 1
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning("refresh_quotes: update raised for %s: %s", eq.id, e)
            if len(failure_reasons) < 50:
                failure_reasons[eq.id] = f"update raised: {e}"

        await _throttle(throttle_ms)

    finished_at = datetime.now(UTC)
    log.info(
        "refresh_quotes finished: total=%d updated=%d missing=%d errors=%d duration_s=%.1f",
        len(equities),
        updated,
        missing,
        errors,
        (finished_at - started_at).total_seconds(),
    )
    return RefreshQuotesResult(
        started_at=started_at,
        finished_at=finished_at,
        total=len(equities),
        updated=updated,
        missing=missing,
        errors=errors,
        fx_rates=fx,
        failure_reasons=failure_reasons,
    )


# Used by the refresh job to space out upstream calls. Extracted so
# tests can monkey-patch and skip the wait without dragging in the
# event loop's `sleep` directly.
async def _throttle(ms: int) -> None:
    if ms > 0:
        await asyncio.sleep(ms / 1000.0)


__all__ = ["EquityRecord", "RefreshQuotesResult", "refresh_quotes"]
