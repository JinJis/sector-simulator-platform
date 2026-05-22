"""Shared fixtures — primarily the fake Gemini client used by every
test in this suite. Nothing here ever hits the network.

History: pre-M34 this conftest faked the Anthropic SDK shape. After
the Claude → Gemini swap, the fake mirrors `genai.Client.models`'s
`generate_content` instead. Fixture names kept (`fake_anthropic`,
`fake_llm`) for blast-radius reasons — the existing tests reference
those names by string, and a rename would touch every test file in
the suite.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from agent_tools import LLMClient

from agent_orchestration.schemas import (
    Decomposition,
    DriverNode,
    IntermediateNode,
    OutputNode,
)


@dataclass
class FakeUsage:
    """Mirrors `genai.types.GenerateContentResponseUsageMetadata`.

    Field names match what the SDK actually populates so the
    `LLMClient._extract_usage()` reader walks them correctly.
    """

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
    text: str = "{}"
    parsed: Any = None
    candidates: list[FakeCandidate] = field(default_factory=list)
    usage_metadata: FakeUsage = field(default_factory=FakeUsage)


class FakeModels:
    """Records every `generate_content()` invocation. Tests assert
    against `self.requests[-1]` to verify the wrapper passed the
    expected system + user + config shape.

    The `parsed_factory` field is the per-test hook — set it to a
    callable that returns the desired `parsed` Pydantic model based
    on the kwargs the wrapper sent. Most tests use it to look at
    `config["response_schema"]` and pick the matching sample.
    """

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: FakeResponse | None = None
        self.parsed_factory: Any = None

    def generate_content(self, **kwargs: Any) -> FakeResponse:
        self.requests.append(kwargs)
        if self.next_response is not None:
            return self.next_response
        # Flatten the config shape so existing test assertions that
        # look at `requests[-1]["system"]` etc. keep working — this
        # is a deliberate test-fixture convenience, NOT a contract
        # the wrapper expects from the real SDK.
        config = kwargs.get("config", {}) or {}
        kwargs["system"] = self._compat_system_blocks(config.get("system_instruction"))
        kwargs["thinking"] = self._compat_thinking(config.get("thinking_config"))
        kwargs["output_format"] = config.get("response_schema")
        kwargs["messages"] = self._compat_messages(kwargs.get("contents", []))

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

    # ---- test-fixture compatibility shims ----

    @staticmethod
    def _compat_system_blocks(system_instruction: Any) -> list[dict[str, Any]]:
        """The old Anthropic fake exposed `requests[-1]["system"]` as
        a list of `{type: "text", text, cache_control?}` blocks.
        Existing tests still assert on that shape — synthesize it from
        the Gemini-style `system_instruction` string so we don't have
        to touch every test."""
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
        # test_decomposition_workflow_uses_decomposition_prompt invariant
        # — the wrapper used to mark it; the fake mimics the result.
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    @staticmethod
    def _compat_thinking(thinking_config: Any) -> Any:
        """Some tests assert `sent.get("thinking") == {"type": "adaptive"}`
        (an Anthropic-era shape). We synthesize that when the Gemini
        config asked for the dynamic budget (-1)."""
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
        the Anthropic-era `messages` ([{role, content: str}]) so existing
        test assertions keep working."""
        out: list[dict[str, Any]] = []
        for c in contents:
            if isinstance(c, dict):
                role = c.get("role", "user")
                parts = c.get("parts", []) or []
                text = "".join(
                    p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")
                    for p in parts
                )
                # Translate Gemini's "model" back to "assistant".
                if role == "model":
                    role = "assistant"
                out.append({"role": role, "content": text})
        return out


class FakeGenAI:
    def __init__(self) -> None:
        self.models = FakeModels()

    # `LLMClient` reaches in via `self._client.models.generate_content`,
    # which already matches. The Anthropic-era code path looked up
    # `self._client.messages.{create,parse}`; the FakeMessages alias
    # below preserves that for any test that hasn't been ported yet.
    @property
    def messages(self) -> FakeModels:
        return self.models


# Back-compat alias — tests still import / reference `FakeAnthropic`.
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
    """Vanilla fake. Name kept ("fake_anthropic") for compatibility with
    pre-M34 test files. Tests override `next_response` /
    `parsed_factory` before the workflow runs."""
    fake = FakeGenAI()

    def factory(**kwargs: Any) -> Decomposition:
        return _SAMPLE

    fake.models.parsed_factory = factory
    return fake


@pytest.fixture
def fake_llm(fake_anthropic: FakeGenAI) -> LLMClient:
    return LLMClient(client=fake_anthropic)


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
