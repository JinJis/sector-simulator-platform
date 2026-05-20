"""Offline tests — never touches the network. The Anthropic client is faked
so we can assert the wrapper builds the right request shape and routes the
right model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from agent_tools import LLMClient, available_models


@dataclass
class _FakeUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class _FakeBlock:
    type: str
    text: str = ""


@dataclass
class _FakeResponse:
    content: list[_FakeBlock] = field(default_factory=list)
    usage: _FakeUsage = field(default_factory=_FakeUsage)
    stop_reason: str | None = "end_turn"
    parsed_output: Any = None


class _FakeMessages:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: _FakeResponse | None = None

    def _respond(self, **kwargs: Any) -> _FakeResponse:
        self.requests.append(kwargs)
        if self.next_response is not None:
            return self.next_response
        # Default: a tiny text response with a mix of cache hit + creation.
        return _FakeResponse(
            content=[_FakeBlock(type="text", text="ok")],
            usage=_FakeUsage(
                input_tokens=10,
                output_tokens=20,
                cache_creation_input_tokens=0,
                cache_read_input_tokens=4096,
            ),
        )

    def create(self, **kwargs: Any) -> _FakeResponse:
        return self._respond(**kwargs)

    def parse(self, **kwargs: Any) -> _FakeResponse:
        return self._respond(**kwargs)


class _FakeAnthropic:
    def __init__(self) -> None:
        self.messages = _FakeMessages()


def test_available_models_returns_expected_tier_mapping() -> None:
    models = available_models()
    assert models["haiku"] == "claude-haiku-4-5"
    assert models["sonnet"] == "claude-sonnet-4-6"
    assert models["opus"] == "claude-opus-4-7"


def test_call_routes_tier_to_correct_model_id() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.messages.requests[-1]
    assert sent["model"] == "claude-sonnet-4-6"


def test_call_marks_last_system_block_with_cache_control() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    client.call(
        tier="haiku",
        system=["chunk one — generic instructions", "chunk two — task-specific addenda"],
        user="hi",
    )
    sent = fake.messages.requests[-1]
    sys_blocks = sent["system"]
    assert len(sys_blocks) == 2
    assert "cache_control" not in sys_blocks[0]
    assert sys_blocks[1]["cache_control"] == {"type": "ephemeral"}


def test_call_omits_cache_control_when_caching_disabled() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    client.call(tier="haiku", system="sys", user="hi", cache_system=False)
    sent = fake.messages.requests[-1]
    for block in sent["system"]:
        assert "cache_control" not in block


def test_call_sets_effort_default_per_tier() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    client.call(tier="opus", system="sys", user="hi")
    assert fake.messages.requests[-1]["output_config"] == {"effort": "high"}
    client.call(tier="haiku", system="sys", user="hi")
    assert fake.messages.requests[-1]["output_config"] == {"effort": "medium"}


def test_call_passes_adaptive_thinking_only_when_requested() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    client.call(tier="opus", system="sys", user="hi")
    assert "thinking" not in fake.messages.requests[-1]
    client.call(tier="opus", system="sys", user="hi", adaptive_thinking=True)
    assert fake.messages.requests[-1]["thinking"] == {"type": "adaptive"}


def test_call_records_usage_and_cost_via_meter() -> None:
    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeResponse(
        content=[_FakeBlock(type="text", text="response body")],
        usage=_FakeUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_creation_input_tokens=0,
            cache_read_input_tokens=4096,
        ),
    )
    client = LLMClient(client=fake)
    result = client.call(tier="haiku", system="sys", user="hi")
    assert result.text == "response body"
    assert result.raw_usage["input_tokens"] == 1000
    # Haiku: 1000 * $1/1M + 500 * $5/1M + 4096 * $1/1M * 0.1 (cache read)
    #      = 0.001 + 0.0025 + 0.0004096 = 0.0039096
    assert abs(client.cost_meter.total_usd - 0.0039096) < 1e-6


def test_call_with_pydantic_response_model_uses_parse_endpoint() -> None:
    class Item(BaseModel):
        name: str

    fake = _FakeAnthropic()
    fake.messages.next_response = _FakeResponse(
        content=[_FakeBlock(type="text", text='{"name": "alpha"}')],
        usage=_FakeUsage(input_tokens=20, output_tokens=10),
        parsed_output=Item(name="alpha"),
    )
    client = LLMClient(client=fake)
    result = client.call(
        tier="sonnet", system="sys", user="hi", response_model=Item
    )
    # Verify the request asked for structured output.
    sent = fake.messages.requests[-1]
    assert sent["output_format"] is Item
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "alpha"


def test_extra_messages_are_prepended_before_user_turn() -> None:
    fake = _FakeAnthropic()
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
    msgs = fake.messages.requests[-1]["messages"]
    assert len(msgs) == 3
    assert msgs[0]["content"] == "earlier turn"
    assert msgs[-1]["content"] == "current question"


def test_tools_passed_through_when_supplied() -> None:
    fake = _FakeAnthropic()
    client = LLMClient(client=fake)
    tools = [
        {"name": "lookup_sector", "description": "x", "input_schema": {"type": "object"}}
    ]
    client.call(tier="opus", system="sys", user="hi", tools=tools)
    assert fake.messages.requests[-1]["tools"] == tools
