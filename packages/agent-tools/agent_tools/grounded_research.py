"""GroundedResearchClient — gemini + google_search grounding.

Replaces the legacy `DeepResearchClient` (which targeted the Vertex
`deep-research-*` Interactions API). Reasons for the swap:

  - The `deep-research-max-preview-04-2026` model returned 404 from
    Vertex (the preview slug is gone). Drop the whole preview lineage
    and use the supported `gemini-3.1-pro-preview` / `gemini-2.5-flash`
    families instead.
  - Grounded gemini returns in one round-trip (no `interactions.get`
    polling loop), so latency drops from minutes to seconds and the
    cockpit no longer needs the AbortSignal-timeout workaround.
  - The grounding tool exposes citation URLs alongside the synthesis
    text — we capture them in `GroundedResearchResult.citations` so
    downstream consumers (signal writer, digest) can render source
    chips with real URLs.

Two tiers, both selectable via env:

  - `fast` → `GROUNDED_MODEL_FAST` (default `gemini-2.5-flash`):
    grounded search, low thinking budget. Used by capability / actor /
    risk / signal fetchers.
  - `deep` / `max` → `GROUNDED_MODEL_DEEP` (default
    `gemini-3.1-pro-preview`): grounded search + `ThinkingConfig`
    HIGH. Used by the daily digest. `max` is accepted as a synonym
    for `deep` so the old `tier="max"` call sites keep working.

Cost is metered from `usage_metadata.prompt_token_count` +
`candidates_token_count` via the same `price_call()` helper the agent
LLMClient uses — no more flat per-run estimates.

API surface mirrors the legacy DR client one-for-one (`research(...)`
kwargs, result shape) so the migration is a name swap on the
downstream fetchers.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from agent_tools.cost import CostMeter, PricedUsage, price_call

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Tiers + surfaces — names preserved for downstream compatibility.
# `max` is a back-compat alias for `deep`.
# --------------------------------------------------------------------------


GroundedResearchTier = Literal["fast", "deep", "max"]
GroundedResearchSurface = Literal[
    "capability",
    "actor",
    "signal",
    "risk",
    "economics",
    "digest",
    "hello_world",
]


_DEFAULT_FAST_MODEL = "gemini-2.5-flash"
_DEFAULT_DEEP_MODEL = "gemini-3.1-pro-preview"
_DEFAULT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60


def grounded_model_for(tier: GroundedResearchTier) -> str:
    """Resolve the configured model id for `tier`. Env overrides:

      - GROUNDED_MODEL_DEEP  (deep / max tier)
      - GROUNDED_MODEL_FAST  (fast tier — also the fallback)
    """
    if tier in ("deep", "max"):
        return os.environ.get("GROUNDED_MODEL_DEEP", _DEFAULT_DEEP_MODEL)
    return os.environ.get("GROUNDED_MODEL_FAST", _DEFAULT_FAST_MODEL)


# --------------------------------------------------------------------------
# Result shape
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class GroundedCitation:
    """One web source the grounding tool retrieved. Captured for the
    UI source-chip strip + the signal row's source_url field."""

    url: str
    title: str


@dataclass(frozen=True)
class GroundedResearchResult:
    """One grounded research call, persisted as a `CrawlRun` row.

    Field names + types match the legacy `DeepResearchResult` so
    the swap doesn't ripple through every fetcher signature. The
    new `citations` tuple is optional; legacy code paths that don't
    read it ignore the field harmlessly.

    `cached=True` means we served from the in-memory TTL cache and
    didn't pay for a new call. `interaction_id` is now a synthetic
    UUID (no `interactions.create` anymore) but still serves as a
    unique handle per run for log correlation.
    """

    interaction_id: str
    tier: GroundedResearchTier
    model: str
    status: str  # "completed" | "error" | "empty"
    output_text: str
    error: str | None
    cached: bool
    cost_usd: float
    elapsed_seconds: float
    raw_usage: dict[str, int]
    citations: tuple[GroundedCitation, ...] = ()


# --------------------------------------------------------------------------
# Cache (carried over from DR client unchanged)
# --------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    result: GroundedResearchResult
    expires_at: float


class _InMemoryTTLCache:
    def __init__(self, *, max_entries: int = 256) -> None:
        self._store: OrderedDict[str, _CacheEntry] = OrderedDict()
        self._max_entries = max_entries

    def get(self, key: str) -> GroundedResearchResult | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if entry.expires_at < time.time():
            self._store.pop(key, None)
            return None
        self._store.move_to_end(key)
        return GroundedResearchResult(
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
            citations=entry.result.citations,
        )

    def put(
        self, key: str, result: GroundedResearchResult, *, ttl_seconds: float
    ) -> None:
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
    surface: GroundedResearchSurface,
    vision_slug: str,
    tier: GroundedResearchTier,
) -> str:
    payload = json.dumps(
        {
            "prompt": prompt,
            "surface": surface,
            "vision_slug": vision_slug,
            "tier": tier,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# SDK surface — duck-typed so tests can inject a stub
# --------------------------------------------------------------------------


class _ModelsProtocol(Protocol):
    """Subset of `google.genai.Client.models` we actually call.

    The real SDK signature is `generate_content(model=..., contents=...,
    config=...)` returning a response with `.text` and `.usage_metadata`
    (+ `.candidates[].grounding_metadata` when the grounding tool is on).
    `generate_content` is synchronous; we run it via `asyncio.to_thread`
    so the wrapper stays async.
    """

    def generate_content(
        self, *, model: str, contents: Any, config: Any
    ) -> Any: ...


class _ClientProtocol(Protocol):
    @property
    def models(self) -> _ModelsProtocol: ...


# --------------------------------------------------------------------------
# Wrapper
# --------------------------------------------------------------------------


@dataclass
class GroundedResearchClient:
    """Centralized entry point for grounded research across the data-
    pipeline service. Inject a fake `_ClientProtocol` for tests; in
    production we construct it from `google.genai.Client()`."""

    genai_client: _ClientProtocol | None = None
    cost_meter: CostMeter | None = None
    cache: _InMemoryTTLCache | None = None
    cache_ttl_seconds: float = _DEFAULT_CACHE_TTL_SECONDS

    # Kept for source-compat with code that constructed the old DR
    # client with these kwargs. Polling has no meaning now; the kwargs
    # are accepted and ignored.
    poll_interval_seconds: float = 0.0
    max_wait_seconds: float = 600.0

    _ready_cost_meter: CostMeter = field(init=False)
    _ready_cache: _InMemoryTTLCache = field(init=False)

    def __post_init__(self) -> None:
        self._ready_cost_meter = self.cost_meter or CostMeter()
        self._ready_cache = self.cache or _InMemoryTTLCache()

    async def research(
        self,
        *,
        prompt: str,
        surface: GroundedResearchSurface,
        vision_slug: str,
        tier: GroundedResearchTier = "fast",
        # Back-compat kwarg from the DR client signature — ignored here
        # (grounded gemini doesn't have a collaborative_planning mode).
        collaborative_planning: bool = False,  # noqa: ARG002
    ) -> GroundedResearchResult:
        """Run one grounded research call. Returns when the model
        finishes streaming (the SDK collects the full response). No
        polling loop, no `max_wait_seconds`.

        Cached results skip the API call and return with `cached=True`,
        `cost_usd=0.0`.
        """
        if self.genai_client is None:
            raise RuntimeError(
                "GroundedResearchClient: no genai_client wired. Construct "
                "with google.genai.Client(vertexai=True, ...) in prod, or "
                "inject a fake for tests."
            )

        key = _cache_key(
            prompt=prompt,
            surface=surface,
            vision_slug=vision_slug,
            tier=tier,
        )
        hit = self._ready_cache.get(key)
        if hit is not None:
            return hit

        model = grounded_model_for(tier)
        config = _build_generate_config(tier=tier)
        contents = _build_contents(prompt=prompt)

        started_at = time.monotonic()
        try:
            response = await asyncio.to_thread(
                self.genai_client.models.generate_content,
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:  # noqa: BLE001 — convert to structured result
            return _error_result(
                tier=tier,
                model=model,
                exc=exc,
                elapsed=time.monotonic() - started_at,
                step="models.generate_content",
            )

        elapsed = time.monotonic() - started_at
        output_text = _extract_text(response)
        citations = _extract_citations(response)
        raw_usage = _extract_usage(response)

        status = "completed" if output_text else "empty"
        cost_usd = 0.0
        if status == "completed":
            usage = price_call(
                model=model,
                input_tokens=raw_usage.get("prompt_token_count", 0),
                output_tokens=raw_usage.get("candidates_token_count", 0),
            )
            cost_usd = usage.cost_usd
            self._ready_cost_meter.record(usage)
        elif status == "empty":
            # Charge nothing for an empty response. Some callers prefer
            # to surface this as an error in the CrawlRun row; we leave
            # that decision to the caller via `status="empty"`.
            pass

        result = GroundedResearchResult(
            interaction_id=f"gr_{uuid.uuid4().hex[:24]}",
            tier=tier,
            model=model,
            status=status,
            output_text=output_text,
            error=None if status == "completed" else "model returned no text",
            cached=False,
            cost_usd=cost_usd,
            elapsed_seconds=elapsed,
            raw_usage=raw_usage,
            citations=citations,
        )
        if status == "completed":
            self._ready_cache.put(key, result, ttl_seconds=self.cache_ttl_seconds)
        return result


# --------------------------------------------------------------------------
# Config + response parsing helpers
# --------------------------------------------------------------------------


def _build_generate_config(*, tier: GroundedResearchTier) -> Any:
    """Build a `google.genai.types.GenerateContentConfig` with the
    google_search grounding tool and tier-appropriate ThinkingConfig.
    Imported lazily so the module can be imported in environments
    without the SDK (e.g., type-check-only test envs)."""
    from google.genai import types as gtypes  # noqa: PLC0415

    thinking_level = "HIGH" if tier in ("deep", "max") else "LOW"
    return gtypes.GenerateContentConfig(
        temperature=1.0,
        top_p=0.95,
        # Generous cap; the model stops naturally on EOS.
        max_output_tokens=65535,
        tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
        thinking_config=gtypes.ThinkingConfig(thinking_level=thinking_level),
        safety_settings=[
            gtypes.SafetySetting(category=cat, threshold="OFF")
            for cat in (
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_HARASSMENT",
            )
        ],
    )


def _build_contents(*, prompt: str) -> Any:
    from google.genai import types as gtypes  # noqa: PLC0415

    return [
        gtypes.Content(role="user", parts=[gtypes.Part(text=prompt)]),
    ]


def _extract_text(response: Any) -> str:
    """The SDK exposes `.text` as a convenience that concatenates every
    candidate's text parts. Fall back to walking candidates[0].parts
    if `.text` isn't present (e.g. response from a fake)."""
    text = getattr(response, "text", None)
    if isinstance(text, str) and text:
        return text
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ""
    content = getattr(candidates[0], "content", None)
    parts = getattr(content, "parts", None) or []
    pieces: list[str] = []
    for p in parts:
        t = getattr(p, "text", None)
        if isinstance(t, str):
            pieces.append(t)
    return "".join(pieces)


def _extract_citations(response: Any) -> tuple[GroundedCitation, ...]:
    """Pull (url, title) pairs out of the grounding metadata. The shape
    is `candidates[0].grounding_metadata.grounding_chunks[i].web.uri/title`.
    Defensive about missing intermediates — returns empty tuple if any
    leg of the path is absent."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ()
    meta = getattr(candidates[0], "grounding_metadata", None)
    chunks = getattr(meta, "grounding_chunks", None) or []
    out: list[GroundedCitation] = []
    for c in chunks:
        web = getattr(c, "web", None)
        if web is None:
            continue
        url = getattr(web, "uri", None) or getattr(web, "url", None)
        title = getattr(web, "title", None) or url
        if isinstance(url, str) and url:
            out.append(GroundedCitation(url=url, title=str(title)))
    return tuple(out)


def _extract_usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return {}
    out: dict[str, int] = {}
    for k in ("prompt_token_count", "candidates_token_count", "total_token_count"):
        v = getattr(usage, k, None)
        if isinstance(v, int):
            out[k] = v
    return out


def _error_result(
    *,
    tier: GroundedResearchTier,
    model: str,
    exc: Exception,
    elapsed: float,
    step: str,
    interaction_id: str = "",
) -> GroundedResearchResult:
    short = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
    log.error("grounded_research: %s failed (%s)", step, short)
    return GroundedResearchResult(
        interaction_id=interaction_id,
        tier=tier,
        model=model,
        status="error",
        output_text="",
        error=f"{type(exc).__name__} @ {step}: {short}",
        cached=False,
        cost_usd=0.0,
        elapsed_seconds=elapsed,
        raw_usage={},
    )


__all__ = [
    "GroundedCitation",
    "GroundedResearchClient",
    "GroundedResearchResult",
    "GroundedResearchSurface",
    "GroundedResearchTier",
    "grounded_model_for",
]
