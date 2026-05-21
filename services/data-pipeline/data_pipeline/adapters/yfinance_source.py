"""yfinance-backed DataSource.

yfinance is an unofficial Yahoo Finance scraper. Acceptable for dev /
MVP — replace with a paid provider (AlphaVantage / Polygon / Tiingo)
before any SLA-bound prod usage. The DataSource Protocol means that
swap is local.

Symbol convention:
  US      → bare ticker (NVDA, MU, …)
  KOSPI   → <6-digit>.KS  (e.g. 005930.KS)
  KOSDAQ  → <6-digit>.KQ  (e.g. 042700.KQ)

FX:
  USD → 1.0 (no-op)
  KRW → yfinance "KRW=X" reports KRW per USD; we invert to get USD per KRW.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from data_pipeline.adapters.base import HistoryBar, Quote

log = logging.getLogger(__name__)


# yfinance does blocking HTTP via `requests` under the hood. We run each
# call in a worker thread so the async event loop stays free for the
# scheduler / health endpoint.
async def _to_thread(fn, *args, **kwargs):  # type: ignore[no-untyped-def]
    return await asyncio.to_thread(fn, *args, **kwargs)


class YFinanceSource:
    """Production source. Constructed empty; per-symbol state is fetched
    lazily on each call so a long-lived process doesn't accumulate
    stale `yfinance.Ticker` objects."""

    def __init__(self) -> None:
        # Import lazily so the test environment can construct a
        # YFinanceSource even if `yfinance` isn't installed (it will only
        # explode at the first network-bound call).
        try:
            import yfinance  # noqa: F401
        except ImportError:  # pragma: no cover — guarded for non-prod envs
            log.warning("yfinance is not importable; live calls will fail")

    async def fetch_quote(self, symbol: str) -> Quote | None:
        import yfinance as yf

        def _fetch() -> dict[str, Any] | None:
            t = yf.Ticker(symbol)
            # `fast_info` is much cheaper than `info` (no scraping the
            # quote-summary page). We accept whatever it returns; if
            # fields are missing we ride with None — milestone 3+ can
            # backfill from a richer source.
            try:
                fast = t.fast_info
            except Exception as e:  # noqa: BLE001
                log.warning("yfinance fast_info failed for %s: %s", symbol, e)
                return None
            price = _coerce_float(getattr(fast, "last_price", None))
            currency = getattr(fast, "currency", None)
            if price is None or not currency:
                return None
            market_cap = _coerce_float(getattr(fast, "market_cap", None))
            return {
                "price": price,
                "currency": currency.upper(),
                "market_cap": market_cap,
            }

        try:
            data = await _to_thread(_fetch)
        except Exception as e:  # noqa: BLE001
            log.warning("yfinance fetch_quote raised for %s: %s", symbol, e)
            return None
        if data is None:
            return None
        return Quote(
            symbol=symbol,
            last_close_local=data["price"],
            currency=data["currency"],
            last_close_date=datetime.now(UTC),
            market_cap_local=data["market_cap"],
        )

    async def fetch_fx_to_usd(self, currency: str) -> float | None:
        currency = currency.upper()
        if currency == "USD":
            return 1.0
        # yfinance FX pairs: `KRW=X` quotes KRW per USD (so ~1380).
        # Invert to USD per KRW (~0.000725).
        symbol = f"{currency}=X"

        def _fetch() -> float | None:
            import yfinance as yf

            try:
                fast = yf.Ticker(symbol).fast_info
                rate = _coerce_float(getattr(fast, "last_price", None))
            except Exception as e:  # noqa: BLE001
                log.warning("yfinance FX fetch failed for %s: %s", symbol, e)
                return None
            if not rate or rate <= 0:
                return None
            return 1.0 / rate

        return await _to_thread(_fetch)

    async def fetch_history(self, symbol: str, *, days: int) -> list[HistoryBar]:
        import yfinance as yf

        # yfinance's `period` strings cap at common values; we ask for
        # the next bucket up and slice in Python to honor `days` exactly.
        # 90 days → "3mo", 180 → "6mo", 365 → "1y", default to "1y".
        period = _period_for(days)

        def _fetch() -> list[HistoryBar]:
            try:
                df = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=False)
            except Exception as e:  # noqa: BLE001
                log.warning("yfinance history fetch failed for %s: %s", symbol, e)
                return []
            if df is None or df.empty:
                return []
            bars: list[HistoryBar] = []
            for ts, row in df.iterrows():
                close = _coerce_float(row.get("Close"))
                if close is None:
                    continue
                vol = _coerce_float(row.get("Volume"))
                # ts is a pandas Timestamp; ts.date() gives us a plain date.
                bars.append(
                    HistoryBar(
                        trade_date=ts.date(),
                        close_local=close,
                        volume=vol if vol and vol > 0 else None,
                    )
                )
            return bars[-days:] if days < len(bars) else bars

        try:
            return await _to_thread(_fetch)
        except Exception as e:  # noqa: BLE001
            log.warning("yfinance fetch_history raised for %s: %s", symbol, e)
            return []


def _coerce_float(v: Any) -> float | None:  # noqa: ANN401
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN guard — math.isnan would be cleaner, dep-free check is fine
        return None
    return f


def _period_for(days: int) -> str:
    """Map a days request to the nearest yfinance `period` string that
    contains at least that many bars. yfinance returns calendar days but
    skips weekends/holidays, so we always over-fetch and slice in
    Python."""
    if days <= 30:
        return "3mo"
    if days <= 90:
        return "6mo"
    if days <= 180:
        return "1y"
    if days <= 365:
        return "2y"
    return "5y"


def exchange_to_symbol(exchange: str, ticker: str) -> str:
    """Map the editorial (exchange, ticker) tuple to a yfinance symbol.

    >>> exchange_to_symbol("NASDAQ", "NVDA")
    'NVDA'
    >>> exchange_to_symbol("KOSPI", "005930")
    '005930.KS'
    >>> exchange_to_symbol("KOSDAQ", "042700")
    '042700.KQ'
    """
    ex = exchange.upper()
    if ex in {"NASDAQ", "NYSE"}:
        return ticker
    if ex == "KOSPI":
        return f"{ticker}.KS"
    if ex == "KOSDAQ":
        return f"{ticker}.KQ"
    # Fallback — pass through. yfinance will likely 404 but that's a
    # caller error to fix in the seed, not ours to paper over.
    return ticker
