"""In-process source for tests.

Behaves like a deterministic key-value store: tests construct it with a
dict of `{ symbol: Quote }` and a dict of `{ currency: usd_rate }`. No
network, no rate limiting, no surprises.
"""

from __future__ import annotations

from data_pipeline.adapters.base import DataSource, Quote


class FakeSource(DataSource):
    def __init__(
        self,
        *,
        quotes: dict[str, Quote] | None = None,
        fx: dict[str, float] | None = None,
        missing_symbols: set[str] | None = None,
        raise_on: set[str] | None = None,
    ) -> None:
        self.quotes = quotes or {}
        self.fx = fx or {"USD": 1.0}
        self.missing_symbols = missing_symbols or set()
        self.raise_on = raise_on or set()
        # Test-visible call log so assertions can verify ordering and
        # throttle behavior.
        self.fetch_calls: list[str] = []

    async def fetch_quote(self, symbol: str) -> Quote | None:
        self.fetch_calls.append(symbol)
        if symbol in self.raise_on:
            raise RuntimeError(f"FakeSource: deliberate failure for {symbol}")
        if symbol in self.missing_symbols:
            return None
        return self.quotes.get(symbol)

    async def fetch_fx_to_usd(self, currency: str) -> float | None:
        return self.fx.get(currency)
