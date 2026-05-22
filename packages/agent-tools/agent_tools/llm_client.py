"""Thin wrapper around the Google Gemini SDK (`google-genai`) with model
routing, cost tracking, and Pydantic-validated outputs.

History: this module wrapped Anthropic Claude through `LLMClient` until
M34 (2026-05-22). We swapped to Gemini because (a) Gemini 2.5 Pro is
roughly Sonnet-equivalent at a fraction of the cost, and (b) Anthropic's
prompt-caching trick we relied on is not the right primitive for our
workloads anyway (most prompts are <1 minute apart but rarely repeated).

Design decisions
----------------
- Model routing is by tier (`"haiku"` / `"sonnet"` / `"opus"`) rather
  than exact ID. The mapping table here is the only place to bump when
  models migrate. Tier names are unchanged from the Anthropic era — the
  semantic meaning ("cheap/fast", "balanced", "max-quality") carries
  over even though the underlying provider doesn't think in tiers.
- The wrapper's surface (`LLMClient.call(tier, system, user,
  max_tokens, response_model, adaptive_thinking, effort, ...)`) is
  preserved verbatim so every callsite (workflows, prediction.py,
  etc.) keeps working without edits. Per-call options that don't map
  to Gemini are accepted-and-ignored rather than rejected — keeps the
  blast radius of the swap small.
- `adaptive_thinking=True` enables Gemini's dynamic thinking budget
  (-1, "let the model decide"). False sets `thinking_budget=0` which
  disables the thinking pass and saves tokens.
- Structured output uses Gemini's native `response_schema` (the SDK
  validates against the Pydantic class and surfaces `.parsed`).
- Cost accounting reads `usage_metadata.{prompt,candidates,thoughts}_token_count`
  off the response. Thinking tokens are billed at the output rate.

What this file does NOT do (deliberately):
- Explicit context caching via `cachedContent`. The first-token savings
  rarely beat the upload cost for our workloads; revisit if a per-call
  static prefix grows past 32K tokens.
- Tool execution loop. The caller drives the loop; we just return.
- Retry/backoff. The SDK handles transient 429/5xx with backoff.
- Streaming. Added later if chat-style UX needs it.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from pydantic import BaseModel

try:  # Allow import without the optional dep present (tests using fakes
    # can still exercise the cost meter and tool defs).
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - exercised only in environments
    # without the google-genai dep.
    genai = None  # type: ignore[assignment]
    genai_types = None  # type: ignore[assignment]


ModelTier = Literal["haiku", "sonnet", "opus"]


# Single source of truth for tier → model ID. Update only when migrating.
# Gemini doesn't think in tiers, but we preserve the three-level concept
# so all callsites stay generic — `tier="opus"` still means "use the
# best model"; `tier="haiku"` still means "use the cheap one".
#
# Routing rationale (Gemini 3.x lineup, 2026-05):
# - Pro (3.1-pro-preview): best reasoning. Used by Decomposition,
#   EdgeInference, CodeGen, CodeReview workflows.
# - Flash (3-flash-preview): balanced. Used by Research,
#   DriverInference, the prediction.analyzeRationale tRPC.
# - Flash-Lite (3.1-flash-lite): cheapest. Reserved for high-volume
#   classification + extraction tasks (no current workflow uses it
#   yet, but it's the fallback when costs spike).
_MODEL_BY_TIER: dict[ModelTier, str] = {
    "haiku": "gemini-3.1-flash-lite",
    "sonnet": "gemini-3-flash-preview",
    "opus": "gemini-3.1-pro-preview",
}


def available_models() -> Mapping[ModelTier, str]:
    """Return the active tier → model-id mapping. Read-only snapshot."""
    return dict(_MODEL_BY_TIER)


# Effort hints retained for API compatibility (and so callers can keep
# threading them through), but Gemini doesn't have a direct "effort"
# parameter — the closest analog is `thinking_budget`. We translate
# in `_thinking_budget()` below.
_DEFAULT_EFFORT_BY_TIER: dict[ModelTier, str] = {
    "haiku": "medium",
    "sonnet": "medium",
    "opus": "high",
}


@dataclass(frozen=True)
class LLMCallResult:
    """Everything callers usually need from one LLM call. Field shape
    preserved across the Claude → Gemini swap."""

    model: str
    tier: ModelTier
    text: str
    """The concatenated text content of the response."""
    parsed: BaseModel | None
    """The Pydantic-validated structured output, when `response_model`
    was passed. None otherwise."""
    stop_reason: str | None
    raw_usage: dict[str, int]
    """Raw usage dict (`input_tokens`, `output_tokens`,
    `cache_creation_input_tokens`, `cache_read_input_tokens`). The
    two cache_* fields are 0 in Gemini-mode — kept for shape
    compatibility with the cost meter."""


T = TypeVar("T", bound=BaseModel)


class LLMClient:
    """Centralized entry point for every LLM call in the platform.

    The public `.call(...)` surface is unchanged from the Anthropic era —
    every workflow built against this client keeps working as-is after
    the Gemini swap.

    ```python
    # Free-form text
    result = client.call(
        tier="sonnet",
        system=SYSTEM_PROMPT,
        user="What's the area of a triangle with sides 3, 4, 5?",
    )

    # Pydantic-validated structured output
    class Decomposition(BaseModel):
        drivers: list[str]
        intermediates: list[str]
    result = client.call(
        tier="opus",
        system=DECOMP_SYSTEM,
        user=user_question,
        response_model=Decomposition,
    )
    assert isinstance(result.parsed, Decomposition)
    ```
    """

    def __init__(
        self,
        *,
        cost_meter: CostMeter | None = None,
        client: Any | None = None,
        api_key: str | None = None,
    ) -> None:
        from agent_tools.cost import CostMeter as _CostMeter

        if genai is None and client is None:  # pragma: no cover - import-time guard
            raise RuntimeError(
                "google-genai SDK not installed and no fake client supplied. "
                "Install `agent-tools` with the runtime extras, or pass "
                "`client=<fake>`."
            )

        if client is not None:
            self._client = client
        else:
            # Prefer GEMINI_API_KEY; fall back to GOOGLE_API_KEY for SDK
            # parity (google-genai reads either).
            key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get(
                "GOOGLE_API_KEY"
            )
            self._client = genai.Client(api_key=key)  # type: ignore[union-attr]
        self.cost_meter = cost_meter or _CostMeter()

    # ---- public helpers --------------------------------------------------

    def call(
        self,
        *,
        tier: ModelTier,
        system: str | list[str],
        user: str | list[dict[str, Any]],
        max_tokens: int = 4096,
        effort: str | None = None,
        adaptive_thinking: bool = False,
        cache_system: bool = True,
        tools: Iterable[dict[str, Any]] | None = None,
        response_model: type[T] | None = None,
        extra_messages: list[dict[str, Any]] | None = None,
    ) -> LLMCallResult:
        """Make one Gemini `generate_content` call.

        Args:
            tier: Routing knob — "haiku" / "sonnet" / "opus".
            system: System instruction. List joined with double newlines.
            user: Current user turn — string or content blocks. When a
                list of dicts, each item must have `role` + `content`.
            max_tokens: Hard cap on output.
            effort: Retained for API compatibility; translated into
                `thinking_budget` per tier.
            adaptive_thinking: Enable dynamic thinking budget (-1, "let
                the model decide"). Off by default — saves output tokens.
            cache_system: Retained for API compatibility; Gemini-mode
                ignores it (explicit context caching is opt-in via the
                `cachedContent` resource, not this knob).
            tools: Tool definitions. Currently passed through to Gemini
                as `tools=[...]` — coverage of the tool-execution loop
                lands in a later slice.
            response_model: Pydantic model. When set, requests JSON
                output with the schema attached; `.parsed` is populated.
            extra_messages: Optional prior turns to prepend.
        """
        from agent_tools.cost import price_call

        model = _MODEL_BY_TIER[tier]
        effort = effort or _DEFAULT_EFFORT_BY_TIER[tier]

        system_instruction = self._join_system(system)
        contents = self._render_messages(user=user, extra=extra_messages)
        thinking_budget = _thinking_budget(
            tier=tier, effort=effort, adaptive=adaptive_thinking
        )

        # Build the config dict. We pass dict (not GenerateContentConfig)
        # so fakes used in tests don't need to import google.genai.types —
        # the SDK accepts a dict alias for the config.
        config: dict[str, Any] = {
            "system_instruction": system_instruction,
            "max_output_tokens": max_tokens,
            "thinking_config": {"thinking_budget": thinking_budget},
        }
        if response_model is not None:
            config["response_mime_type"] = "application/json"
            config["response_schema"] = response_model
        if tools:
            config["tools"] = list(tools)

        request = {
            "model": model,
            "contents": contents,
            "config": config,
        }
        response = self._client.models.generate_content(**request)

        usage = self._extract_usage(response)
        priced = price_call(model=model, **usage)
        self.cost_meter.record(priced)

        text = self._extract_text(response)
        parsed = self._extract_parsed(response, response_model)
        stop_reason = self._extract_stop_reason(response)

        return LLMCallResult(
            model=model,
            tier=tier,
            text=text,
            parsed=parsed,
            stop_reason=stop_reason,
            raw_usage=usage,
        )

    # ---- internals -------------------------------------------------------

    @staticmethod
    def _join_system(system: str | list[str]) -> str:
        if isinstance(system, str):
            return system
        return "\n\n".join(s for s in system if s)

    @staticmethod
    def _render_messages(
        *,
        user: str | list[dict[str, Any]],
        extra: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        """Render to Gemini's `contents` shape.

        Gemini expects a list of `{role, parts: [{text}]}` entries with
        `role` ∈ {"user", "model"}. We accept the Anthropic-era
        {"role": "user"|"assistant", "content": "..."} shape and
        translate to keep callsites stable.
        """
        rendered: list[dict[str, Any]] = []
        if extra:
            for m in extra:
                role = m.get("role", "user")
                if role == "assistant":
                    role = "model"
                content = m.get("content", "")
                if isinstance(content, str):
                    parts: list[dict[str, Any]] = [{"text": content}]
                else:
                    # Assume already in {parts: [...]} shape.
                    parts = list(content)
                rendered.append({"role": role, "parts": parts})
        if isinstance(user, str):
            rendered.append({"role": "user", "parts": [{"text": user}]})
        else:
            rendered.append({"role": "user", "parts": list(user)})
        return rendered

    @staticmethod
    def _extract_text(response: Any) -> str:
        # SDK shortcut: `response.text` joins all text parts.
        text = getattr(response, "text", None)
        if isinstance(text, str):
            return text
        # Fall back to walking candidates → content → parts.
        parts: list[str] = []
        for cand in getattr(response, "candidates", []) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", []) or []:
                t = getattr(part, "text", None)
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)

    @staticmethod
    def _extract_parsed(response: Any, response_model: type[T] | None) -> BaseModel | None:
        if response_model is None:
            return None
        # `response.parsed` is the SDK's structured-output accessor.
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, BaseModel):
            return parsed
        # Some fake test responses set `parsed_output` (Anthropic-era
        # name); honor it for cross-fixture compatibility.
        legacy = getattr(response, "parsed_output", None)
        if isinstance(legacy, BaseModel):
            return legacy
        # Final fallback: parse JSON ourselves.
        if isinstance(parsed, dict):
            return response_model.model_validate(parsed)
        return None

    @staticmethod
    def _extract_stop_reason(response: Any) -> str | None:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return None
        fr = getattr(candidates[0], "finish_reason", None)
        if fr is None:
            return None
        # Gemini's finish_reason is an enum; coerce to its string name
        # for callers that just want a debug label.
        return getattr(fr, "name", str(fr))

    @staticmethod
    def _extract_usage(response: Any) -> dict[str, int]:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            }
        # Gemini reports candidates_token_count for the answer and
        # thoughts_token_count for the thinking pass; combine into
        # output_tokens since both bill at the same rate.
        candidate_tokens = int(getattr(meta, "candidates_token_count", 0) or 0)
        thoughts_tokens = int(getattr(meta, "thoughts_token_count", 0) or 0)
        cached = int(getattr(meta, "cached_content_token_count", 0) or 0)
        prompt = int(getattr(meta, "prompt_token_count", 0) or 0)
        # Subtract cached from prompt so cache_read isn't double-counted.
        return {
            "input_tokens": max(prompt - cached, 0),
            "output_tokens": candidate_tokens + thoughts_tokens,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": cached,
        }


def _thinking_budget(
    *, tier: ModelTier, effort: str, adaptive: bool
) -> int:
    """Map (tier, effort, adaptive) → Gemini's thinking_budget int.

    `-1` is the SDK's "let the model decide" sentinel; `0` disables
    thinking entirely. Anything in between is a hard cap on thinking
    tokens.

    The translation is intentionally conservative — overthinking is the
    main failure mode for these models, so we only opt into a big
    budget when the caller explicitly asked for adaptive_thinking.
    """
    if adaptive:
        return -1
    # Without adaptive, derive a small fixed budget from effort.
    # Flash-lite (haiku) supports thinking_budget=0; flash + pro
    # require a positive integer when thinking is on.
    if tier == "haiku":
        return 0
    if effort == "high":
        return 4096
    if effort == "low":
        return 512
    return 1024


# Re-export so package consumers don't have to import from `cost`
# separately when they just want `CostMeter`.
from agent_tools.cost import CostMeter  # noqa: E402  - circular-friendly re-export
