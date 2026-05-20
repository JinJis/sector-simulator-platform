"""Shared utilities for the agent-evals harness.

`Case` is the per-test contract: input, optional canned response, and a
list of assertions over the parsed output. `CostBudget` is the upper
bound on what a case may spend; the harness fails a case that overruns.

Cases work in both offline (`FakeAnthropic` returns the canned response)
and live (`ANTHROPIC_EVAL_LIVE=1`, real `Anthropic()` client) modes.
The Python contract is identical in both modes — only the LLMClient's
internal client object differs.
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
    `pytest tests/agent-evals` is cheap to run in CI."""
    return os.environ.get("ANTHROPIC_EVAL_LIVE", "").lower() in {"1", "true", "yes"}


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
    input_tokens: int = 4096
    output_tokens: int = 1024
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
    def __init__(self, canned: BaseModel) -> None:
        self._canned = canned
        self.requests: list[dict[str, Any]] = []

    def _respond(self, **kwargs: Any) -> _FakeResponse:
        self.requests.append(kwargs)
        return _FakeResponse(
            content=[_FakeBlock(type="text", text=self._canned.model_dump_json())],
            usage=_FakeUsage(),
            parsed_output=self._canned,
        )

    def create(self, **kwargs: Any) -> _FakeResponse:
        return self._respond(**kwargs)

    def parse(self, **kwargs: Any) -> _FakeResponse:
        return self._respond(**kwargs)


class _FakeAnthropic:
    def __init__(self, canned: BaseModel) -> None:
        self.messages = _FakeMessages(canned)


def build_llm(case: Case) -> LLMClient:
    """Build an LLMClient suitable for one case. Lives here so tests can
    construct it directly when they don't want the pytest fixture."""
    if is_live_mode():
        return LLMClient()  # uses ANTHROPIC_API_KEY from env
    return LLMClient(client=_FakeAnthropic(case.canned_response))
