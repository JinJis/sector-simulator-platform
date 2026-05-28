"""Shared fixtures — primarily the fake LLM client used by every test
in this suite. Nothing here ever hits the network.

History:
- pre-M34: faked the Anthropic SDK shape directly.
- M34: Claude → Gemini swap.
- M35: brought Claude back for the opus tier (dual-provider fakes).
- F9 (2026-05-28): dropped Claude entirely. All three tiers now route
  through Gemini, and the fake here is a single `generate_content`
  surface. The compat shim that translated config-nested fields up
  to top-level Anthropic-era names (`system` blocks, `thinking` dict,
  `output_format`) is retained because dozens of test assertions still
  read `requests[-1]["system"]` / `["output_format"]` etc.
- Fixture names (`fake_anthropic`, `fake_llm`) are kept for
  blast-radius reasons: many tests already reference them by string.
  `fake_anthropic` is now a Gemini fake despite the name; rename in a
  follow-up if it confuses readers.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from agent_tools import LLMClient
from pydantic import BaseModel

from agent_orchestration.schemas import (
    Decomposition,
    DriverNode,
    IntermediateNode,
    OutputNode,
)


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


class FakeModels:
    """Gemini provider fake. Records every `generate_content()` call
    on `self.requests`. Tests assert against `self.requests[-1]` to
    verify the wrapper passed the expected system + user + config
    shape.

    `parsed_factory` is the per-test hook — set it to a callable that
    returns the desired `parsed` Pydantic model based on the kwargs.
    The shim flattens the config-nested fields up to the top level so
    `_full_pipeline_factory` etc. can look at `output_format` to
    dispatch the way they did in the pre-M34 Anthropic era.
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
        kwargs["thinking"] = self._compat_thinking(config.get("thinking_config"))
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
        # Mark the last block to satisfy invariants in older tests that
        # check for an ephemeral cache_control marker.
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return blocks

    @staticmethod
    def _compat_thinking(thinking_config: Any) -> Any:
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


class FakeGenAI:
    """Single-provider fake. F9 collapsed the dual-provider surface;
    `.messages` is gone."""

    def __init__(self) -> None:
        self.models = FakeModels()


# Back-compat alias — many tests / fixtures still import `FakeAnthropic`
# by name. The class itself is now Gemini-only; the name lingers.
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
    """Single-provider Gemini fake (name kept for blast-radius reasons).
    Default factory returns the sample Decomposition (most common
    case); tests override `parsed_factory` / `next_response`."""
    fake = FakeGenAI()

    def factory(**_kwargs: Any) -> Decomposition:
        return _SAMPLE

    fake.models.parsed_factory = factory
    return fake


@pytest.fixture
def fake_llm(fake_anthropic: FakeGenAI) -> LLMClient:
    return LLMClient(genai_client=fake_anthropic)


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
