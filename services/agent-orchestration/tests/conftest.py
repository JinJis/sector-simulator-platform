"""Shared fixtures — primarily the fake LLM client used by every test
in this suite. Nothing here ever hits the network.

History:
- pre-M34: faked the Anthropic SDK shape directly.
- M34: Claude → Gemini swap; the fake mirrored
  `genai.Client.models.generate_content` instead, with an in-fixture
  compat shim that translated the Gemini-style kwargs back into the
  Anthropic-era field names (`system` blocks, `messages` list,
  `thinking` dict, `output_format`) so the (many) pre-M34 test
  assertions kept working.
- M35: brought Claude back for the opus tier. The fake now serves
  BOTH provider shapes:
    - `fake.models.generate_content(...)` — Gemini path
      (sonnet/haiku tiers)
    - `fake.messages.create(...)` — Anthropic path (opus tier)
  Both append to a shared `requests` list and run the same
  `parsed_factory`, so existing tests can assert against
  `fake.messages.requests[-1]` regardless of which provider the
  workflow under test used. The shared compat shim still normalizes
  everything into the Anthropic-era shape.
- Fixture names (`fake_anthropic`, `fake_llm`) are kept for
  blast-radius reasons: many tests already reference them by string.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from agent_tools import LLMClient
from pydantic import BaseModel

from agent_orchestration import schemas as _schemas
from agent_orchestration.schemas import (
    Decomposition,
    DriverNode,
    IntermediateNode,
    OutputNode,
)


# Pydantic schemas accessible by class name. Used by the Anthropic-path
# compat shim to map `tools[0]["name"]` back to the Pydantic class so
# tests can keep asserting `requests[-1]["output_format"] is <Class>`.
_SCHEMA_REGISTRY: dict[str, type[BaseModel]] = {
    name: cls
    for name, cls in vars(_schemas).items()
    if isinstance(cls, type) and issubclass(cls, BaseModel)
}


@dataclass
class FakeUsage:
    """Mirrors `genai.types.GenerateContentResponseUsageMetadata`."""

    prompt_token_count: int = 100
    candidates_token_count: int = 200
    thoughts_token_count: int = 0
    cached_content_token_count: int = 0


@dataclass
class FakePart:
    text: str = ""


@dataclass
class FakeContent:
    parts: list[FakePart] = field(default_factory=list)


@dataclass
class FakeCandidate:
    content: FakeContent | None = None
    finish_reason: str | None = "STOP"


@dataclass
class FakeResponse:
    """Gemini-shape response."""

    text: str = "{}"
    parsed: Any = None
    candidates: list[FakeCandidate] = field(default_factory=list)
    usage_metadata: FakeUsage = field(default_factory=FakeUsage)


# ---- Anthropic-shape response ---------------------------------------------


@dataclass
class FakeAnthropicUsage:
    """Mirrors `anthropic.types.Usage`."""

    input_tokens: int = 100
    output_tokens: int = 200
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class FakeAnthropicBlock:
    """One element of `response.content`. `type` ∈ {"text", "tool_use"};
    the other fields populate depending on `type`."""

    type: str = "text"
    text: str = ""
    name: str = ""
    input: dict[str, Any] | None = None


@dataclass
class FakeAnthropicResponse:
    content: list[FakeAnthropicBlock] = field(default_factory=list)
    stop_reason: str | None = "end_turn"
    usage: FakeAnthropicUsage = field(default_factory=FakeAnthropicUsage)


class FakeModels:
    """Gemini provider fake. Records every `generate_content()` call
    on `self.requests`. Tests assert against `self.requests[-1]` to
    verify the wrapper passed the expected system + user + config
    shape.

    `parsed_factory` is the per-test hook — set it to a callable that
    returns the desired `parsed` Pydantic model based on the kwargs.
    The shim flattens the kwargs into the Anthropic-era shape before
    handing them to the factory, so `_full_pipeline_factory` etc. can
    look at `output_format` to dispatch.
    """

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: FakeResponse | None = None
        self.parsed_factory: Any = None

    def generate_content(self, **kwargs: Any) -> FakeResponse:
        # Compat shim: flatten config-nested fields up to the top level
        # so existing assertions about `requests[-1]["system"]` etc.
        # keep working. This is a fixture-only convenience, NOT a
        # contract that the real SDK provides.
        config = kwargs.get("config", {}) or {}
        kwargs["system"] = self._compat_system_blocks(config.get("system_instruction"))
        kwargs["thinking"] = self._compat_thinking_gemini(config.get("thinking_config"))
        kwargs["output_format"] = config.get("response_schema")
        kwargs["messages"] = self._compat_messages(kwargs.get("contents", []))

        self.requests.append(kwargs)
        if self.next_response is not None:
            return self.next_response

        parsed: Any = None
        if self.parsed_factory is not None:
            parsed = self.parsed_factory(**kwargs)
        return FakeResponse(
            text="{}",
            parsed=parsed,
            candidates=[
                FakeCandidate(
                    content=FakeContent(parts=[FakePart(text="{}")]),
                    finish_reason="STOP",
                )
            ],
        )

    # ---- compat shims ----

    @staticmethod
    def _compat_system_blocks(system_instruction: Any) -> list[dict[str, Any]]:
        """Synthesize the pre-M34 Anthropic block list shape
        `[{type:"text", text, cache_control?}]` from a plain string or
        list. Tests still assert against this shape."""
        if not system_instruction:
            return []
        if isinstance(system_instruction, list):
            chunks = list(system_instruction)
        else:
            chunks = [system_instruction]
        blocks: list[dict[str, Any]] = [
            {"type": "text", "text": chunk} for chunk in chunks
        ]
        # Mark the last block to satisfy the
        # test_decomposition_workflow_uses_decomposition_prompt
        # invariant — the wrapper used to mark it; the fake mimics the
        # result.
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    @staticmethod
    def _compat_thinking_gemini(thinking_config: Any) -> Any:
        """Translate Gemini's `{thinking_budget: N}` into the test-era
        `{type: "adaptive"}` / `{type: "static", budget: N}` shape."""
        if not thinking_config:
            return None
        budget = (
            thinking_config.get("thinking_budget")
            if isinstance(thinking_config, dict)
            else getattr(thinking_config, "thinking_budget", None)
        )
        if budget == -1:
            return {"type": "adaptive"}
        if budget == 0:
            return None
        return {"type": "static", "budget": budget}

    @staticmethod
    def _compat_messages(contents: list[Any]) -> list[dict[str, Any]]:
        """Translate Gemini's `contents` ([{role, parts: [{text}]}]) into
        the Anthropic-era `messages` ([{role, content: str}])."""
        out: list[dict[str, Any]] = []
        for c in contents:
            if isinstance(c, dict):
                role = c.get("role", "user")
                parts = c.get("parts", []) or []
                text = "".join(
                    p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")
                    for p in parts
                )
                if role == "model":
                    role = "assistant"
                out.append({"role": role, "content": text})
        return out


class _FakeStreamCtx:
    """Stand-in for the Anthropic SDK's `MessageStreamManager`.
    `messages.stream(...)` returns one of these; entering the context
    and calling `get_final_message()` yields the same `Message`-like
    object `messages.create(...)` would return. The wrapper at
    `llm_client._call_anthropic` switches to this path when
    `max_tokens >= 8192` (above the SDK's nonstreaming-timeout cap)."""

    def __init__(self, response: FakeAnthropicResponse) -> None:
        self._response = response

    def __enter__(self) -> _FakeStreamCtx:
        return self

    def __exit__(self, *_exc: Any) -> None:
        return None

    def __iter__(self):
        # The wrapper drains stream events to let the helper assemble
        # the final message; one sentinel event is enough for tests.
        yield object()

    def get_final_message(self) -> FakeAnthropicResponse:
        return self._response


class FakeMessages:
    """Anthropic provider fake. Records `messages.create(...)` calls on
    the shared `requests` list (same list as `FakeModels`) so tests can
    inspect either provider's traffic through a single attribute path.

    `parsed_factory` and `next_response` are shared via the parent
    `FakeGenAI`. The shim normalizes the request kwargs into the
    Anthropic-era shape (so existing assertions work) and builds a
    response with a `tool_use` block carrying the parsed Pydantic dump
    — matching the trick the real wrapper uses for structured output.
    """

    def __init__(self, parent: FakeGenAI) -> None:
        self._parent = parent

    @property
    def requests(self) -> list[dict[str, Any]]:
        # Shared list so tests reading `fake.messages.requests[-1]`
        # see both Gemini and Anthropic calls regardless of which path
        # the workflow under test exercised.
        return self._parent.models.requests

    @property
    def parsed_factory(self) -> Any:
        return self._parent.models.parsed_factory

    @parsed_factory.setter
    def parsed_factory(self, value: Any) -> None:
        self._parent.models.parsed_factory = value

    @property
    def next_response(self) -> Any:
        return self._parent.models.next_response

    @next_response.setter
    def next_response(self, value: Any) -> None:
        self._parent.models.next_response = value

    def create(self, **kwargs: Any) -> FakeAnthropicResponse:
        return self._build_response(kwargs)

    def stream(self, **kwargs: Any) -> _FakeStreamCtx:
        """Mirrors `Anthropic.messages.stream(...)` — returns a context
        manager whose `get_final_message()` yields the same response
        `create()` would have. llm_client switches to this when
        `max_tokens >= 8192` to dodge the SDK's nonstreaming-timeout
        guard. The recorded request goes onto the same `requests` list
        so existing assertions don't care which path was taken."""
        return _FakeStreamCtx(self._build_response(kwargs))

    def _build_response(self, kwargs: dict[str, Any]) -> FakeAnthropicResponse:
        # ---- adapt Anthropic-shape kwargs into the shared shape ----
        # Tests assert `requests[-1]["system"]` is a block list, even
        # though Anthropic's API takes a plain string. Synthesize.
        kwargs["system"] = FakeModels._compat_system_blocks(kwargs.get("system"))
        # Tests assert `requests[-1]["thinking"]` follows the test-era
        # shape. Translate from Anthropic's `{type: "enabled", budget_tokens}`.
        kwargs["thinking"] = self._compat_thinking_anthropic(kwargs.get("thinking"))
        # Resolve the response_model class from `tools[0]["name"]` via
        # the schema registry (Anthropic doesn't return the class
        # directly — it just gets the JSON schema embedded in the tool
        # definition).
        tools = kwargs.get("tools") or []
        tool_name = tools[0].get("name") if tools else None
        kwargs["output_format"] = (
            _SCHEMA_REGISTRY.get(tool_name) if isinstance(tool_name, str) else None
        )
        # `messages` is already in the right shape ({role, content}).

        self.requests.append(kwargs)
        if self.next_response is not None:
            # next_response is Gemini-shape — translate on the fly so
            # the wrapper sees an Anthropic-shape response. Most tests
            # use parsed_factory rather than next_response on the
            # Anthropic path, so this branch is rarely hit.
            return self._translate_gemini_response(self.next_response)

        parsed: BaseModel | None = None
        if self.parsed_factory is not None:
            result = self.parsed_factory(**kwargs)
            if isinstance(result, BaseModel):
                parsed = result

        # Build the Anthropic-shape response. For structured output
        # (response_model set), surface as a tool_use block — the
        # wrapper will extract `block.input` and re-validate via
        # `response_model.model_validate(...)`.
        if parsed is not None:
            content = [
                FakeAnthropicBlock(
                    type="tool_use",
                    name=type(parsed).__name__,
                    input=parsed.model_dump(mode="json"),
                )
            ]
            stop_reason = "tool_use"
        else:
            content = [FakeAnthropicBlock(type="text", text="{}")]
            stop_reason = "end_turn"
        return FakeAnthropicResponse(
            content=content,
            stop_reason=stop_reason,
            usage=FakeAnthropicUsage(input_tokens=100, output_tokens=200),
        )

    @staticmethod
    def _compat_thinking_anthropic(thinking: Any) -> Any:
        """Translate Anthropic's `{type: "enabled", budget_tokens: N}` /
        absent value into the same test-era `{type: "adaptive"}` /
        `{type: "static", budget: N}` shape the Gemini shim uses, so
        tests can be written generically over both providers."""
        if not thinking:
            return None
        if isinstance(thinking, dict) and thinking.get("type") == "enabled":
            # Anthropic only supports a single "enabled" mode; map it
            # to the "adaptive" sentinel for assertion compat.
            return {"type": "adaptive"}
        return thinking

    @staticmethod
    def _translate_gemini_response(resp: Any) -> FakeAnthropicResponse:
        """Rare path: a test set `next_response` (a `FakeResponse`) and
        the wrapper happened to call through the Anthropic side. Wrap
        the Gemini text into a text-only Anthropic response."""
        text = getattr(resp, "text", "") or ""
        return FakeAnthropicResponse(
            content=[FakeAnthropicBlock(type="text", text=text)],
            stop_reason="end_turn",
            usage=FakeAnthropicUsage(input_tokens=10, output_tokens=20),
        )


class FakeGenAI:
    """Composite fake. The same instance is passed as both
    `genai_client` and `anthropic_client` into LLMClient; the wrapper
    dispatches by tier and hits the matching surface."""

    def __init__(self) -> None:
        self.models = FakeModels()
        self._messages = FakeMessages(self)

    @property
    def messages(self) -> FakeMessages:
        return self._messages


# Back-compat alias — some tests / fixtures still import `FakeAnthropic`.
FakeAnthropic = FakeGenAI


_SAMPLE = Decomposition(
    name="AI Memory Demand",
    slug="ai-memory-demand",
    description="HBM and high-grade DRAM demand driven by AI accelerators.",
    horizon_years=10,
    drivers=[
        DriverNode(
            name="ai_dram_demand_pb_y0",
            group="Demand",
            unit="PB",
            default=800.0,
            min=50.0,
            max=5000.0,
            description="Year-0 AI/HBM demand.",
        ),
        DriverNode(
            name="hbm_premium_x",
            group="Pricing",
            unit="x",
            default=5.0,
            min=2.0,
            max=12.0,
            description="HBM ASP / commodity DRAM ASP.",
        ),
    ],
    intermediates=[
        IntermediateNode(
            name="industry_revenue",
            unit="USD",
            description="Industry revenue trajectory.",
        )
    ],
    outputs=[
        OutputNode(
            name="company_revenue_usd",
            kind="series",
            unit="USD",
            description="Company annual revenue.",
        )
    ],
)


@pytest.fixture
def fake_anthropic() -> FakeGenAI:
    """Composite fake serving both providers. Default factory returns
    the sample Decomposition (the most common case); tests override
    `parsed_factory` / `next_response` to customize."""
    fake = FakeGenAI()

    def factory(**kwargs: Any) -> Decomposition:
        return _SAMPLE

    fake.models.parsed_factory = factory
    return fake


@pytest.fixture
def fake_llm(fake_anthropic: FakeGenAI) -> LLMClient:
    # Same fake instance is wired into BOTH provider slots — the
    # wrapper picks by tier, and the fake serves either shape.
    return LLMClient(
        genai_client=fake_anthropic, anthropic_client=fake_anthropic
    )


@pytest.fixture
def sample_decomposition() -> Decomposition:
    return _SAMPLE


@pytest.fixture
def app(fake_llm: LLMClient) -> Iterator[Any]:
    """A fresh FastAPI app with the fake LLM injected. The runner is a
    new instance per test so workflow IDs and state don't bleed."""
    from fastapi.testclient import TestClient

    from agent_orchestration.main import create_app
    from agent_orchestration.workflows import WorkflowRunner

    app = create_app()
    app.state.llm = fake_llm
    app.state.runner = WorkflowRunner()
    with TestClient(app) as client:
        yield client
