"""Async wrapper around the Gemini Deep Research Agent
(`client.interactions.create` / `.get` on the `google-genai` SDK).

The Interactions API runs research tasks that take minutes — it plans,
iteratively searches the web, reads pages, and synthesizes a cited
report. We always run it in background mode (`background=True`) and
poll until the interaction completes.

Two model tiers are exposed:
- `fast` → `deep-research-preview-04-2026` (lower-latency, streams
  reasonably to a client UI)
- `max`  → `deep-research-max-preview-04-2026` (max comprehensiveness;
  use when admin pre-approved the spend)

Collaborative planning: when `collaborative_planning=True` the agent
returns the *plan* instead of executing immediately. M52 (admin
cockpit) uses this to gate expensive `max`-tier runs behind admin
approval. For non-collaborative runs the wrapper is fire-and-poll.

Caching: keyed by `hash(prompt, surface, vision_slug, tier,
collaborative_planning)`. Default backend is an in-process dict with
30-day TTL — fine for one crawler container. M49 swaps this for a
persistent (Redis / Postgres) cache once multiple crawler replicas
land.

Cost: the Interactions API does not currently surface per-call
usage_metadata, so cost is estimated from `deep_research_price_usd`
(flat per-tier USD). The metered amount is recorded via a synthetic
`PricedUsage` row on the shared `CostMeter`, with `output_tokens` set
to a coarse estimate from `len(output_text) / 4` so token dashboards
still get *something*. Replace with real metering when the SDK
exposes it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from agent_tools.cost import (
    CostMeter,
    PricedUsage,
    deep_research_price_usd,
)


DeepResearchTier = Literal["fast", "max"]
DeepResearchSurface = Literal[
    "capability",
    "actor",
    "risk",
    "economics",
    "hello_world",
]


_MODEL_BY_TIER: dict[DeepResearchTier, str] = {
    "fast": "deep-research-preview-04-2026",
    "max": "deep-research-max-preview-04-2026",
}


def deep_research_model_for(tier: DeepResearchTier) -> str:
    return _MODEL_BY_TIER[tier]


# 30 days. Long enough that a re-asked research question doesn't burn
# the same spend twice; short enough that "actor refresh" still sees
# fresh news after a month.
_DEFAULT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60


# --------------------------------------------------------------------------
# Result shape
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class DeepResearchResult:
    """One Deep Research run, ready to be persisted as a `CrawlRun` row.

    `cached=True` means the wrapper served from cache and never paid
    for a new run; in that case `cost_usd=0.0` and `interaction_id`
    points to the *original* run that populated the cache.
    """

    interaction_id: str
    tier: DeepResearchTier
    model: str
    status: str
    output_text: str
    error: str | None
    cached: bool
    cost_usd: float
    elapsed_seconds: float
    raw_usage: dict[str, int]


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    result: DeepResearchResult
    expires_at: float


class _InMemoryTTLCache:
    """LRU-bounded TTL cache. Per-process — fine for one crawler
    container. Replace with Redis-backed implementation in M49 when
    we go multi-replica."""

    def __init__(self, *, max_entries: int = 256) -> None:
        self._store: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._max_entries = max_entries

    def get(self, key: str) -> DeepResearchResult | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if entry.expires_at < time.time():
            self._store.pop(key, None)
            return None
        # Touch LRU position.
        self._store.move_to_end(key)
        # Mark as a cache hit on the way out.
        return DeepResearchResult(
            interaction_id=entry.result.interaction_id,
            tier=entry.result.tier,
            model=entry.result.model,
            status=entry.result.status,
            output_text=entry.result.output_text,
            error=entry.result.error,
            cached=True,
            cost_usd=0.0,
            elapsed_seconds=entry.result.elapsed_seconds,
            raw_usage=dict(entry.result.raw_usage),
        )

    def put(self, key: str, result: DeepResearchResult, *, ttl_seconds: float) -> None:
        self._store[key] = _CacheEntry(
            result=result,
            expires_at=time.time() + ttl_seconds,
        )
        self._store.move_to_end(key)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)

    def __len__(self) -> int:
        return len(self._store)


def _cache_key(
    *,
    prompt: str,
    surface: DeepResearchSurface,
    vision_slug: str,
    tier: DeepResearchTier,
    collaborative_planning: bool,
) -> str:
    payload = json.dumps(
        {
            "prompt": prompt,
            "surface": surface,
            "vision_slug": vision_slug,
            "tier": tier,
            "collaborative_planning": collaborative_planning,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# SDK surface — duck-typed so tests can inject a fake
# --------------------------------------------------------------------------


class _InteractionsProtocol(Protocol):
    """Subset of `google.genai.Client.interactions` we actually use.

    The real SDK exposes `create(...)` and `get(id)` returning an
    `Interaction` object with `.id`, `.status`, `.output_text`, `.error`.
    Both methods are synchronous in `google-genai` 0.20+; we run them
    via `asyncio.to_thread` to keep our wrapper non-blocking.
    """

    def create(self, **kwargs: Any) -> Any: ...

    def get(self, id: str) -> Any: ...  # noqa: A002


class _ClientProtocol(Protocol):
    @property
    def interactions(self) -> _InteractionsProtocol: ...


# --------------------------------------------------------------------------
# Wrapper
# --------------------------------------------------------------------------


@dataclass
class DeepResearchClient:
    """Centralized entry point for Deep Research runs across the
    crawler service. Inject a fake `_ClientProtocol` for tests; in
    production we construct it from `google.genai.Client()`.
    """

    genai_client: _ClientProtocol | None = None
    cost_meter: CostMeter | None = None
    cache: _InMemoryTTLCache | None = None
    cache_ttl_seconds: float = _DEFAULT_CACHE_TTL_SECONDS
    poll_interval_seconds: float = 10.0
    max_wait_seconds: float = 600.0

    # Populated in __post_init__.
    _ready_cost_meter: CostMeter = field(init=False)
    _ready_cache: _InMemoryTTLCache = field(init=False)

    def __post_init__(self) -> None:
        self._ready_cost_meter = self.cost_meter or CostMeter()
        self._ready_cache = self.cache or _InMemoryTTLCache()

    async def research(
        self,
        *,
        prompt: str,
        surface: DeepResearchSurface,
        vision_slug: str,
        tier: DeepResearchTier = "fast",
        collaborative_planning: bool = False,
    ) -> DeepResearchResult:
        """Run one Deep Research task. Returns when the interaction
        reaches a terminal state (`completed`, `failed`, `cancelled`)
        or we hit `max_wait_seconds`.

        Cached responses skip the API call entirely and return with
        `cached=True`, `cost_usd=0.0`.
        """
        if self.genai_client is None:
            raise RuntimeError(
                "DeepResearchClient: no genai_client wired. Construct with "
                "google.genai.Client() in production, or inject a fake for tests."
            )

        key = _cache_key(
            prompt=prompt,
            surface=surface,
            vision_slug=vision_slug,
            tier=tier,
            collaborative_planning=collaborative_planning,
        )
        hit = self._ready_cache.get(key)
        if hit is not None:
            return hit

        model = deep_research_model_for(tier)
        agent_config: dict[str, Any] = {
            "type": "deep-research",
            "thinking_summaries": "auto",
            "collaborative_planning": collaborative_planning,
        }

        started_at = time.monotonic()
        interaction = await asyncio.to_thread(
            self.genai_client.interactions.create,
            input=prompt,
            agent=model,
            background=True,
            agent_config=agent_config,
        )
        interaction_id: str = getattr(interaction, "id")

        # Poll until terminal status or timeout.
        deadline = started_at + self.max_wait_seconds
        while True:
            status = (getattr(interaction, "status", None) or "").lower()
            if status in {"completed", "failed", "cancelled"}:
                break
            if time.monotonic() > deadline:
                # Don't try to cancel here — the user can decide via
                # the cockpit. Return a synthetic timeout result.
                elapsed = time.monotonic() - started_at
                return DeepResearchResult(
                    interaction_id=interaction_id,
                    tier=tier,
                    model=model,
                    status="timeout",
                    output_text="",
                    error=f"polling exceeded {self.max_wait_seconds}s",
                    cached=False,
                    cost_usd=0.0,
                    elapsed_seconds=elapsed,
                    raw_usage={},
                )
            await asyncio.sleep(self.poll_interval_seconds)
            interaction = await asyncio.to_thread(
                self.genai_client.interactions.get, interaction_id
            )

        elapsed = time.monotonic() - started_at
        status = (getattr(interaction, "status", "") or "").lower()
        output_text: str = getattr(interaction, "output_text", "") or ""
        error: str | None = getattr(interaction, "error", None) or None
        raw_usage = self._extract_usage(interaction)

        cost_usd = 0.0
        if status == "completed":
            cost_usd = deep_research_price_usd(model)
            # Record on the shared meter so the admin cockpit's $/day
            # rollup includes Deep Research alongside opus/sonnet/haiku.
            self._ready_cost_meter.record(
                PricedUsage(
                    model=model,
                    input_tokens=0,
                    output_tokens=max(1, len(output_text) // 4),
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                    cost_usd=cost_usd,
                )
            )

        result = DeepResearchResult(
            interaction_id=interaction_id,
            tier=tier,
            model=model,
            status=status,
            output_text=output_text,
            error=error,
            cached=False,
            cost_usd=cost_usd,
            elapsed_seconds=elapsed,
            raw_usage=raw_usage,
        )
        if status == "completed":
            # Only cache successful runs — a failed run should be
            # re-attempted next tick.
            self._ready_cache.put(key, result, ttl_seconds=self.cache_ttl_seconds)
        return result

    @staticmethod
    def _extract_usage(interaction: Any) -> dict[str, int]:
        """Best-effort token-count extraction. The SDK may or may not
        surface a usage_metadata block on Interactions today; we treat
        its absence as zeros rather than failing."""
        usage = getattr(interaction, "usage_metadata", None)
        if usage is None:
            return {}
        out: dict[str, int] = {}
        for attr in ("prompt_token_count", "candidates_token_count", "thoughts_token_count"):
            value = getattr(usage, attr, None)
            if isinstance(value, int):
                out[attr] = value
        return out
