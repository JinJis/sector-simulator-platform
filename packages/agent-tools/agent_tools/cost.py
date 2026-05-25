"""Cost model + meter for LLM calls.

Prices stored as USD per **1M** tokens so the multipliers stay readable.

History:
- pre-M34: Anthropic Claude only.
- M34 (2026-05-22): swapped entirely to Google Gemini.
- M35 (2026-05-22): brought Claude back for the opus tier alongside
  Gemini for sonnet/haiku. The `cache_read_multiplier` /
  `cache_write_multiplier` fields drive the Anthropic prompt-caching
  math (and remain neutral-ish for Gemini, where we don't use explicit
  context caching today).
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float
    # Multipliers applied to the input price.
    # - Gemini: defaults to (0.25, 1.0). We don't use explicit
    #   `cachedContent` today, so the cache_read field is populated only
    #   when the response surfaces `cached_content_token_count`.
    # - Claude: standard Anthropic prompt-caching economics
    #   (cache read = 0.1×, cache write = 1.25×).
    cache_read_multiplier: float = 0.25
    cache_write_multiplier: float = 1.0


# Per-1M-token published rates as of 2026-05.
# Sources: https://ai.google.dev/gemini-api/docs/pricing (Gemini),
#          https://www.anthropic.com/pricing (Claude).
_PRICES: dict[str, ModelPrice] = {
    # claude-opus-4-7 — opus tier. Bills via AnthropicVertex (same
    # public list price as the Anthropic API). Cache multipliers are
    # Anthropic-specific: 90% discount on cache reads, 25% premium on
    # cache writes.
    "claude-opus-4-7": ModelPrice(
        input_per_million_usd=15.00,
        output_per_million_usd=75.00,
        cache_read_multiplier=0.1,
        cache_write_multiplier=1.25,
    ),
    # gemini-3.5-flash — sonnet tier. Cheap, fast, used for the bulk
    # of research / driver inference / prediction rationale analysis.
    "gemini-3.5-flash": ModelPrice(0.50, 3.00),
    # gemini-3.5-flash-lite — haiku tier. Cheapest tier; used for
    # extraction + routing + classification.
    "gemini-3.5-flash-lite": ModelPrice(0.25, 1.50),
}


def model_price(model_id: str) -> ModelPrice:
    """Look up the price entry for a model. Falls back to the cheapest
    Gemini entry for unknown IDs rather than raising — so an unfamiliar
    model surfaces as a small cost spike in the meter instead of a
    crashed agent.
    """
    return _PRICES.get(model_id, _PRICES["gemini-3.5-flash-lite"])


# M48b — Gemini Deep Research is billed per-task, not per-token, and the
# Interactions API doesn't currently surface a usage_metadata field we
# can multiply into a token rate. So we estimate cost from a flat
# per-tier USD-per-run figure here; replace with metered usage once the
# SDK exposes it (or once we move to a paid agent contract with a
# documented rate). These are starting-point placeholders — bump them
# from the admin cockpit when actual invoices land.
_DEEP_RESEARCH_PRICES_USD: dict[str, float] = {
    "deep-research-preview-04-2026": 0.10,
    "deep-research-max-preview-04-2026": 0.50,
}


def deep_research_price_usd(model_id: str) -> float:
    """Flat USD cost per Deep Research run. Falls back to the
    fast-tier price for unknown model IDs."""
    return _DEEP_RESEARCH_PRICES_USD.get(
        model_id, _DEEP_RESEARCH_PRICES_USD["deep-research-preview-04-2026"]
    )


@dataclass(frozen=True)
class PricedUsage:
    """Token counts + computed USD cost for a single call.

    `cache_creation_input_tokens` / `cache_read_input_tokens` are 0 on
    the Gemini path today (we don't use explicit context caching), but
    populated on the Anthropic path when prompt caching is in play.
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
