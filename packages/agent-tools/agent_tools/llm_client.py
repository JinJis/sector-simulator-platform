"""Thin wrapper around Google Gemini via the `google-genai` SDK.

Single-provider after F9 (was dual-provider Anthropic + Gemini through
F8). The deep tier — used by VisionDecomposition, CodeReview, etc. —
now also routes to Gemini (a Pro-class model) rather than Claude on
Vertex Model Garden. The Vertex Claude path proved unstable on
multiple axes (10-minute nonstreaming timeout for long requests,
opaque tool_use truncation, region routing surprises) and the
dual-SDK split was paying for problems we didn't actually need to
solve.

Tier mapping (env-overridable via `LLM_{DEEP,BALANCED,FAST}_MODEL`):

  - deep     → gemini-3.1-pro-preview  (most capable, deepest thinking)
  - balanced → gemini-3.5-flash         (bulk of agent reasoning)
  - fast     → gemini-3.5-flash-lite    (cheapest, extraction / routing)

Design decisions
----------------
- Routing is by tier (`"fast"` / `"balanced"` / `"deep"`). The dispatch
  table here is the only place to bump when the mapping changes; every
  callsite stays generic.
- `LLMClient.call(...)` surface (tier, system, user, max_tokens,
  response_model, adaptive_thinking, effort, tools, extra_messages,
  cache_system) is preserved verbatim across the F9 swap so workflow
  code doesn't change.
- Structured output: native Gemini `response_schema`. When the schema
  is too complex for Vertex's FST constraint compiler (5888-state cap),
  the wrapper transparently retries without `response_schema`, injects
  the JSON Schema into the prompt, and validates the raw text via
  Pydantic post-parse. Callers always get a typed `parsed` field.
- `adaptive_thinking=True` enables Gemini's dynamic thinking budget
  (`-1` sentinel). Otherwise `thinking_budget` follows
  (tier, effort) — fast defaults to 0, balanced/deep to a small fixed
  cap unless effort="high".

What this file does NOT do (deliberately):
- Explicit context caching for Gemini (`cachedContent` resource).
- Tool execution loop. Callers drive the loop.
- Retry/backoff on transient 429/5xx (the SDK handles those).
- Streaming. Gemini doesn't have the Anthropic 10-min nonstreaming cap;
  every call goes through `generate_content`.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ValidationError

try:  # Allow import without the optional dep present (tests using fakes
    # can still exercise the cost meter and tool defs).
    from google import genai
except ImportError:  # pragma: no cover - exercised only in environments
    # without the google-genai dep.
    genai = None  # type: ignore[assignment]


ModelTier = Literal["fast", "balanced", "deep"]


# Defaults — env vars below override per tier so model rolls don't need
# a code change. Update the defaults only when migrating the base
# lineup. Names are semantic (depth/cost trade-off), not vendor-branded:
#   fast      — cheapest, used for extraction / routing / classification
#   balanced  — middle, used for the bulk of agent reasoning
#   deep      — most capable, used for synthesis (decomposition, review)
_DEFAULT_MODEL_BY_TIER: dict[ModelTier, str] = {
    "fast": "gemini-3.1-flash-lite",
    "balanced": "gemini-3.5-flash",
    "deep": "gemini-3.1-pro-preview",
}

# Env var that overrides each tier's model id. Read at call time, not
# import time, so tests can monkeypatch + container restarts pick up new
# values without a wheel rebuild.
_MODEL_ENV_BY_TIER: dict[ModelTier, str] = {
    "fast": "LLM_FAST_MODEL",
    "balanced": "LLM_BALANCED_MODEL",
    "deep": "LLM_DEEP_MODEL",
}


# Optional resolver hook injected by services that read tier overrides
# from a runtime store (slice 12 JobConfig). Set via
# `set_model_resolver`; cleared by passing None. The resolver returns
# the model id for a tier, or None to fall through to env / default.
# Keeping this in a sync hook (not async) so the caller doesn't need to
# await — services pre-warm their store and inject a sync wrapper.
_MODEL_RESOLVER: Callable[[ModelTier], str | None] | None = None


def set_model_resolver(
    resolver: Callable[[ModelTier], str | None] | None,
) -> None:
    """Plug in a tier → model resolver. data-pipeline + agent-
    orchestration lifespan wire this to a JobConfigStore so admin
    edits to `LLM_*_MODEL` take effect across services without a
    container restart. Pass None to clear (tests use this in
    `addfinalizer`)."""
    global _MODEL_RESOLVER
    _MODEL_RESOLVER = resolver


def model_for_tier(tier: ModelTier) -> str:
    """Resolve the active model id for `tier`. Order of precedence:
    runtime resolver (DB) → env (`LLM_{DEEP,BALANCED,FAST}_MODEL`) →
    built-in default."""
    if _MODEL_RESOLVER is not None:
        override = _MODEL_RESOLVER(tier)
        if override:
            return override
    env_key = _MODEL_ENV_BY_TIER[tier]
    return os.environ.get(env_key) or _DEFAULT_MODEL_BY_TIER[tier]


def available_models() -> Mapping[ModelTier, str]:
    """Return the currently-active tier → model-id mapping (resolver +
    env + default)."""
    return {tier: model_for_tier(tier) for tier in _DEFAULT_MODEL_BY_TIER}


def _is_constraint_too_tall(exc: Exception) -> bool:
    """True when the exception is the Vertex/Gemini 'response_schema
    too complex' FST-overflow error. We match on substring of the
    serialized error rather than the typed `ClientError` because the
    SDK occasionally raises through wrapping layers (httpx → genai)
    and the typed class isn't always preserved."""
    msg = str(exc).lower()
    return "constraint is too tall" in msg or "constraint is too big" in msg


T = TypeVar("T", bound=BaseModel)


def _parse_text_as_pydantic(
    *, text: str, response_model: type[T],
) -> tuple[BaseModel | None, str | None]:
    """Best-effort: parse `text` as JSON + validate via Pydantic.
    Tolerates the model wrapping its output in a markdown code fence
    (``` or ```json) which Gemini does when not under strict schema
    enforcement. Also tolerates prose-prefix ("Here is the JSON: …{}")
    by extracting the first top-level {…} or […] block.

    Returns ``(parsed, None)`` on success and ``(None, error_summary)``
    on either JSON parse or Pydantic validation failure. The error
    summary is a human-readable string the caller can paste into a
    correction prompt — see ``_validation_correction_turn``.
    """
    raw = text.strip()
    # 1. Strip markdown code fence if present.
    if raw.startswith("```"):
        raw = raw.lstrip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    # 2. If there's prose around the JSON, isolate the first {…} or […]
    #    block. The model occasionally writes "Here's the requested
    #    output:\n{…}" even when explicitly told to return JSON-only.
    if raw and raw[0] not in "{[":
        for opener, closer in (("{", "}"), ("[", "]")):
            start = raw.find(opener)
            end = raw.rfind(closer)
            if start != -1 and end > start:
                raw = raw[start : end + 1]
                break
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        # Truncation detector — if the raw text ends without a
        # matching closing brace, the response was almost certainly
        # cut off at max_output_tokens (Gemini's `stop_reason` may
        # still report STOP because the SDK occasionally reports
        # natural-stop for token-cap-truncations). Surfacing the
        # distinction tells the operator "bump max_tokens" instead
        # of "fix the model's JSON skill."
        stripped = raw.rstrip()
        looks_truncated = (
            len(stripped) > 100
            and stripped[0] in "{["
            and stripped[-1] not in "}]"
        )
        truncation_hint = " — output appears truncated (no closing brace); bump max_tokens" if looks_truncated else ""
        msg = f"JSON parse failed: {exc}{truncation_hint}"
        # Include both the prefix AND suffix of the text so the
        # operator can tell at a glance whether the JSON terminated
        # naturally or was cut off mid-stream.
        sys.stderr.write(
            f"llm_client: post-retry JSON parse failed "
            f"(model={response_model.__name__}, err={exc}, "
            f"text_len={len(text)}, "
            f"text_prefix={text[:200]!r}, "
            f"text_suffix={text[-200:]!r}"
            f"{truncation_hint})\n"
        )
        return None, msg
    try:
        return response_model.model_validate(data), None
    except ValidationError as exc:
        # Surface every error's path + message — the correction prompt
        # benefits from seeing all of them, not just the first one.
        errors = exc.errors()
        first = errors[0] if errors else {}
        sys.stderr.write(
            f"llm_client: post-retry Pydantic validation failed "
            f"(model={response_model.__name__}, errors={exc.error_count()}, "
            f"first_error_path={'.'.join(str(p) for p in first.get('loc', ()))}, "
            f"first_error={first.get('msg', '?')!r}, "
            f"data_keys={list(data) if isinstance(data, dict) else type(data).__name__})\n"
        )
        # Format all errors for the correction prompt. Cap at 10 to keep
        # the user turn small; a response with > 10 errors is broken
        # enough that one correction round won't save it.
        lines = []
        for e in errors[:10]:
            path = ".".join(str(p) for p in e.get("loc", ())) or "<root>"
            lines.append(f"- {path}: {e.get('msg', '?')}")
        summary = "Pydantic validation failed:\n" + "\n".join(lines)
        return None, summary


def _validation_correction_turn(
    response_model: type[BaseModel], error_summary: str
) -> dict[str, Any]:
    """Build a user-role turn telling Gemini *what* failed validation
    on its previous response. Pairs with the model's failed JSON
    (sent back as an assistant turn) to form a 3-message correction
    cycle: original prompt → schema reminder → model's wrong JSON →
    "here's what was wrong, regenerate." Keeps the schema name in the
    message so the model has a strong hint about which output to
    re-emit."""
    body = (
        f"Your previous response failed validation against the "
        f"{response_model.__name__} schema:\n\n"
        f"{error_summary}\n\n"
        f"Re-emit ONLY a single corrected JSON object that fixes every "
        f"listed error. No prose, no markdown fence, no commentary."
    )
    return {"role": "user", "parts": [{"text": body}]}


def _schema_reminder_turn(response_model: type[BaseModel]) -> dict[str, Any]:
    """Build a final user-role content block that hands the Pydantic
    JSON Schema to the model. Used by the constraint-too-tall retry
    path: without server-side enforcement the model only follows the
    shape it can see in the prompt, so we hand it the spec explicitly.
    Direct phrasing ("Return ONLY a JSON object …") minimises the
    chance of prose preamble around the JSON."""
    schema = response_model.model_json_schema()
    schema_text = json.dumps(schema, indent=2, ensure_ascii=False)
    body = (
        "Return ONLY a single JSON object that validates against this "
        f"JSON Schema (no prose, no markdown fence, no explanation):\n\n"
        f"```json\n{schema_text}\n```\n\n"
        f"Schema name: {response_model.__name__}. Every required field "
        "must be present. Optional fields may be omitted or null."
    )
    return {"role": "user", "parts": [{"text": body}]}


# Effort hints retained for API compatibility. Drives the thinking
# budget heuristic in `_thinking_budget` below.
_DEFAULT_EFFORT_BY_TIER: dict[ModelTier, str] = {
    "fast": "medium",
    "balanced": "medium",
    "deep": "high",
}


@dataclass(frozen=True)
class LLMCallResult:
    """Everything callers usually need from one LLM call."""

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
    cache_creation_input_tokens, cache_read_input_tokens. Gemini doesn't
    distinguish cache creation; the field is always 0. cache_read is
    populated when the response surfaces `cached_content_token_count`."""


# Scopes required for the SA to authenticate against Vertex AI.
# `cloud-platform` covers `aiplatform.googleapis.com` (Gemini on Vertex);
# `generative-language` is harmless extra coverage for the Google AI
# Studio path if we ever toggle back.
_VERTEX_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language",
]


class LLMClient:
    """Centralized entry point for every LLM call in the platform.

    ```python
    # Free-form text
    result = client.call(
        tier="balanced",
        system=SYSTEM_PROMPT,
        user="What's the area of a triangle with sides 3, 4, 5?",
    )

    # Pydantic-validated structured output
    class Decomposition(BaseModel):
        drivers: list[str]
        intermediates: list[str]
    result = client.call(
        tier="deep",
        system=DECOMP_SYSTEM,
        user=user_question,
        response_model=Decomposition,
    )
    assert isinstance(result.parsed, Decomposition)
    ```

    Construction:
    - `LLMClient()` — pick up the Gemini client from env (Vertex AI SA
      JSON + GOOGLE_CLOUD_LOCATION, or dev fallback to GEMINI_API_KEY).
      Production path.
    - `LLMClient(genai_client=fake)` — inject a fake for tests.
    - `LLMClient(client=fake)` — backwards-compat alias for
      `genai_client=`. Kept so the (many) pre-F9 test fixtures keep
      compiling unchanged.
    """

    def __init__(
        self,
        *,
        cost_meter: CostMeter | None = None,
        client: Any | None = None,
        genai_client: Any | None = None,
        api_key: str | None = None,
    ) -> None:
        from agent_tools.cost import CostMeter as _CostMeter

        # Backwards-compat: pre-M35 fixtures pass `client=` and assume
        # it's the Gemini provider.
        if client is not None and genai_client is None:
            genai_client = client

        if genai_client is None:
            genai_client = _build_default_client(api_key=api_key)

        if genai_client is None:
            # SDK absent and no fake — refuse to construct rather than
            # crashing later on `.call()`.
            raise RuntimeError(
                "LLMClient: no provider configured. Set "
                "GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_APPLICATION_CREDENTIALS "
                "(production), or GEMINI_API_KEY (dev), or inject a fake "
                "via genai_client= for tests."
            )

        self._genai = genai_client
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
        """Return a new LLMClient sharing the same underlying client
        but with a fresh (or supplied) cost meter. Used by per-workflow
        wrappers to scope cost to a single run without touching the
        shared client."""
        return LLMClient(genai_client=self._genai, cost_meter=cost_meter)

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
        cache_system: bool = True,  # noqa: ARG002 - reserved for future cachedContent
        tools: Iterable[dict[str, Any]] | None = None,
        response_model: type[T] | None = None,
        extra_messages: list[dict[str, Any]] | None = None,
    ) -> LLMCallResult:
        """Make one LLM call. Always dispatches to google-genai now
        (F9 made the deep tier route to Gemini Pro instead of Claude)."""
        from agent_tools.cost import price_call

        if self._genai is None:
            raise RuntimeError(
                "LLMClient.call: no google-genai client configured. "
                "Install `google-genai` and either set "
                "GOOGLE_GENAI_USE_VERTEXAI=true + "
                "GOOGLE_APPLICATION_CREDENTIALS (Vertex) or GEMINI_API_KEY "
                "(AI Studio)."
            )

        model = model_for_tier(tier)
        effort = effort or _DEFAULT_EFFORT_BY_TIER[tier]
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

        # Track whether we fell back to the prompt-injection retry path,
        # and the contents/config used there — the validation-error
        # re-prompt below needs them to construct a 3rd-turn correction.
        retry_contents: list[Any] | None = None
        retry_config: dict[str, Any] | None = None
        try:
            response = self._genai.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            # Vertex/Gemini compiles `response_schema` into a Finite
            # State Transducer constraint whose serialized size has a
            # hard ceiling (~5888 states as of 2026-05). Complex
            # Pydantic schemas (nested arrays of bounded strings, regex
            # patterns, deep enums) routinely blow past that and Vertex
            # returns:
            #
            #   400 INVALID_ARGUMENT … Constraint is too tall: NNNNN
            #   (vs max of 5888); see go/constraint-is-too-big; Failed
            #   while executing Op 'Prefill'
            #
            # Recover by retrying without `response_schema` — keep
            # `response_mime_type="application/json"` so the model
            # still emits JSON, AND inject the JSON Schema into the
            # prompt as a final user turn so the model knows what shape
            # to produce. Validate via Pydantic post-parse. If the
            # second call ALSO fails, propagate.
            if response_model is not None and _is_constraint_too_tall(exc):
                sys.stderr.write(
                    f"llm_client: Gemini rejected response_schema as too "
                    f"complex (model={response_model.__name__}); retrying "
                    f"with schema injected into prompt + post-parse via "
                    f"Pydantic\n"
                )
                retry_config = dict(config)
                retry_config.pop("response_schema", None)
                retry_contents = list(contents) + [
                    _schema_reminder_turn(response_model)
                ]
                response = self._genai.models.generate_content(
                    model=model,
                    contents=retry_contents,
                    config=retry_config,
                )
            else:
                raise

        usage = self._extract_gemini_usage(response)
        priced = price_call(model=model, **usage)
        self.cost_meter.record(priced)

        text = self._extract_gemini_text(response)
        parsed = self._extract_gemini_parsed(response, response_model)
        if parsed is None and response_model is not None and text:
            # Retry path (or any case where Gemini returned text-only
            # JSON despite a response_model being requested) — parse
            # the text as JSON and validate via Pydantic.
            parsed, validation_error = _parse_text_as_pydantic(
                text=text, response_model=response_model,
            )
            # Validation-error re-prompt: if Pydantic rejected the
            # text-only JSON, send Gemini one more turn telling it
            # *what* failed and asking for a corrected JSON. Costs one
            # extra round-trip (deep tier ≈ $0.30) but turns a hard
            # failure into a soft retry. Capped at 1 attempt — a
            # response with > 10 validation errors is broken enough
            # that another round won't fix it.
            if (
                parsed is None
                and validation_error is not None
                and retry_contents is not None
                and retry_config is not None
            ):
                sys.stderr.write(
                    f"llm_client: re-prompting Gemini with validation "
                    f"errors (model={response_model.__name__})\n"
                )
                correction_contents = list(retry_contents) + [
                    {"role": "model", "parts": [{"text": text}]},
                    _validation_correction_turn(
                        response_model, validation_error
                    ),
                ]
                correction_response = self._genai.models.generate_content(
                    model=model,
                    contents=correction_contents,
                    config=retry_config,
                )
                correction_usage = self._extract_gemini_usage(
                    correction_response
                )
                self.cost_meter.record(
                    price_call(model=model, **correction_usage)
                )
                correction_text = self._extract_gemini_text(
                    correction_response
                )
                if correction_text:
                    parsed, _ = _parse_text_as_pydantic(
                        text=correction_text,
                        response_model=response_model,
                    )
                if parsed is not None:
                    # Surface the corrected text + usage so the caller
                    # sees the final state, not the rejected one.
                    text = correction_text
                    response = correction_response
                    usage = correction_usage
        stop_reason = self._extract_gemini_stop_reason(response)

        return LLMCallResult(
            model=model,
            tier=tier,
            text=text,
            parsed=parsed,
            stop_reason=stop_reason,
            raw_usage=usage,
        )

    # ---- helpers ------------------------------------------------------------

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
            try:
                return response_model.model_validate(parsed)
            except ValidationError:
                return None
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


def _build_default_client(*, api_key: str | None) -> Any | None:
    """Construct a google-genai Client from environment.

    Production path: Vertex AI. Service-account JSON at
    ``GOOGLE_APPLICATION_CREDENTIALS`` authenticates the SDK;
    ``GOOGLE_CLOUD_LOCATION`` (default ``global``) picks the region.
    The project id is read from the SA JSON itself and overridden by
    ``GOOGLE_CLOUD_PROJECT`` when explicitly set.

    Dev fallback: a ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY`` builds an
    AI Studio client.
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

    if use_vertex:
        if not project_id:
            raise RuntimeError(
                "Vertex AI mode requires either GOOGLE_CLOUD_PROJECT to be set "
                "explicitly, or GOOGLE_APPLICATION_CREDENTIALS to point at a "
                "service-account JSON containing a `project_id` field."
            )
        # One-line startup log so `docker compose logs agent-orchestration | head`
        # immediately shows which region the provider actually got. The error
        # path "Publisher Model ...locations/<region>... not servable" almost
        # always means this log line shows the wrong region — a stale env in
        # the container, fixable with `docker compose up -d --force-recreate`.
        print(
            f"[agent-tools] Vertex AI client: project={project_id} location={location} "
            f"(GOOGLE_CLOUD_LOCATION env={os.environ.get('GOOGLE_CLOUD_LOCATION')!r})",
            file=sys.stderr,
            flush=True,
        )
        credentials = _load_sa_credentials(creds_path) if creds_path else None
        if genai is None:
            return None
        client_kwargs: dict[str, Any] = {
            "vertexai": True,
            "project": project_id,
            "location": location,
        }
        if credentials is not None:
            client_kwargs["credentials"] = credentials
        return genai.Client(**client_kwargs)  # type: ignore[union-attr]

    # Dev fallback: AI Studio via API key.
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "No LLM auth configured. Either set GOOGLE_GENAI_USE_VERTEXAI=true "
            "(with GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account "
            "JSON) for Vertex AI, or GEMINI_API_KEY for AI Studio."
        )
    if genai is None:
        return None
    return genai.Client(api_key=key)  # type: ignore[union-attr]


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
    caller explicitly passes adaptive_thinking=True or sets
    effort="high". The deep tier (gemini-3.1-pro-preview) defaults to
    effort="high" + a 4096-token thinking cap for its synthesis work
    (vision decomposition, code review).
    """
    if adaptive:
        return -1
    if tier == "fast":
        return 0
    if effort == "high":
        return 4096
    if effort == "low":
        return 512
    return 1024


# Re-export so package consumers don't have to import from `cost`
# separately when they just want `CostMeter`.
from agent_tools.cost import CostMeter  # noqa: E402  - circular-friendly re-export
