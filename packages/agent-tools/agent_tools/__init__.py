"""Agent-tools — LLM client + tool definitions for the agent layer.

Phase 2 entrypoint slice: every agent code path goes through `LLMClient`
so cost logging, prompt caching, and model routing are centralized.
"""

from agent_tools.cost import CostMeter, PricedUsage, model_price
from agent_tools.llm_client import (
    LLMCallResult,
    LLMClient,
    ModelTier,
    available_models,
)
from agent_tools.tools import ToolDef, tool_defs

__all__ = [
    "CostMeter",
    "LLMCallResult",
    "LLMClient",
    "ModelTier",
    "PricedUsage",
    "ToolDef",
    "available_models",
    "model_price",
    "tool_defs",
]
