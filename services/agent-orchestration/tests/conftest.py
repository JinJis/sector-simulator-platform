"""Shared fixtures — primarily the fake Anthropic client used by every test
in this suite. Nothing here ever hits the network."""

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
    input_tokens: int = 100
    output_tokens: int = 200
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class FakeBlock:
    type: str
    text: str = ""


@dataclass
class FakeResponse:
    content: list[FakeBlock] = field(default_factory=list)
    usage: FakeUsage = field(default_factory=FakeUsage)
    stop_reason: str | None = "end_turn"
    parsed_output: Any = None


class FakeMessages:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: FakeResponse | None = None
        self.parsed_factory: Any = None
        """Callable run with the parse() kwargs; returns the parsed value."""

    def _record(self, **kwargs: Any) -> None:
        self.requests.append(kwargs)

    def create(self, **kwargs: Any) -> FakeResponse:
        self._record(**kwargs)
        return self.next_response or FakeResponse(
            content=[FakeBlock(type="text", text="ok")]
        )

    def parse(self, **kwargs: Any) -> FakeResponse:
        self._record(**kwargs)
        if self.next_response is not None:
            return self.next_response
        parsed: Any = None
        if self.parsed_factory is not None:
            parsed = self.parsed_factory(**kwargs)
        return FakeResponse(
            content=[FakeBlock(type="text", text="{}")],
            parsed_output=parsed,
        )


class FakeAnthropic:
    def __init__(self) -> None:
        self.messages = FakeMessages()


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
def fake_anthropic() -> FakeAnthropic:
    """A vanilla fake. Tests can override `next_response` / `parsed_factory`
    before the workflow runs."""
    fake = FakeAnthropic()

    def factory(**kwargs: Any) -> Decomposition:
        return _SAMPLE

    fake.messages.parsed_factory = factory
    return fake


@pytest.fixture
def fake_llm(fake_anthropic: FakeAnthropic) -> LLMClient:
    return LLMClient(client=fake_anthropic)


@pytest.fixture
def sample_decomposition() -> Decomposition:
    return _SAMPLE


@pytest.fixture
def app(fake_llm: LLMClient) -> Iterator[Any]:
    """A fresh FastAPI app with the fake LLM injected. The runner is a new
    instance per test so workflow IDs and state don't bleed across cases."""
    from fastapi.testclient import TestClient

    from agent_orchestration.main import create_app
    from agent_orchestration.workflows import WorkflowRunner

    app = create_app()
    app.state.llm = fake_llm
    app.state.runner = WorkflowRunner()
    with TestClient(app) as client:
        yield client
