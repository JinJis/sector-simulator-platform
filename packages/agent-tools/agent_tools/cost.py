"""Cost model + meter for LLM calls.

Prices are the public Google Gemini per-1M token rates as of 2026-05.
Thinking tokens are billed at the same rate as output tokens.

Numbers stored as USD per **1M** tokens so the multipliers stay readable.

History: this module used to encode Anthropic Claude pricing. We swapped
to Gemini in M34 (2026-05-22). The `cache_read_multiplier` and
`cache_write_multiplier` fields are kept for shape compatibility but
default to neutral values — Gemini's context caching API is invoked
through the `cachedContent` resource (an explicit upload), not the
inline ephemeral-cache trick we used with Claude, so the wrapper no
longer reports cache_creation/cache_read counts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float
    # Multipliers applied to the input price. Gemini default to neutral
    # — we don't use ephemeral caching for Gemini calls.
    cache_read_multiplier: float = 0.25
    cache_write_multiplier: float = 1.0


# Public API prices (per 1M tokens) as of 2026-05.
# https://ai.google.dev/gemini-api/docs/pricing  (verified before this slice)
#
# We use Gemini 3.x preview/GA models — they're the freshest tier and
# (importantly) carry the Gemini 3 reasoning improvements. The pro
# model bills tiered (<200k vs >200k input); we encode the cheaper
# tier here because our prompts rarely exceed 50k tokens. If we ever
# regularly cross 200k, add a `tiered_input_per_million_usd` field
# instead of guessing.
_PRICES: dict[str, ModelPrice] = {
    # 3.5-flash — opus tier (post-2026-05 swap from gemini-3.1-pro-preview,
    # which Vertex AI doesn't expose in our project). Same flash family
    # pricing as the sonnet tier; the tier distinction is now about
    # reasoning depth (thinking_budget) rather than raw $/token.
    "gemini-3.5-flash": ModelPrice(0.50, 3.00),
    # Flash — sonnet tier. Used for research + driver inference +
    # prediction analysis (Korean rationale summarization in
    # services/sector-service/src/trpc/prediction.ts).
    "gemini-3-flash-preview": ModelPrice(0.50, 3.00),
    # Flash-Lite — haiku tier. Used for cheap extraction / routing.
    "gemini-3.1-flash-lite": ModelPrice(0.25, 1.50),
}


def model_price(model_id: str) -> ModelPrice:
    """Look up the price entry for a model. Falls back to the cheapest entry
    (flash-lite) for unknown IDs rather than raising — so an unfamiliar
    model surfaces as a small cost spike in the meter instead of a
    crashed agent.
    """
    return _PRICES.get(model_id, _PRICES["gemini-3.1-flash-lite"])


@dataclass(frozen=True)
class PricedUsage:
    """Token counts + computed USD cost for a single call.

    `cache_creation_input_tokens` / `cache_read_input_tokens` are kept on
    the dataclass for shape compatibility with the Anthropic-era code,
    but in Gemini-mode they're always 0 (we don't use explicit context
    caching today).
    """

    model: str
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    cost_usd: float

    @property
    def total_input_tokens(self) -> int:
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
