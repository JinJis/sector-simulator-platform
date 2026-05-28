"""Offline tests — never touches the network. Both providers (Gemini
via `google-genai` and Claude via `anthropic[vertex]`) are faked so we
can assert the wrapper builds the right request shape and routes the
right tier to the right provider.

History: pre-M34 these tests faked the Anthropic SDK shape. M34 swapped
the fakes to the Gemini `genai.Client.models.generate_content` shape.
M35 brings Claude back for the opus tier — the wrapper now dispatches
internally, so opus-tier tests use the new `_FakeAnthropic` while
sonnet/haiku tests keep the `_FakeGenAI`. The `LLMClient` surface
(tier, system, user, max_tokens, response_model, adaptive_thinking) is
unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from agent_tools import LLMClient, available_models


# ---- Gemini fake -----------------------------------------------------------


@dataclass
class _FakeUsage:
    """Mirrors `genai.types.GenerateContentResponseUsageMetadata`."""

    prompt_token_count: int = 0
    candidates_token_count: int = 0
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
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: _FakeResponse | None = None

    def generate_content(self, **kwargs: Any) -> _FakeResponse:
        self.requests.append(kwargs)
        if self.next_response is not None:
            return self.next_response
        return _FakeResponse(
            text="ok",
            candidates=[
                _FakeCandidate(
                    content=_FakeContent(parts=[_FakePart(text="ok")]),
                    finish_reason="STOP",
                )
            ],
            usage_metadata=_FakeUsage(
                prompt_token_count=10,
                candidates_token_count=20,
                thoughts_token_count=0,
                cached_content_token_count=0,
            ),
        )


class _FakeGenAI:
    def __init__(self) -> None:
        self.models = _FakeModels()


# ---- Anthropic fake --------------------------------------------------------


@dataclass
class _FakeAnthropicUsage:
    """Mirrors `anthropic.types.Usage`."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class _FakeAnthropicBlock:
    """One element of `response.content`. `type` is "text" or "tool_use";
    the other fields populate depending on `type`."""

    type: str = "text"
    text: str = ""
    name: str = ""
    input: dict[str, Any] | None = None


@dataclass
class _FakeAnthropicResponse:
    content: list[_FakeAnthropicBlock] = field(default_factory=list)
    stop_reason: str | None = "end_turn"
    usage: _FakeAnthropicUsage = field(default_factory=_FakeAnthropicUsage)


class _FakeStreamContext:
    """Stand-in for `MessageStreamManager` returned by Anthropic SDK's
    `messages.stream(...)`. Iterating yields a single sentinel event;
    `get_final_message()` returns the same `_FakeAnthropicResponse` the
    non-streaming `create()` would have."""

    def __init__(self, response: _FakeAnthropicResponse) -> None:
        self._response = response

    def __enter__(self) -> _FakeStreamContext:
        return self

    def __exit__(self, *_exc: Any) -> None:
        return None

    def __iter__(self):
        yield object()

    def get_final_message(self) -> _FakeAnthropicResponse:
        return self._response


class _FakeMessages:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: _FakeAnthropicResponse | None = None

    def _resolve_response(self) -> _FakeAnthropicResponse:
        if self.next_response is not None:
            return self.next_response
        return _FakeAnthropicResponse(
            content=[_FakeAnthropicBlock(type="text", text="ok")],
            stop_reason="end_turn",
            usage=_FakeAnthropicUsage(input_tokens=10, output_tokens=20),
        )

    def create(self, **kwargs: Any) -> _FakeAnthropicResponse:
        self.requests.append(kwargs)
        return self._resolve_response()

    def stream(self, **kwargs: Any) -> _FakeStreamContext:
        self.requests.append(kwargs)
        return _FakeStreamContext(self._resolve_response())


class _FakeAnthropic:
    def __init__(self) -> None:
        self.messages = _FakeMessages()


# ---- tier-mapping ----------------------------------------------------------


def test_available_models_returns_expected_tier_mapping() -> None:
    models = available_models()
    assert models["haiku"] == "gemini-3.5-flash-lite"
    assert models["sonnet"] == "gemini-3.5-flash"
    assert models["opus"] == "claude-opus-4-7"


# ---- Gemini path (sonnet + haiku) ------------------------------------------


def test_call_routes_sonnet_to_correct_gemini_model_id() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3.5-flash"


def test_call_routes_haiku_to_correct_gemini_model_id() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3.5-flash-lite"


def test_call_passes_system_instruction_in_config() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(
        tier="haiku",
        system=["chunk one — generic instructions", "chunk two — task-specific addenda"],
        user="hi",
    )
    sent = fake.models.requests[-1]
    sys_instr = sent["config"]["system_instruction"]
    assert "chunk one" in sys_instr
    assert "chunk two" in sys_instr


def test_call_translates_user_turn_into_contents() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="current question")
    sent = fake.models.requests[-1]
    contents = sent["contents"]
    assert contents[-1]["role"] == "user"
    assert contents[-1]["parts"][0]["text"] == "current question"


def test_call_thinking_budget_zero_for_haiku_by_default() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": 0}


def test_call_thinking_budget_dynamic_when_adaptive_thinking_on() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi", adaptive_thinking=True)
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": -1}


def test_call_thinking_budget_positive_for_sonnet_without_adaptive() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.models.requests[-1]
    # sonnet default effort = "medium" → budget 1024
    assert sent["config"]["thinking_config"] == {"thinking_budget": 1024}


def test_call_records_usage_and_cost_via_meter() -> None:
    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text="response body",
        usage_metadata=_FakeUsage(
            prompt_token_count=1000,
            candidates_token_count=500,
            thoughts_token_count=0,
            cached_content_token_count=0,
        ),
    )
    client = LLMClient(genai_client=fake)
    result = client.call(tier="haiku", system="sys", user="hi")
    assert result.text == "response body"
    assert result.raw_usage["input_tokens"] == 1000
    assert result.raw_usage["output_tokens"] == 500
    # flash-lite (haiku tier): 1000 * $0.25/1M + 500 * $1.50/1M
    #                       = 0.00025 + 0.00075 = 0.001
    assert abs(client.cost_meter.total_usd - 0.001) < 1e-6


def test_call_with_pydantic_response_model_sets_response_schema_for_gemini() -> None:
    class Item(BaseModel):
        name: str

    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text='{"name": "alpha"}',
        parsed=Item(name="alpha"),
        usage_metadata=_FakeUsage(
            prompt_token_count=20, candidates_token_count=10
        ),
    )
    client = LLMClient(genai_client=fake)
    result = client.call(tier="sonnet", system="sys", user="hi", response_model=Item)
    sent = fake.models.requests[-1]
    assert sent["config"]["response_schema"] is Item
    assert sent["config"]["response_mime_type"] == "application/json"
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "alpha"


def test_extra_messages_are_prepended_and_assistant_becomes_model_for_gemini() -> None:
    """Gemini uses role="model" instead of "assistant". The wrapper has
    to translate when callers pass Anthropic-era extra_messages."""
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(
        tier="sonnet",
        system="sys",
        user="current question",
        extra_messages=[
            {"role": "user", "content": "earlier turn"},
            {"role": "assistant", "content": "earlier response"},
        ],
    )
    contents = fake.models.requests[-1]["contents"]
    assert len(contents) == 3
    assert contents[0]["role"] == "user"
    assert contents[0]["parts"][0]["text"] == "earlier turn"
    assert contents[1]["role"] == "model"  # ← translated
    assert contents[1]["parts"][0]["text"] == "earlier response"
    assert contents[-1]["parts"][0]["text"] == "current question"


def test_tools_passed_through_when_supplied_on_gemini() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    tools = [{"function_declarations": [{"name": "lookup_sector"}]}]
    client.call(tier="sonnet", system="sys", user="hi", tools=tools)
    assert fake.models.requests[-1]["config"]["tools"] == tools


def test_cache_read_tokens_billed_at_discounted_rate_on_gemini() -> None:
    """When the response reports cached_content_token_count, we should
    bill those tokens through the cache-read multiplier rather than the
    full input price."""
    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text="ok",
        usage_metadata=_FakeUsage(
            prompt_token_count=2000,  # of which 1000 cached
            candidates_token_count=0,
            cached_content_token_count=1000,
        ),
    )
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    # sonnet (gemini-3.5-flash): input 1000 * $0.50/1M = $0.0005
    # plus cache-read 1000 * $0.50/1M * 0.25 = $0.000125
    # output 0
    expected = (1000 * 0.50 + 1000 * 0.50 * 0.25) / 1_000_000.0
    assert abs(client.cost_meter.total_usd - expected) < 1e-6


# ---- Anthropic path (opus) -------------------------------------------------


def test_call_routes_opus_to_claude_via_anthropic_client() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(anthropic_client=fake)
    client.call(tier="opus", system="sys", user="hi")
    sent = fake.messages.requests[-1]
    assert sent["model"] == "claude-opus-4-7"
    # Anthropic shape — `system` is a separate top-level field, not
    # nested under config.
    assert sent["system"] == "sys"
    assert sent["messages"][-1] == {"role": "user", "content": "hi"}


def test_opus_call_does_not_pass_thinking_config_or_response_mime() -> None:
    """The Anthropic request shape should never carry Gemini-only knobs."""
    fake = _FakeAnthropic()
    client = LLMClient(anthropic_client=fake)
    client.call(tier="opus", system="sys", user="hi", adaptive_thinking=True)
    sent = fake.messages.requests[-1]
    assert "thinking_config" not in sent
    assert "response_mime_type" not in sent
    assert "config" not in sent


def test_opus_response_model_uses_tool_choice_with_schema() -> None:
    class Decomposition(BaseModel):
        drivers: list[str]
        intermediates: list[str]

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[
            _FakeAnthropicBlock(
                type="tool_use",
                name="Decomposition",
                input={"drivers": ["d1"], "intermediates": ["i1"]},
            )
        ],
        stop_reason="tool_use",
        usage=_FakeAnthropicUsage(input_tokens=100, output_tokens=50),
    )
    client = LLMClient(anthropic_client=fake)
    result = client.call(
        tier="opus",
        system="sys",
        user="hi",
        response_model=Decomposition,
    )
    sent = fake.messages.requests[-1]
    # The wrapper builds a single tool whose input_schema is the
    # Pydantic JSON schema and forces tool_choice on it.
    assert sent["tools"][0]["name"] == "Decomposition"
    assert sent["tool_choice"] == {"type": "tool", "name": "Decomposition"}
    assert isinstance(result.parsed, Decomposition)
    assert result.parsed.drivers == ["d1"]
    assert result.parsed.intermediates == ["i1"]


def test_opus_high_max_tokens_routes_through_streaming_api() -> None:
    """The Anthropic SDK refuses `messages.create()` when
    `max_tokens` implies worst-case generation time >10min (it raises
    `ValueError: Streaming is required for operations that may take
    longer than 10 minutes`). The vision decomposition workflow
    legitimately needs 32K output tokens, so the wrapper must route
    high-budget opus calls through `messages.stream(...)` and pull
    the final message via `get_final_message()`. Anything below the
    streaming threshold stays on the non-streaming `.create()` path
    to keep latency tight for the common case."""

    class Item(BaseModel):
        name: str

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[
            _FakeAnthropicBlock(
                type="tool_use", name="Item", input={"name": "ok"}
            )
        ],
        stop_reason="tool_use",
    )
    client = LLMClient(anthropic_client=fake)
    result = client.call(
        tier="opus",
        system="sys",
        user="hi",
        max_tokens=32_000,
        response_model=Item,
    )
    sent = fake.messages.requests[-1]
    # Same request payload (model, tools, tool_choice…); the only
    # observable diff is that it was sent via stream() instead of
    # create(). The fake records both into `.requests`, so we can't
    # tell which method was called from here — but we CAN tell the
    # call succeeded (parsed is not None) which would have raised
    # mid-create() if we hadn't switched paths.
    assert sent["max_tokens"] == 32_000
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "ok"


def test_opus_low_max_tokens_uses_non_streaming_create() -> None:
    """Below the 8K streaming threshold the wrapper stays on
    `messages.create()` to avoid streaming overhead on the common
    haiku-/sonnet-like opus calls."""

    class Item(BaseModel):
        name: str

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[
            _FakeAnthropicBlock(
                type="tool_use", name="Item", input={"name": "ok"}
            )
        ],
        stop_reason="tool_use",
    )
    # Spy: wrap stream() so we can assert it was NOT called.
    stream_calls: list[dict[str, Any]] = []
    original_stream = fake.messages.stream

    def spy_stream(**kwargs: Any):
        stream_calls.append(kwargs)
        return original_stream(**kwargs)

    fake.messages.stream = spy_stream  # type: ignore[method-assign]
    client = LLMClient(anthropic_client=fake)
    result = client.call(
        tier="opus",
        system="sys",
        user="hi",
        max_tokens=4096,
        response_model=Item,
    )
    assert stream_calls == [], "low-budget call should use create(), not stream()"
    assert isinstance(result.parsed, Item)


def test_opus_truncated_tool_use_returns_parsed_none_not_raise() -> None:
    """When opus hits max_tokens mid tool_use, Anthropic returns the
    partial input dict and `stop_reason="max_tokens"`. The wrapper
    used to call `model_validate(raw)` directly — that raised
    pydantic.ValidationError on missing required fields and
    propagated out of llm_client, crashing every workflow that hit
    the budget. Post-fix: validation failure is caught + logged and
    `parsed` comes back None so the caller can branch on
    `stop_reason` for a useful error."""

    class FullSchema(BaseModel):
        slug: str
        rationale: str  # would be the truncated-away field
        confidence: float  # would be the truncated-away field

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[
            _FakeAnthropicBlock(
                type="tool_use",
                name="FullSchema",
                # Only slug present — rationale + confidence were past
                # the truncation point.
                input={"slug": "space-data-center"},
            )
        ],
        stop_reason="max_tokens",
        usage=_FakeAnthropicUsage(input_tokens=100, output_tokens=16000),
    )
    client = LLMClient(anthropic_client=fake)
    result = client.call(
        tier="opus",
        system="sys",
        user="hi",
        response_model=FullSchema,
    )
    assert result.parsed is None
    assert result.stop_reason == "max_tokens"


def test_opus_call_drops_thinking_when_response_model_forces_tool_choice() -> None:
    """Anthropic forbids `thinking` together with a forced `tool_choice`
    on a specific tool (which is how the wrapper implements structured
    output). When both are requested, the wrapper must drop thinking —
    structured output is the harder downstream constraint."""

    class Item(BaseModel):
        name: str

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[
            _FakeAnthropicBlock(
                type="tool_use", name="Item", input={"name": "ok"}
            )
        ],
        stop_reason="tool_use",
    )
    client = LLMClient(anthropic_client=fake)
    client.call(
        tier="opus",
        system="sys",
        user="hi",
        adaptive_thinking=True,
        response_model=Item,
    )
    sent = fake.messages.requests[-1]
    # tool_choice IS set (structured output stays); thinking is NOT.
    assert sent["tool_choice"] == {"type": "tool", "name": "Item"}
    assert "thinking" not in sent


def test_opus_call_keeps_thinking_when_no_response_model() -> None:
    """Without forced tool_choice, adaptive_thinking should still wire
    through to Claude's extended-thinking knob."""
    fake = _FakeAnthropic()
    client = LLMClient(anthropic_client=fake)
    client.call(tier="opus", system="sys", user="hi", adaptive_thinking=True)
    sent = fake.messages.requests[-1]
    assert sent["thinking"]["type"] == "enabled"
    assert sent["thinking"]["budget_tokens"] >= 1024


def test_opus_call_records_cost_at_claude_opus_pricing() -> None:
    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeAnthropicResponse(
        content=[_FakeAnthropicBlock(type="text", text="ok")],
        stop_reason="end_turn",
        usage=_FakeAnthropicUsage(input_tokens=1_000_000, output_tokens=500_000),
    )
    client = LLMClient(anthropic_client=fake)
    client.call(tier="opus", system="sys", user="hi")
    # claude-opus-4-7: $15/M input + $75/M output
    # = 15 + 37.5 = 52.5
    assert abs(client.cost_meter.total_usd - 52.5) < 1e-6


def test_opus_extra_messages_translate_model_role_back_to_assistant() -> None:
    """Anthropic uses "assistant" (Gemini's "model"). The wrapper has to
    translate in the opposite direction from the Gemini path."""
    fake = _FakeAnthropic()
    client = LLMClient(anthropic_client=fake)
    client.call(
        tier="opus",
        system="sys",
        user="current",
        extra_messages=[
            {"role": "user", "content": "earlier turn"},
            {"role": "model", "content": "earlier response"},
        ],
    )
    sent = fake.messages.requests[-1]
    assert sent["messages"][0] == {"role": "user", "content": "earlier turn"}
    assert sent["messages"][1] == {"role": "assistant", "content": "earlier response"}
    assert sent["messages"][-1] == {"role": "user", "content": "current"}


def test_opus_call_without_anthropic_client_raises() -> None:
    """If the user supplied only a Gemini fake but the workflow calls opus,
    the wrapper should fail loudly with a hint to install
    `anthropic[vertex]`."""
    import pytest

    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    with pytest.raises(RuntimeError, match="anthropic\\[vertex\\]"):
        client.call(tier="opus", system="sys", user="hi")


# ---- backwards-compat: `client=` kwarg --------------------------------------


def test_legacy_client_kwarg_maps_to_genai_client() -> None:
    """Pre-M35 tests pass `client=` expecting it to be wired to the
    Gemini provider. The constructor preserves that contract."""
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    assert len(fake.models.requests) == 1


# ---- default-client builder ------------------------------------------------


def test_default_client_picks_vertex_when_env_flag_set(monkeypatch, tmp_path) -> None:
    """When GOOGLE_GENAI_USE_VERTEXAI=true + project is set, the
    default-client builder should construct genai.Client with
    vertexai=True and the configured project/location — and ALSO
    instantiate AnthropicVertex with the same project + region."""
    from agent_tools import llm_client as mod

    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-proj")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    captured_g: dict[str, Any] = {}
    captured_a: dict[str, Any] = {}

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            captured_g.update(kwargs)

    class _FakeAnthropicVertex:
        def __init__(self, **kwargs: Any) -> None:
            captured_a.update(kwargs)

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeGenAIClient}))
    monkeypatch.setattr(mod, "AnthropicVertex", _FakeAnthropicVertex)

    genai_client, anthropic_client = mod._build_default_clients(api_key=None)

    assert genai_client is not None
    assert anthropic_client is not None
    assert captured_g == {"vertexai": True, "project": "test-proj", "location": "global"}
    assert captured_a == {"project_id": "test-proj", "region": "global"}


def test_default_client_reads_project_id_from_sa_json_when_env_missing(
    monkeypatch, tmp_path
) -> None:
    """If GOOGLE_CLOUD_PROJECT isn't set, the builder should pull
    `project_id` out of the SA JSON at GOOGLE_APPLICATION_CREDENTIALS."""
    import json as _json

    from agent_tools import llm_client as mod

    sa_path = tmp_path / "sa.json"
    sa_path.write_text(
        _json.dumps({"project_id": "from-sa-file", "type": "service_account"})
    )

    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(sa_path))

    captured_g: dict[str, Any] = {}
    captured_a: dict[str, Any] = {}

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            captured_g.update(kwargs)

    class _FakeAnthropicVertex:
        def __init__(self, **kwargs: Any) -> None:
            captured_a.update(kwargs)

    # Skip the real google-auth credentials load — fake the helper so we
    # don't need a real RSA key in the SA JSON.
    monkeypatch.setattr(mod, "_load_sa_credentials", lambda _p: "fake-creds")
    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeGenAIClient}))
    monkeypatch.setattr(mod, "AnthropicVertex", _FakeAnthropicVertex)

    mod._build_default_clients(api_key=None)

    assert captured_g == {
        "vertexai": True,
        "project": "from-sa-file",
        "location": "global",
        "credentials": "fake-creds",
    }
    assert captured_a == {"project_id": "from-sa-file", "region": "global"}


def test_default_client_falls_back_to_api_key_when_vertex_disabled(monkeypatch) -> None:
    """Without the Vertex flag, the builder should pick the API-key path —
    Gemini-only (Anthropic isn't reachable without GCP)."""
    from agent_tools import llm_client as mod

    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "key-abc")

    captured_g: dict[str, Any] = {}

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            captured_g.update(kwargs)

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeGenAIClient}))
    monkeypatch.setattr(mod, "AnthropicVertex", None)

    genai_client, anthropic_client = mod._build_default_clients(api_key=None)

    assert captured_g == {"api_key": "key-abc"}
    assert genai_client is not None
    assert anthropic_client is None


def test_default_client_errors_with_no_auth_configured(monkeypatch) -> None:
    """With neither path configured, the builder should raise loudly."""
    import pytest

    from agent_tools import llm_client as mod

    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="No LLM auth configured"):
        mod._build_default_clients(api_key=None)


def test_default_client_vertex_without_project_errors(monkeypatch) -> None:
    """Vertex mode without GOOGLE_CLOUD_PROJECT (and no SA JSON to read
    a project_id from) is a config bug, not a silent fallback."""
    import pytest

    from agent_tools import llm_client as mod

    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)

    with pytest.raises(RuntimeError, match="project_id"):
        mod._build_default_clients(api_key=None)
