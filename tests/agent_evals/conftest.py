"""Shared fixtures for the agent-evals tier.

Most fixtures are *factories* — they return a function that builds a
fresh LLMClient per case. That keeps each parameterized case isolated:
one case's canned response can't leak into another.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

# Make sibling modules (harness.py, cases/) importable without making the
# eval directory a Python package — `tests/agent_evals/` carries a
# hyphen-equivalent role and conflating it with `tests` as a package is
# more trouble than it's worth.
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import pytest
from agent_tools import LLMClient

from harness import Case, build_llm, is_live_mode  # noqa: E402


@pytest.fixture
def llm_for_case() -> Callable[[Case], LLMClient]:
    return build_llm


@pytest.fixture
def eval_mode() -> str:
    return "live" if is_live_mode() else "offline"
