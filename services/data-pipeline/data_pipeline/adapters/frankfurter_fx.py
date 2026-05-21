"""Frankfurter historical FX adapter — milestone 10c.

Frankfurter (https://www.frankfurter.app) is a free public FX API
sourced from the European Central Bank. No key required. Useful for
backfilling quarter-end FX so the DART adapter's KRW → USD conversion
doesn't apply a single 2026 rate to every historical quarter (which
distorts revenue YoY when KRW has drifted).

The adapter is intentionally tiny — only the `latest` and `historical`
date endpoints — and caches by (date_iso, base, target) so repeated
calls during one job stay free.

Endpoint shapes:
  - GET https://api.frankfurter.app/{date}?from=USD&to=KRW
    → {"date": "2025-03-31", "rates": {"KRW": 1457.21}}
  - "Latest" is the default if you GET /latest

If the requested `date` falls on a non-business day (FX market
closed), Frankfurter automatically rolls back to the most recent
business day's quote and returns that with a `date` field reflecting
the actual quote date. We just trust the returned value.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import date

import httpx

log = logging.getLogger(__name__)

FRANKFURTER_BASE = "https://api.frankfurter.app"


class FrankfurterFx:
    """Async historical FX lookup with an in-process cache.

    Cache key = (date_iso, base, target). On lookup failure (HTTP
    non-2xx, network error, target currency unsupported by ECB)
    returns None — the caller decides whether to fall back to a
    constant rate or skip.
    """

    def __init__(self, *, timeout_s: float = 10.0) -> None:
        self._timeout = timeout_s
        self._cache: dict[tuple[str, str, str], float] = {}
        self._lock = asyncio.Lock()

    async def krw_per_usd(self, on: date) -> float | None:
        """Return KRW per 1 USD on (or near) `on`. None if unavailable."""
        return await self._fetch("USD", "KRW", on)

    async def rate(self, *, base: str, target: str, on: date) -> float | None:
        """Generic historical rate lookup (M10d). Returns
        `target per 1 base` on (or near) `on`, or None when the pair
        isn't supported / Frankfurter returns an error. Same on-disk
        contract as `krw_per_usd` — caching, async-lock, exception
        handling all apply."""
        return await self._fetch(base.upper(), target.upper(), on)

    def local_per_usd_factory(
        self, currency: str
    ) -> Callable[[date], Awaitable[float | None]]:
        """Build a partial `(date) → local-per-1-USD` callable for an
        arbitrary local currency. Useful when wiring a non-DART KR
        adapter (e.g., a future JPY / EUR ingest) into the same
        per-quarter FX path as `DartSource(fx_for=...)`."""

        async def lookup(on: date) -> float | None:
            return await self._fetch("USD", currency.upper(), on)

        return lookup

    async def _fetch(self, base: str, target: str, on: date) -> float | None:
        key = (on.isoformat(), base, target)
        if key in self._cache:
            return self._cache[key]

        async with self._lock:
            if key in self._cache:
                return self._cache[key]
            try:
                url = f"{FRANKFURTER_BASE}/{on.isoformat()}"
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    r = await client.get(url, params={"from": base, "to": target})
                if r.status_code != 200:
                    log.info(
                        "frankfurter: %s/%s/%s → %s",
                        on,
                        base,
                        target,
                        r.status_code,
                    )
                    return None
                body = r.json()
                rate = body.get("rates", {}).get(target)
                if rate is None:
                    return None
                rate_f = float(rate)
                self._cache[key] = rate_f
                return rate_f
            except Exception as e:  # noqa: BLE001
                log.warning("frankfurter: fetch error for %s %s/%s: %s", on, base, target, e)
                return None
