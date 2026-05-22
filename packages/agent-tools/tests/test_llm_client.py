"""Offline tests — never touches the network. The Gemini client is faked
so we can assert the wrapper builds the right request shape and routes
the right model.

History: pre-M34 these tests faked the Anthropic SDK shape. After the
Gemini swap, the fake mirrors `genai.Client.models.generate_content`
instead. The `LLMClient` surface (tier, system, user, max_tokens,
response_model, adaptive_thinking) is unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from agent_tools import LLMClient, available_models


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
        # Default: a tiny text response.
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


def test_available_models_returns_expected_tier_mapping() -> None:
    models = available_models()
    assert models["haiku"] == "gemini-3.1-flash-lite"
    assert models["sonnet"] == "gemini-3-flash-preview"
    assert models["opus"] == "gemini-3.1-pro-preview"


def test_call_routes_tier_to_correct_model_id() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3-flash-preview"


def test_call_passes_system_instruction_in_config() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
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
    client = LLMClient(client=fake)
    client.call(tier="haiku", system="sys", user="current question")
    sent = fake.models.requests[-1]
    contents = sent["contents"]
    assert contents[-1]["role"] == "user"
    assert contents[-1]["parts"][0]["text"] == "current question"


def test_call_thinking_budget_zero_for_haiku_by_default() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": 0}


def test_call_thinking_budget_dynamic_when_adaptive_thinking_on() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="opus", system="sys", user="hi", adaptive_thinking=True)
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": -1}


def test_call_thinking_budget_positive_for_sonnet_opus_without_adaptive() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="opus", system="sys", user="hi")
    sent = fake.models.requests[-1]
    # opus default effort = "high" → budget 4096
    assert sent["config"]["thinking_config"] == {"thinking_budget": 4096}
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
    client = LLMClient(client=fake)
    result = client.call(tier="haiku", system="sys", user="hi")
    assert result.text == "response body"
    assert result.raw_usage["input_tokens"] == 1000
    assert result.raw_usage["output_tokens"] == 500
    # flash-lite (haiku tier): 1000 * $0.25/1M + 500 * $1.50/1M
    #                       = 0.00025 + 0.00075 = 0.001
    assert abs(client.cost_meter.total_usd - 0.001) < 1e-6


def test_call_with_pydantic_response_model_sets_response_schema() -> None:
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
    client = LLMClient(client=fake)
    result = client.call(tier="sonnet", system="sys", user="hi", response_model=Item)
    sent = fake.models.requests[-1]
    assert sent["config"]["response_schema"] is Item
    assert sent["config"]["response_mime_type"] == "application/json"
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "alpha"


def test_extra_messages_are_prepended_and_assistant_becomes_model() -> None:
    """Gemini uses role="model" instead of "assistant". The wrapper has
    to translate when callers pass Anthropic-era extra_messages."""
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
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


def test_tools_passed_through_when_supplied() -> None:
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    tools = [{"function_declarations": [{"name": "lookup_sector"}]}]
    client.call(tier="opus", system="sys", user="hi", tools=tools)
    assert fake.models.requests[-1]["config"]["tools"] == tools


def test_default_client_picks_vertex_when_env_flag_set(monkeypatch) -> None:
    """When GOOGLE_GENAI_USE_VERTEXAI=true + project is set, the
    default-client builder should construct genai.Client with
    vertexai=True and the configured project/location — NOT with an
    api_key. Mocks `genai.Client` and asserts the kwargs."""
    from agent_tools import llm_client as mod

    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-proj")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-west1")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeClient}))
    mod._build_default_client(api_key=None)
    assert captured == {"vertexai": True, "project": "test-proj", "location": "us-west1"}


def test_default_client_falls_back_to_api_key_when_vertex_disabled(monkeypatch) -> None:
    """Without the Vertex flag, the builder should pick the API-key path."""
    from agent_tools import llm_client as mod

    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "key-abc")

    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeClient}))
    mod._build_default_client(api_key=None)
    assert captured == {"api_key": "key-abc"}


def test_default_client_errors_with_no_auth_configured(monkeypatch) -> None:
    """With neither path configured, the builder should raise loudly."""
    import pytest

    from agent_tools import llm_client as mod

    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    class _FakeClient:
        def __init__(self, **kwargs):
            pass

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeClient}))
    with pytest.raises(RuntimeError, match="No LLM auth configured"):
        mod._build_default_client(api_key=None)


def test_default_client_vertex_without_project_errors(monkeypatch) -> None:
    """Vertex mode without GOOGLE_CLOUD_PROJECT is a config bug, not a
    silent fallback."""
    import pytest

    from agent_tools import llm_client as mod

    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    class _FakeClient:
        def __init__(self, **kwargs):
            pass

    monkeypatch.setattr(mod, "genai", type("X", (), {"Client": _FakeClient}))
    with pytest.raises(RuntimeError, match="GOOGLE_CLOUD_PROJECT"):
        mod._build_default_client(api_key=None)


def test_cache_read_tokens_billed_at_discounted_rate() -> None:
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
    client = LLMClient(client=fake)
    client.call(tier="opus", system="sys", user="hi")
    # opus (gemini-3.1-pro-preview): input 1000 * $2/1M = $0.002
    # plus cache-read 1000 * $2/1M * 0.25 = $0.0005
    # output 0
    expected = (1000 * 2.00 + 1000 * 2.00 * 0.25) / 1_000_000.0
    assert abs(client.cost_meter.total_usd - expected) < 1e-6
