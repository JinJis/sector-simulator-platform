"""Cost model + meter for LLM calls.

Prices stored as USD per **1M** tokens so the multipliers stay readable.

History:
- pre-M34: Anthropic Claude only.
- M34 (2026-05-22): swapped entirely to Google Gemini.
- M35 (2026-05-22): brought Claude back for the deep tier alongside
  Gemini for balanced/fast.
- F9 (2026-05-28): dropped Claude entirely. All three tiers now route
  through Gemini; the per-model entries here are Gemini-only and the
  cache_read multiplier reflects Gemini's `cachedContent` 0.25× discount
  (cache_write stays neutral — we don't proactively write a cached
  context today).
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float
    # Cache multipliers applied to the input price. Defaults match
    # Gemini's `cachedContent` economics: 0.25× discount on cache reads,
    # no write premium (we don't pre-warm a cache today). Per-model
    # entries can override if a future Gemini SKU prices caching
    # differently.
    cache_read_multiplier: float = 0.25
    cache_write_multiplier: float = 1.0


# Per-1M-token published rates as of 2026-05.
# Sources: https://ai.google.dev/gemini-api/docs/pricing,
#          https://cloud.google.com/vertex-ai/generative-ai/pricing.
_PRICES: dict[str, ModelPrice] = {
    # gemini-3.1-pro-preview — deep tier (post-F9). Most capable; used by
    # VisionDecomposition, CodeReview, ThesisDrafter, and the grounded-
    # research DEEP path (daily digest). Carries the heaviest thinking
    # config so output tokens trend high.
    "gemini-3.1-pro-preview": ModelPrice(1.25, 10.00),
    # gemini-3.5-flash — balanced tier. Cheap, fast, used for the bulk
    # of research / driver inference / prediction rationale analysis /
    # DataSourceSelector keyword generation.
    "gemini-3.5-flash": ModelPrice(0.50, 3.00),
    # gemini-3.5-flash-lite — fast tier. Cheapest tier; used for
    # extraction + routing + classification (SignalExtractor,
    # PromptValidator, ProposalPayloadDrafter).
    "gemini-3.5-flash-lite": ModelPrice(0.25, 1.50),
    # gemini-2.5-flash — grounded-research FAST tier (capability / actor
    # / risk / signal fetchers — low ThinkingConfig).
    "gemini-2.5-flash": ModelPrice(0.30, 2.50),
}


def model_price(model_id: str) -> ModelPrice:
    """Look up the price entry for a model. Falls back to the cheapest
    Gemini entry for unknown IDs rather than raising — so an unfamiliar
    model surfaces as a small cost spike in the meter instead of a
    crashed agent.
    """
    return _PRICES.get(model_id, _PRICES["gemini-3.5-flash-lite"])


# M48b → grounded research migration: the legacy Vertex Deep Research
# Interactions API was billed per-task with no usage_metadata, so we
# used a flat per-tier USD figure here. The new GroundedResearchClient
# uses gemini models with normal per-token metering via `price_call()`,
# so this helper is retained only for any caller that still references
# the old per-run constant (none in-tree post-migration).
_LEGACY_DR_PRICE_USD = 0.10


def deep_research_price_usd(model_id: str) -> float:  # noqa: ARG001
    """Deprecated: legacy flat per-run Deep Research price. Kept as a
    compat shim; new code paths meter grounded-research calls via
    `price_call()` with normal Gemini token rates."""
    return _LEGACY_DR_PRICE_USD


@dataclass(frozen=True)
class PricedUsage:
    """Token counts + computed USD cost for a single call.

    `cache_creation_input_tokens` is always 0 on Gemini today (we don't
    pre-write a `cachedContent` resource). `cache_read_input_tokens` is
    populated when the response surfaces `cached_content_token_count`.
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
