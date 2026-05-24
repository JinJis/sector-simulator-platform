"""Shared utilities for the agent-evals harness.

`Case` is the per-test contract: input, optional canned response, and a
list of assertions over the parsed output. `CostBudget` is the upper
bound on what a case may spend; the harness fails a case that overruns.

Cases work in both offline (`FakeGenAI` returns the canned response)
and live (`GEMINI_EVAL_LIVE=1`, real `genai.Client()` via LLMClient)
modes. The Python contract is identical in both modes — only the
LLMClient's internal client object differs.

In live mode the LLMClient construction follows the same auth path as
the rest of the platform — Vertex AI when `GOOGLE_GENAI_USE_VERTEXAI=true`
(plus `GOOGLE_CLOUD_PROJECT` + ADC credentials via
`GOOGLE_APPLICATION_CREDENTIALS`), or the legacy `GEMINI_API_KEY` path
otherwise. See `infra/secrets/README.md` for the service-account JSON.

History: pre-M34 this faked Anthropic; M34 swapped to Gemini; M34b
swapped Gemini auth from API key to Vertex AI service account.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

from agent_tools import LLMClient
from pydantic import BaseModel

OutputT = TypeVar("OutputT", bound=BaseModel)


# ---- Live-mode toggle ----------------------------------------------------


def is_live_mode() -> bool:
    """Live mode means real API calls. Triggered by setting the env var
    explicitly — never inferred. Eval runs in offline mode by default so
    `pytest tests/agent-evals` is cheap to run in CI.

    `ANTHROPIC_EVAL_LIVE` kept as a back-compat alias so any wrapper
    scripts that already set it continue to work."""
    for var in ("GEMINI_EVAL_LIVE", "ANTHROPIC_EVAL_LIVE"):
        if os.environ.get(var, "").lower() in {"1", "true", "yes"}:
            return True
    return False


# ---- Cost guard ----------------------------------------------------------


@dataclass(frozen=True)
class CostBudget:
    """Per-case cost ceiling. Applied after the workflow returns so a case
    that costs $0.50 fails loudly instead of silently driving up the bill."""

    max_usd: float

    def assert_within(self, actual_usd: float, case_name: str) -> None:
        if actual_usd > self.max_usd:
            raise AssertionError(
                f"case {case_name!r}: cost ${actual_usd:.4f} exceeded budget "
                f"${self.max_usd:.4f}"
            )


# ---- Case shape ----------------------------------------------------------


@dataclass(frozen=True)
class Case(Generic[OutputT]):
    """One eval case.

    Each `assertion` is a plain callable; the harness invokes it on the
    parsed output and lets any AssertionError it raises propagate (so
    pytest reports the specific failure line). Use plain `assert`
    statements with clear messages.

    `canned_response` is what offline mode replays. In live mode it's
    ignored. Keep it realistic — an obviously-fake canned response that
    happens to satisfy your assertions doesn't catch regressions.
    """

    name: str
    description: str
    canned_response: BaseModel
    assertions: list[Callable[[Any], None]]
    budget: CostBudget = field(default_factory=lambda: CostBudget(max_usd=0.10))


# ---- Offline LLMClient factory ------------------------------------------
#
# `conftest.py` exposes `llm_for_case(case)` as a fixture. In offline mode
# it builds a FakeAnthropic primed with the case's canned response; in
# live mode it returns a real LLMClient against the actual API.


@dataclass
class _FakeUsage:
    """Mirrors `genai.types.GenerateContentResponseUsageMetadata`."""

    prompt_token_count: int = 4096
    candidates_token_count: int = 1024
    thoughts_token_count: int = 0
    cached_content_token_count: int = 0


@dataclass
class _FakePart:
    text: str = ""


@dataclass
class _FakeContent:
    parts: list[_FakePart] = field(default_factory=list)


@dataclass
class _FakeCandidate:
    content: _FakeContent | None = None
    finish_reason: str | None = "STOP"


@dataclass
class _FakeResponse:
    text: str = ""
    parsed: Any = None
    candidates: list[_FakeCandidate] = field(default_factory=list)
    usage_metadata: _FakeUsage = field(default_factory=_FakeUsage)


class _FakeModels:
    def __init__(self, canned: BaseModel) -> None:
        self._canned = canned
        self.requests: list[dict[str, Any]] = []

    def generate_content(self, **kwargs: Any) -> _FakeResponse:
        self.requests.append(kwargs)
        text = self._canned.model_dump_json()
        return _FakeResponse(
            text=text,
            parsed=self._canned,
            candidates=[
                _FakeCandidate(
                    content=_FakeContent(parts=[_FakePart(text=text)]),
                    finish_reason="STOP",
                )
            ],
        )


# ---- Anthropic-shape stubs ------------------------------------------------
#
# Opus-tier workflows (Decomposition, EdgeInference, CodeGen, CodeReview,
# VisionDecomposition) route to Anthropic via LLMClient._call_anthropic.
# The fake `messages.create()` must return a response with a `tool_use`
# block carrying the canned BaseModel's `model_dump(mode="json")` —
# matching the structured-output trick the real wrapper uses.


@dataclass
class _FakeAnthropicBlock:
    type: str = "text"
    text: str = ""
    name: str | None = None
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class _FakeAnthropicUsage:
    input_tokens: int = 4096
    output_tokens: int = 1024
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class _FakeAnthropicResponse:
    content: list[_FakeAnthropicBlock] = field(default_factory=list)
    stop_reason: str = "end_turn"
    usage: _FakeAnthropicUsage = field(default_factory=_FakeAnthropicUsage)


class _FakeMessages:
    """Anthropic provider fake. Records `create(...)` calls on the
    shared `requests` list (same list as `_FakeModels`) so tests can
    inspect either provider's traffic from one place."""

    def __init__(self, parent: "_FakeGenAI") -> None:
        self._parent = parent

    def create(self, **kwargs: Any) -> _FakeAnthropicResponse:
        self._parent.models.requests.append(kwargs)
        canned = self._parent.models._canned
        # If the call is structured-output (tool_choice forces a tool),
        # surface as a tool_use block carrying the canned dump.
        tool_choice = kwargs.get("tool_choice")
        if tool_choice and isinstance(tool_choice, dict) and tool_choice.get("type") == "tool":
            return _FakeAnthropicResponse(
                content=[
                    _FakeAnthropicBlock(
                        type="tool_use",
                        name=tool_choice.get("name", type(canned).__name__),
                        input=canned.model_dump(mode="json"),
                    )
                ],
                stop_reason="tool_use",
            )
        # Free-form text return — drop the canned JSON in the text.
        return _FakeAnthropicResponse(
            content=[_FakeAnthropicBlock(type="text", text=canned.model_dump_json())],
            stop_reason="end_turn",
        )


class _FakeGenAI:
    """Composite fake. The same instance is injected as BOTH
    `genai_client` and `anthropic_client` into LLMClient; the wrapper
    dispatches by tier and hits the matching surface."""

    def __init__(self, canned: BaseModel) -> None:
        self.models = _FakeModels(canned)
        self._messages = _FakeMessages(self)

    @property
    def messages(self) -> _FakeMessages:
        return self._messages


def build_llm(case: Case) -> LLMClient:
    """Build an LLMClient suitable for one case. Lives here so tests can
    construct it directly when they don't want the pytest fixture.

    In live mode `LLMClient()` reads the same env contract as the rest
    of the platform (Vertex AI first, GEMINI_API_KEY fallback). In
    offline mode we inject a fake client — no env or auth needed.
    """
    if is_live_mode():
        return LLMClient()
    fake = _FakeGenAI(case.canned_response)
    # The fake serves BOTH provider surfaces, so inject it twice. Opus-
    # tier workflows (Decomposition, VisionDecomposition, ...) hit the
    # Anthropic path; haiku/sonnet hit the Gemini path. One instance
    # keeps `requests` shared so test code can inspect either.
    return LLMClient(genai_client=fake, anthropic_client=fake)
