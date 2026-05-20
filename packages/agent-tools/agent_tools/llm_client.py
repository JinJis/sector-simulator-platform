"""Thin wrapper around the Anthropic SDK with model routing, prompt caching,
cost tracking, and Pydantic-validated outputs.

Design decisions
----------------
- Model routing is by tier (`"haiku"` / `"sonnet"` / `"opus"`) rather than
  by exact ID. The mapping table here is the only place to bump when models
  migrate.
- Static prefix lives in `system` and is automatically marked with
  `cache_control: ephemeral`. Volatile context belongs in `messages`. This
  matches the prefix-match invariant of prompt caching.
- Opus 4.7 does not accept `temperature`/`top_p`/`top_k`/`budget_tokens`;
  Sonnet 4.6 supports adaptive thinking. The client only ever sets adaptive
  thinking and `effort`, never the removed parameters. Older models would
  need different parameters — this wrapper is intentionally 4.6+ only.
- Structured output is via `messages.parse(...)` with a Pydantic model when
  the caller passes `response_model`. Otherwise we return the raw text.
- We capture cache hits via `response.usage.cache_read_input_tokens` and
  price each call into the `CostMeter`.

What this file does NOT do (deliberately):
- Tool execution loop (the consumer drives the loop; we just return what
  the API returned).
- Retry/backoff — the SDK already retries 429/5xx with backoff.
- Streaming — added in a later slice when chat-style UX needs it.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from pydantic import BaseModel

try:  # Allow import without the optional dep present (tests using fakes can
    # still exercise the cost meter and tool defs).
    import anthropic
    from anthropic import Anthropic
except ImportError:  # pragma: no cover - exercised only in environments
    # without the anthropic dep.
    anthropic = None  # type: ignore[assignment]
    Anthropic = object  # type: ignore[misc,assignment]


ModelTier = Literal["haiku", "sonnet", "opus"]


# Single source of truth for tier → model ID. Update only when migrating.
# `claude-api` skill / shared/models.md is the upstream reference.
_MODEL_BY_TIER: dict[ModelTier, str] = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-7",
}


def available_models() -> Mapping[ModelTier, str]:
    """Return the active tier → model-id mapping. Read-only snapshot."""
    return dict(_MODEL_BY_TIER)


# Effort levels supported per tier. Opus 4.7 supports "xhigh"/"max"; Sonnet
# and Haiku top out at "high". Keep this conservative — we use Sonnet's
# ceiling everywhere except Opus calls that opt in.
_DEFAULT_EFFORT_BY_TIER: dict[ModelTier, str] = {
    "haiku": "medium",
    "sonnet": "medium",
    "opus": "high",
}


@dataclass(frozen=True)
class LLMCallResult:
    """Everything callers usually need from one Claude API call."""

    model: str
    tier: ModelTier
    text: str
    """The concatenated text content of the response (skips thinking blocks)."""
    parsed: BaseModel | None
    """The Pydantic-validated structured output, when `response_model` was
    passed. None otherwise."""
    stop_reason: str | None
    raw_usage: dict[str, int]
    """Raw usage dict from the API (`input_tokens`, `output_tokens`,
    `cache_creation_input_tokens`, `cache_read_input_tokens`)."""


T = TypeVar("T", bound=BaseModel)


class LLMClient:
    """Centralized entry point for every LLM call in the platform.

    Two usage patterns:

    ```python
    # Free-form text
    result = client.call(
        tier="sonnet",
        system=SYSTEM_PROMPT,        # large, cacheable
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

    The system prompt is rendered with `cache_control: ephemeral` on its
    last block. If you split it into multiple text chunks, only the last
    is marked — that's fine; the prefix match covers the earlier ones.
    """

    def __init__(
        self,
        *,
        cost_meter: CostMeter | None = None,
        client: Anthropic | None = None,
        api_key: str | None = None,
    ) -> None:
        from agent_tools.cost import CostMeter as _CostMeter

        if anthropic is None and client is None:  # pragma: no cover - import-time guard
            raise RuntimeError(
                "anthropic SDK not installed and no fake client supplied. "
                "Install `agent-tools` with extras, or pass `client=<fake>`."
            )

        if client is not None:
            self._client = client
        else:
            self._client = Anthropic(  # type: ignore[call-arg]
                api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"),
            )
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
        """Make one Messages API call.

        Args:
            tier: Routing knob — "haiku" / "sonnet" / "opus".
            system: Static system prompt. If a list, blocks render in order
                with cache_control on the last one (when `cache_system`).
            user: The current user turn. Plain string or content blocks.
            max_tokens: Hard cap on output. Stay ≤ 8K unless you stream.
            effort: Override per-tier default. Use "low" / "medium" / "high"
                everywhere; "xhigh" / "max" only on Opus.
            adaptive_thinking: Enable `thinking: {type: "adaptive"}`. Off
                by default — adds latency, only worth it for harder tasks.
            cache_system: Mark the last system block with cache_control.
                Disable only when the prefix is below the cacheable minimum
                (mostly tiny test prompts).
            tools: Tool definitions in Anthropic JSON schema form.
            response_model: Pydantic model to validate against. When set,
                the call uses `messages.parse(...)` with structured-output
                JSON schema and `.parsed` is populated.
            extra_messages: Optional prior turns to prepend to the `user`
                turn. Useful for few-shot or carrying agent state.
        """
        from agent_tools.cost import price_call

        model = _MODEL_BY_TIER[tier]
        effort = effort or _DEFAULT_EFFORT_BY_TIER[tier]

        system_blocks = self._render_system(system, cache=cache_system)
        messages = self._render_messages(user=user, extra=extra_messages)

        request: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_blocks,
            "messages": messages,
            "output_config": {"effort": effort},
        }
        if adaptive_thinking:
            request["thinking"] = {"type": "adaptive"}
        if tools:
            request["tools"] = list(tools)

        if response_model is not None:
            # `messages.parse` validates the response against the supplied
            # Pydantic model. The SDK sets output_config.format under the
            # hood when you pass `output_format`; we pass it explicitly so
            # the request shape is visible here.
            request["output_format"] = response_model
            response = self._client.messages.parse(**request)
        else:
            response = self._client.messages.create(**request)

        usage = self._extract_usage(response)
        priced = price_call(model=model, **usage)
        self.cost_meter.record(priced)

        text = self._extract_text(response)
        parsed = getattr(response, "parsed_output", None) if response_model else None

        return LLMCallResult(
            model=model,
            tier=tier,
            text=text,
            parsed=parsed,
            stop_reason=getattr(response, "stop_reason", None),
            raw_usage=usage,
        )

    # ---- internals -------------------------------------------------------

    @staticmethod
    def _render_system(system: str | list[str], *, cache: bool) -> list[dict[str, Any]]:
        chunks: list[str]
        if isinstance(system, str):
            chunks = [system]
        else:
            chunks = list(system)
        if not chunks:
            return []
        blocks: list[dict[str, Any]] = [
            {"type": "text", "text": chunk} for chunk in chunks
        ]
        if cache:
            # Mark the last block — caches the whole rendered prefix
            # (tools + earlier system blocks + this one).
            blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    @staticmethod
    def _render_messages(
        *,
        user: str | list[dict[str, Any]],
        extra: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        prior = list(extra) if extra else []
        if isinstance(user, str):
            current = {"role": "user", "content": user}
        else:
            current = {"role": "user", "content": user}
        return [*prior, current]

    @staticmethod
    def _extract_text(response: Any) -> str:
        parts: list[str] = []
        for block in getattr(response, "content", []):
            kind = getattr(block, "type", None)
            if kind == "text":
                parts.append(getattr(block, "text", ""))
        return "".join(parts)

    @staticmethod
    def _extract_usage(response: Any) -> dict[str, int]:
        usage = getattr(response, "usage", None)
        return {
            "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
            "cache_creation_input_tokens": int(
                getattr(usage, "cache_creation_input_tokens", 0) or 0
            ),
            "cache_read_input_tokens": int(
                getattr(usage, "cache_read_input_tokens", 0) or 0
            ),
        }


# Re-export so package consumers don't have to import from `cost` separately
# when they just want `CostMeter`.
from agent_tools.cost import CostMeter  # noqa: E402  - circular-friendly re-export
