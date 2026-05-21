"""In-process source for tests.

Behaves like a deterministic key-value store: tests construct it with a
dict of `{ symbol: Quote }` and a dict of `{ currency: usd_rate }`. No
network, no rate limiting, no surprises.
"""

from __future__ import annotations

from data_pipeline.adapters.base import DataSource, HistoryBar, Quote


class FakeSource(DataSource):
    def __init__(
        self,
        *,
        quotes: dict[str, Quote] | None = None,
        history: dict[str, list[HistoryBar]] | None = None,
        fx: dict[str, float] | None = None,
        missing_symbols: set[str] | None = None,
        raise_on: set[str] | None = None,
    ) -> None:
        self.quotes = quotes or {}
        self.history = history or {}
        self.fx = fx or {"USD": 1.0}
        self.missing_symbols = missing_symbols or set()
        self.raise_on = raise_on or set()
        # Test-visible call log so assertions can verify ordering and
        # throttle behavior.
        self.fetch_calls: list[str] = []
        self.history_calls: list[tuple[str, int]] = []

    async def fetch_quote(self, symbol: str) -> Quote | None:
        self.fetch_calls.append(symbol)
        if symbol in self.raise_on:
            raise RuntimeError(f"FakeSource: deliberate failure for {symbol}")
        if symbol in self.missing_symbols:
            return None
        return self.quotes.get(symbol)

    async def fetch_fx_to_usd(self, currency: str) -> float | None:
        return self.fx.get(currency)

    async def fetch_history(self, symbol: str, *, days: int) -> list[HistoryBar]:
        self.history_calls.append((symbol, days))
        if symbol in self.raise_on:
            raise RuntimeError(f"FakeSource: deliberate failure for {symbol}")
        bars = self.history.get(symbol, [])
        # Mimic the live adapter: trim to the most recent `days` bars
        # (the seed may have more). Ascending order, so slice from the
        # tail.
        return bars[-days:] if days < len(bars) else bars
