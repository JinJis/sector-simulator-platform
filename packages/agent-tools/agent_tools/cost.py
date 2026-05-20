"""Cost model + meter for LLM calls.

Prices are the public Anthropic per-1M token rates as of 2026-05.
Cache reads are billed at ~0.1× input; 5-minute cache writes at ~1.25×.
We don't track the 1-hour TTL premium because everywhere we cache today
uses the default ephemeral (5-minute) TTL.

Numbers stored as USD per **1M** tokens so the multipliers stay readable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float
    # Multipliers applied to the input price.
    cache_read_multiplier: float = 0.1
    cache_write_multiplier: float = 1.25


# Public API prices (per 1M tokens) at the time of writing.
# Source of truth lives at the model catalog page — re-check when migrating models.
_PRICES: dict[str, ModelPrice] = {
    "claude-opus-4-7": ModelPrice(5.00, 25.00),
    "claude-sonnet-4-6": ModelPrice(3.00, 15.00),
    "claude-haiku-4-5": ModelPrice(1.00, 5.00),
}


def model_price(model_id: str) -> ModelPrice:
    """Look up the price entry for a model. Falls back to the cheapest entry
    (haiku) for unknown IDs rather than raising — so an unfamiliar model
    surfaces as a small cost spike in the meter instead of a crashed agent.
    """
    return _PRICES.get(model_id, _PRICES["claude-haiku-4-5"])


@dataclass(frozen=True)
class PricedUsage:
    """Token counts + computed USD cost for a single call."""

    model: str
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    cost_usd: float

    @property
    def total_input_tokens(self) -> int:
        """Including cached + cache-write prefix, which still flow through the
        prompt even though they're billed at discounted rates."""
        return (
            self.input_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
        )


def price_call(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
) -> PricedUsage:
    p = model_price(model)
    cost = (
        input_tokens * p.input_per_million_usd
        + output_tokens * p.output_per_million_usd
        + cache_creation_input_tokens * p.input_per_million_usd * p.cache_write_multiplier
        + cache_read_input_tokens * p.input_per_million_usd * p.cache_read_multiplier
    ) / 1_000_000.0
    return PricedUsage(
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_creation_input_tokens=cache_creation_input_tokens,
        cache_read_input_tokens=cache_read_input_tokens,
        cost_usd=cost,
    )


class CostMeter:
    """Thread-safe accumulator. One instance per agent run is enough; later
    slices will scope these per-tenant + persist them via LangSmith/Helicone.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._calls: list[PricedUsage] = []

    def record(self, usage: PricedUsage) -> None:
        with self._lock:
            self._calls.append(usage)

    @property
    def calls(self) -> list[PricedUsage]:
        with self._lock:
            return list(self._calls)

    @property
    def total_usd(self) -> float:
        with self._lock:
            return sum(c.cost_usd for c in self._calls)

    def by_model(self) -> dict[str, float]:
        with self._lock:
            out: dict[str, float] = {}
            for c in self._calls:
                out[c.model] = out.get(c.model, 0.0) + c.cost_usd
            return out

    def summary(self) -> dict[str, object]:
        """JSON-serializable snapshot — suitable for /audit logs and tests."""
        with self._lock:
            return {
                "calls": len(self._calls),
                "total_usd": round(sum(c.cost_usd for c in self._calls), 6),
                "by_model": {
                    m: round(v, 6) for m, v in self._summarize_by_model().items()
                },
                "tokens": {
                    "input": sum(c.input_tokens for c in self._calls),
                    "output": sum(c.output_tokens for c in self._calls),
                    "cache_write": sum(c.cache_creation_input_tokens for c in self._calls),
                    "cache_read": sum(c.cache_read_input_tokens for c in self._calls),
                },
            }

    def _summarize_by_model(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for c in self._calls:
            out[c.model] = out.get(c.model, 0.0) + c.cost_usd
        return out
