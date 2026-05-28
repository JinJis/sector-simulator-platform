"""Thin wrapper around two LLM providers — Anthropic Claude (via
AnthropicVertex) for the opus tier, Google Gemini (via `google-genai`)
for sonnet + haiku — with model routing, cost tracking, and
Pydantic-validated outputs.

History:
- pre-M34: wrapped Anthropic Claude (single provider).
- M34 (2026-05-22): swapped entirely to Gemini via Google AI Studio API
  key.
- M34b (2026-05-22): swapped auth to Vertex AI via ADC (service-account
  JSON), still Gemini-only.
- M35 (2026-05-22): brought Claude back for the opus tier. Both
  providers now authenticate against the same Vertex AI service-account
  JSON; both run in the `global` multi-region. Tier mapping:
    - opus  → claude-opus-4-7      (AnthropicVertex, region="global")
    - sonnet → gemini-3.5-flash     (google-genai,    location="global")
    - haiku  → gemini-3.5-flash-lite (google-genai,    location="global")

Design decisions
----------------
- Routing is by tier (`"haiku"` / `"sonnet"` / `"opus"`). The dispatch
  table here is the only place to bump when the mapping changes; every
  callsite stays generic.
- `LLMClient.call(...)` surface (tier, system, user, max_tokens,
  response_model, adaptive_thinking, effort, tools, extra_messages,
  cache_system) is preserved verbatim across the swap.
- Structured output:
    - Gemini path: native `response_schema` (the SDK validates against
      the Pydantic class and surfaces `.parsed`).
    - Anthropic path: tool-use trick — register a single tool whose
      `input_schema` is the Pydantic JSON Schema, force `tool_choice`,
      and extract the validated dict from the `tool_use` block.
- `adaptive_thinking=True` enables Gemini's dynamic thinking budget
  (-1 sentinel). False sets `thinking_budget=0` for haiku and a small
  fixed cap for sonnet, saving output tokens. The flag is a no-op on
  the Anthropic path today; we can wire it to Claude's extended
  thinking later if needed.
- Cost accounting is provider-specific in how it extracts usage but
  unified through the shared `price_call` + `CostMeter`.

What this file does NOT do (deliberately):
- Explicit context caching for Gemini (`cachedContent` resource).
- Anthropic extended thinking opt-in.
- Tool execution loop. Callers drive the loop.
- Retry/backoff (SDKs handle transient 429/5xx).
- Streaming.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ValidationError

try:  # Allow import without the optional dep present (tests using fakes
    # can still exercise the cost meter and tool defs).
    from google import genai
except ImportError:  # pragma: no cover - exercised only in environments
    # without the google-genai dep.
    genai = None  # type: ignore[assignment]

try:
    from anthropic import AnthropicVertex
except ImportError:  # pragma: no cover - same story for Anthropic SDK
    AnthropicVertex = None  # type: ignore[assignment]


ModelTier = Literal["haiku", "sonnet", "opus"]


# Defaults — env vars below override per tier so model rolls don't need
# a code change. Update the defaults only when migrating the base lineup.
# - opus  → Claude (best reasoning; routed via AnthropicVertex).
# - sonnet / haiku → Gemini 3.5 flash family (cheap & fast).
_DEFAULT_MODEL_BY_TIER: dict[ModelTier, str] = {
    "haiku": "gemini-3.5-flash-lite",
    "sonnet": "gemini-3.5-flash",
    "opus": "claude-opus-4-7",
}

# Env var that overrides each tier's model id. Read at call time, not
# import time, so tests can monkeypatch + container restarts pick up new
# values without a wheel rebuild.
_MODEL_ENV_BY_TIER: dict[ModelTier, str] = {
    "haiku": "LLM_HAIKU_MODEL",
    "sonnet": "LLM_SONNET_MODEL",
    "opus": "LLM_OPUS_MODEL",
}


def model_for_tier(tier: ModelTier) -> str:
    """Resolve the active model id for `tier`. Order of precedence:
    env (`LLM_{TIER}_MODEL`) → built-in default."""
    env_key = _MODEL_ENV_BY_TIER[tier]
    return os.environ.get(env_key) or _DEFAULT_MODEL_BY_TIER[tier]


def available_models() -> Mapping[ModelTier, str]:
    """Return the currently-active tier → model-id mapping (env-resolved)."""
    return {tier: model_for_tier(tier) for tier in _DEFAULT_MODEL_BY_TIER}


def _is_anthropic_tier(tier: ModelTier) -> bool:
    """True when the tier routes to the Anthropic provider."""
    return tier == "opus"


# Effort hints retained for API compatibility; Gemini-only. The
# Anthropic path ignores the value today (Claude doesn't expose a
# matching knob).
_DEFAULT_EFFORT_BY_TIER: dict[ModelTier, str] = {
    "haiku": "medium",
    "sonnet": "medium",
    "opus": "high",
}


@dataclass(frozen=True)
class LLMCallResult:
    """Everything callers usually need from one LLM call. Field shape
    preserved across the Claude → Gemini → dual-provider swaps."""

    model: str
    tier: ModelTier
    text: str
    """The concatenated text content of the response."""
    parsed: BaseModel | None
    """The Pydantic-validated structured output, when `response_model`
    was passed. None otherwise."""
    stop_reason: str | None
    raw_usage: dict[str, int]
    """Raw usage dict with keys: input_tokens, output_tokens,
    cache_creation_input_tokens, cache_read_input_tokens. Cache fields
    are 0 on the Gemini path (we don't use `cachedContent` today) but
    populated on the Anthropic path."""


T = TypeVar("T", bound=BaseModel)


# Scopes required for the SA to authenticate against Vertex AI.
# `cloud-platform` covers both `aiplatform.googleapis.com` (Gemini +
# Claude on Vertex Model Garden); `generative-language` is harmless
# extra coverage for the Google AI Studio path if we ever toggle back.
_VERTEX_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language",
]


class LLMClient:
    """Centralized entry point for every LLM call in the platform.

    ```python
    # Free-form text
    result = client.call(
        tier="sonnet",
        system=SYSTEM_PROMPT,
        user="What's the area of a triangle with sides 3, 4, 5?",
    )

    # Pydantic-validated structured output (routes to Claude opus)
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

    Construction:
    - `LLMClient()` — pick up both clients from env (Vertex AI SA JSON
      + GOOGLE_CLOUD_LOCATION). Production path.
    - `LLMClient(genai_client=fake_g, anthropic_client=fake_a)` —
      inject fakes for tests. Either may be None when the test only
      exercises one provider.
    - `LLMClient(client=fake_g)` — backwards-compat alias for
      `genai_client=`. Kept so the (many) pre-M35 test fixtures keep
      compiling; they all faked the Gemini path.
    """

    def __init__(
        self,
        *,
        cost_meter: CostMeter | None = None,
        client: Any | None = None,
        genai_client: Any | None = None,
        anthropic_client: Any | None = None,
        api_key: str | None = None,
    ) -> None:
        from agent_tools.cost import CostMeter as _CostMeter

        # Backwards-compat: pre-M35 fixtures pass `client=` and assume
        # it's the Gemini provider.
        if client is not None and genai_client is None:
            genai_client = client

        if genai_client is None and anthropic_client is None:
            built_g, built_a = _build_default_clients(api_key=api_key)
            genai_client = built_g
            anthropic_client = built_a

        if genai_client is None and anthropic_client is None:
            # Both SDKs absent and no fakes — refuse to construct rather
            # than crashing later on `.call()`.
            raise RuntimeError(
                "LLMClient: no provider configured. Set "
                "GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_APPLICATION_CREDENTIALS "
                "(production), or inject a fake via genai_client= / "
                "anthropic_client= for tests."
            )

        self._genai = genai_client
        self._anthropic = anthropic_client
        self.cost_meter = cost_meter or _CostMeter()

    # ---- internal accessors -------------------------------------------------
    #
    # `workflows.py` (and a couple of test helpers) reach into `_client`
    # to rebind a fresh LLMClient onto a per-workflow cost meter. Keep
    # the attr as an alias for the Gemini client to avoid breaking that
    # pattern; new code should call `.clone()` instead.

    @property
    def _client(self) -> Any:
        return self._genai

    def clone(self, *, cost_meter: CostMeter | None = None) -> LLMClient:
        """Return a new LLMClient sharing the same underlying providers
        but with a fresh (or supplied) cost meter. Used by per-workflow
        wrappers to scope cost to a single run without touching the
        shared client."""
        return LLMClient(
            genai_client=self._genai,
            anthropic_client=self._anthropic,
            cost_meter=cost_meter,
        )

    # ---- public surface -----------------------------------------------------

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
        """Make one LLM call.

        Routing: `tier="opus"` dispatches to AnthropicVertex; everything
        else dispatches to google-genai. The surface is identical for
        both — the only knob that differs in behavior is
        `adaptive_thinking`, which controls Gemini's `thinking_budget`
        and is ignored on the Anthropic path.
        """
        model = model_for_tier(tier)
        effort = effort or _DEFAULT_EFFORT_BY_TIER[tier]

        if _is_anthropic_tier(tier):
            return self._call_anthropic(
                tier=tier,
                model=model,
                system=system,
                user=user,
                max_tokens=max_tokens,
                adaptive_thinking=adaptive_thinking,
                tools=tools,
                response_model=response_model,
                extra_messages=extra_messages,
            )
        return self._call_gemini(
            tier=tier,
            model=model,
            system=system,
            user=user,
            max_tokens=max_tokens,
            effort=effort,
            adaptive_thinking=adaptive_thinking,
            tools=tools,
            response_model=response_model,
            extra_messages=extra_messages,
        )

    # ---- Anthropic provider -------------------------------------------------

    def _call_anthropic(
        self,
        *,
        tier: ModelTier,
        model: str,
        system: str | list[str],
        user: str | list[dict[str, Any]],
        max_tokens: int,
        adaptive_thinking: bool,
        tools: Iterable[dict[str, Any]] | None,
        response_model: type[T] | None,
        extra_messages: list[dict[str, Any]] | None,
    ) -> LLMCallResult:
        from agent_tools.cost import price_call

        if self._anthropic is None:
            raise RuntimeError(
                f"tier={tier} routes to {model} (Anthropic) but no "
                "AnthropicVertex client is configured. Install "
                "`anthropic[vertex]` and set GOOGLE_GENAI_USE_VERTEXAI=true "
                "+ GOOGLE_APPLICATION_CREDENTIALS."
            )

        system_text = self._join_system(system)
        messages = self._render_anthropic_messages(user=user, extra=extra_messages)

        # Structured output: tool-use trick. Register the response model
        # as a single tool, force the model to call it, then read the
        # validated input dict back out.
        api_tools: list[dict[str, Any]] | None = None
        tool_choice: dict[str, Any] | None = None
        schema_name: str | None = None
        if response_model is not None:
            schema_name = self._schema_tool_name(response_model)
            api_tools = [{
                "name": schema_name,
                "description": (response_model.__doc__ or schema_name).strip(),
                "input_schema": response_model.model_json_schema(),
            }]
            tool_choice = {"type": "tool", "name": schema_name}
        elif tools:
            api_tools = list(tools)

        request: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_text,
            "messages": messages,
        }
        if api_tools is not None:
            request["tools"] = api_tools
        if tool_choice is not None:
            request["tool_choice"] = tool_choice
        # `adaptive_thinking=True` on opus → Claude extended thinking with a
        # reasonable token budget. Matches the semantic of Gemini's "let the
        # model decide" budget; the model spends extra output tokens
        # reasoning before answering. Caller-tunable cap so a runaway
        # thinking phase can't blow past max_tokens.
        #
        # BUT: Anthropic rejects `thinking` when `tool_choice` forces a
        # specific tool — "Thinking may not be enabled when tool_choice
        # forces tool use." All our structured-output calls force a tool,
        # so when `response_model` is set we silently drop thinking.
        # Structured output is the harder constraint (downstream code
        # asserts `result.parsed is not None`); thinking is a quality
        # boost the model loses without breaking the call. Workflows
        # that need BOTH would have to switch to the unstructured path
        # or use interleaved-thinking beta — deferred until needed.
        if adaptive_thinking and tool_choice is None:
            request["thinking"] = {
                "type": "enabled",
                "budget_tokens": max(min(max_tokens // 2, 8192), 1024),
            }

        response = self._anthropic.messages.create(**request)

        usage = self._extract_anthropic_usage(response)
        priced = price_call(model=model, **usage)
        self.cost_meter.record(priced)

        text, parsed = self._extract_anthropic_content(
            response, response_model=response_model, schema_name=schema_name
        )
        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason is not None and not isinstance(stop_reason, str):
            stop_reason = str(stop_reason)

        return LLMCallResult(
            model=model,
            tier=tier,
            text=text,
            parsed=parsed,
            stop_reason=stop_reason,
            raw_usage=usage,
        )

    @staticmethod
    def _schema_tool_name(model: type[BaseModel]) -> str:
        """Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`. Pydantic
        class names already conform but sanitize defensively in case a
        future schema sneaks in a dot or space."""
        raw = model.__name__
        clean = "".join(c if c.isalnum() or c in "-_" else "_" for c in raw)
        return clean[:64] or "structured_output"

    @staticmethod
    def _render_anthropic_messages(
        *,
        user: str | list[dict[str, Any]],
        extra: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        """Render to Anthropic's `messages` shape. Roles are
        "user" / "assistant" (Gemini-era "model" gets translated back)."""
        msgs: list[dict[str, Any]] = []
        if extra:
            for m in extra:
                role = m.get("role", "user")
                if role == "model":
                    role = "assistant"
                content = m.get("content", "")
                msgs.append({"role": role, "content": content})
        if isinstance(user, str):
            msgs.append({"role": "user", "content": user})
        else:
            msgs.append({"role": "user", "content": list(user)})
        return msgs

    @staticmethod
    def _extract_anthropic_content(
        response: Any,
        *,
        response_model: type[T] | None,
        schema_name: str | None,
    ) -> tuple[str, BaseModel | None]:
        """Walk `response.content` blocks. Concatenate `text` blocks for
        the free-form text return; pick the matching `tool_use` block
        for the structured-output return."""
        text_parts: list[str] = []
        parsed: BaseModel | None = None
        for block in getattr(response, "content", []) or []:
            btype = getattr(block, "type", None)
            if btype == "text":
                t = getattr(block, "text", "")
                if isinstance(t, str):
                    text_parts.append(t)
            elif btype == "tool_use" and response_model is not None:
                if schema_name is None or getattr(block, "name", "") == schema_name:
                    raw = getattr(block, "input", None)
                    if isinstance(raw, dict):
                        try:
                            parsed = response_model.model_validate(raw)
                        except ValidationError as exc:
                            # Most common cause: the model hit max_tokens
                            # and Anthropic returned the partial tool_use
                            # input. Trying to parse a half-truncated JSON
                            # object against a strict Pydantic schema
                            # surfaces as "Field required" on the trailing
                            # fields. Don't let that crash the call —
                            # leave parsed=None so the caller can inspect
                            # `stop_reason == "max_tokens"` and produce a
                            # useful error message.
                            sys.stderr.write(
                                f"llm_client: response_model validation "
                                f"failed (model={schema_name!r}, "
                                f"errors={exc.error_count()}); returning "
                                f"parsed=None\n"
                            )
                            parsed = None
        return "".join(text_parts), parsed

    @staticmethod
    def _extract_anthropic_usage(response: Any) -> dict[str, int]:
        """Pull the standard usage dict off an Anthropic response. Unlike
        Gemini, Anthropic already reports `input_tokens` excluding
        cache-read tokens, so no subtraction needed."""
        usage = getattr(response, "usage", None)
        if usage is None:
            return {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            }
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

    # ---- Gemini provider ----------------------------------------------------

    def _call_gemini(
        self,
        *,
        tier: ModelTier,
        model: str,
        system: str | list[str],
        user: str | list[dict[str, Any]],
        max_tokens: int,
        effort: str,
        adaptive_thinking: bool,
        tools: Iterable[dict[str, Any]] | None,
        response_model: type[T] | None,
        extra_messages: list[dict[str, Any]] | None,
    ) -> LLMCallResult:
        from agent_tools.cost import price_call

        if self._genai is None:
            raise RuntimeError(
                f"tier={tier} routes to {model} (Gemini) but no "
                "google-genai client is configured."
            )

        system_instruction = self._join_system(system)
        contents = self._render_gemini_messages(user=user, extra=extra_messages)
        thinking_budget = _thinking_budget(
            tier=tier, effort=effort, adaptive=adaptive_thinking
        )

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

        response = self._genai.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        usage = self._extract_gemini_usage(response)
        priced = price_call(model=model, **usage)
        self.cost_meter.record(priced)

        text = self._extract_gemini_text(response)
        parsed = self._extract_gemini_parsed(response, response_model)
        stop_reason = self._extract_gemini_stop_reason(response)

        return LLMCallResult(
            model=model,
            tier=tier,
            text=text,
            parsed=parsed,
            stop_reason=stop_reason,
            raw_usage=usage,
        )

    # ---- shared helpers -----------------------------------------------------

    @staticmethod
    def _join_system(system: str | list[str]) -> str:
        if isinstance(system, str):
            return system
        return "\n\n".join(s for s in system if s)

    @staticmethod
    def _render_gemini_messages(
        *,
        user: str | list[dict[str, Any]],
        extra: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        """Render to Gemini's `contents` shape (`{role, parts: [{text}]}`
        with role ∈ {"user", "model"})."""
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
                    parts = list(content)
                rendered.append({"role": role, "parts": parts})
        if isinstance(user, str):
            rendered.append({"role": "user", "parts": [{"text": user}]})
        else:
            rendered.append({"role": "user", "parts": list(user)})
        return rendered

    @staticmethod
    def _extract_gemini_text(response: Any) -> str:
        text = getattr(response, "text", None)
        if isinstance(text, str):
            return text
        parts: list[str] = []
        for cand in getattr(response, "candidates", []) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", []) or []:
                t = getattr(part, "text", None)
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)

    @staticmethod
    def _extract_gemini_parsed(response: Any, response_model: type[T] | None) -> BaseModel | None:
        if response_model is None:
            return None
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, BaseModel):
            return parsed
        legacy = getattr(response, "parsed_output", None)
        if isinstance(legacy, BaseModel):
            return legacy
        if isinstance(parsed, dict):
            return response_model.model_validate(parsed)
        return None

    @staticmethod
    def _extract_gemini_stop_reason(response: Any) -> str | None:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return None
        fr = getattr(candidates[0], "finish_reason", None)
        if fr is None:
            return None
        return getattr(fr, "name", str(fr))

    @staticmethod
    def _extract_gemini_usage(response: Any) -> dict[str, int]:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            }
        candidate_tokens = int(getattr(meta, "candidates_token_count", 0) or 0)
        thoughts_tokens = int(getattr(meta, "thoughts_token_count", 0) or 0)
        cached = int(getattr(meta, "cached_content_token_count", 0) or 0)
        prompt = int(getattr(meta, "prompt_token_count", 0) or 0)
        return {
            "input_tokens": max(prompt - cached, 0),
            "output_tokens": candidate_tokens + thoughts_tokens,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": cached,
        }


def _truthy(val: str | None) -> bool:
    return (val or "").strip().lower() in {"1", "true", "yes", "on"}


def _read_sa_project_id(creds_path: str) -> str | None:
    """Extract `project_id` from a service-account JSON key. Returns None
    if the file is unreadable or doesn't contain the field — the caller
    decides whether that's fatal."""
    try:
        with open(creds_path) as fh:
            info = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    pid = info.get("project_id")
    return pid if isinstance(pid, str) and pid else None


def _build_default_clients(*, api_key: str | None) -> tuple[Any | None, Any | None]:
    """Construct (genai_client, anthropic_client) from environment.

    Production path: Vertex AI for both. Service-account JSON at
    ``GOOGLE_APPLICATION_CREDENTIALS`` authenticates both SDKs;
    ``GOOGLE_CLOUD_LOCATION`` (default ``global``) picks the region.
    The project id is read from the SA JSON itself (matches the
    user-provided example) and overridden by ``GOOGLE_CLOUD_PROJECT``
    when explicitly set.

    Dev fallback (no Vertex): a ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY``
    builds a Gemini-only client; opus calls will then error at runtime
    with a clear message. Use this path only when you don't have GCP
    access — Anthropic models aren't reachable here.
    """
    # `os.environ.get(key, default)` only returns the default when the key
    # is missing — an empty string from `${VAR:-}` interpolation in compose
    # slips through and would otherwise let the SDK fall back to its own
    # baked-in default (us-central1 for Vertex AI). Coerce empty → "global".
    location = (os.environ.get("GOOGLE_CLOUD_LOCATION") or "").strip() or "global"
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project_id and creds_path and os.path.exists(creds_path):
        project_id = _read_sa_project_id(creds_path)

    use_vertex = _truthy(os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"))

    genai_client: Any | None = None
    anthropic_client: Any | None = None

    if use_vertex:
        if not project_id:
            raise RuntimeError(
                "Vertex AI mode requires either GOOGLE_CLOUD_PROJECT to be set "
                "explicitly, or GOOGLE_APPLICATION_CREDENTIALS to point at a "
                "service-account JSON containing a `project_id` field."
            )
        # One-line startup log so `docker compose logs agent-orchestration | head`
        # immediately shows which region the providers actually got. The error
        # path "Publisher Model ...locations/<region>... not servable" almost
        # always means this log line shows the wrong region — a stale env in
        # the container, fixable with `docker compose up -d --force-recreate`.
        print(
            f"[agent-tools] Vertex AI clients: project={project_id} location={location} "
            f"(GOOGLE_CLOUD_LOCATION env={os.environ.get('GOOGLE_CLOUD_LOCATION')!r})",
            file=sys.stderr,
            flush=True,
        )
        credentials = _load_sa_credentials(creds_path) if creds_path else None
        if genai is not None:
            client_kwargs: dict[str, Any] = {
                "vertexai": True,
                "project": project_id,
                "location": location,
            }
            if credentials is not None:
                client_kwargs["credentials"] = credentials
            genai_client = genai.Client(**client_kwargs)  # type: ignore[union-attr]
        if AnthropicVertex is not None:
            # AnthropicVertex picks up credentials via google-auth's ADC
            # chain — same SA JSON via GOOGLE_APPLICATION_CREDENTIALS.
            anthropic_client = AnthropicVertex(
                project_id=project_id, region=location
            )
        return genai_client, anthropic_client

    # Dev fallback: Gemini-only via API key. No Anthropic provider — opus
    # calls will raise at runtime with a helpful message.
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "No LLM auth configured. Either set GOOGLE_GENAI_USE_VERTEXAI=true "
            "(with GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account "
            "JSON) for Vertex AI — required for opus-tier Claude calls — or "
            "GEMINI_API_KEY for a Gemini-only dev setup."
        )
    if genai is not None:
        genai_client = genai.Client(api_key=key)  # type: ignore[union-attr]
    return genai_client, anthropic_client


def _load_sa_credentials(creds_path: str) -> Any | None:
    """Build google.oauth2 service-account credentials with the scopes
    Vertex AI requires. Returns None if google-auth isn't importable
    (we'll fall through to ADC in that case)."""
    if not os.path.exists(creds_path):
        return None
    try:
        from google.oauth2 import service_account  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover - google-auth is a transitive of google-genai
        return None
    return service_account.Credentials.from_service_account_file(
        creds_path, scopes=_VERTEX_SCOPES
    )


def _thinking_budget(
    *, tier: ModelTier, effort: str, adaptive: bool
) -> int:
    """Map (tier, effort, adaptive) → Gemini's thinking_budget int.

    `-1` is the SDK's "let the model decide" sentinel; `0` disables
    thinking entirely. Anything in between is a hard cap.

    Translation stays conservative — overthinking is the main failure
    mode for these models, so we only opt into a big budget when the
    caller explicitly passes adaptive_thinking=True. Anthropic ignores
    this (extended thinking isn't wired through the wrapper yet).
    """
    if adaptive:
        return -1
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
