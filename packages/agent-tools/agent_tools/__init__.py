"""Agent-tools — LLM client + tool definitions for the agent layer.

Phase 2 entrypoint slice: every agent code path goes through `LLMClient`
so cost logging, prompt caching, and model routing are centralized.
"""

from agent_tools.cost import (
    CostMeter,
    PricedUsage,
    deep_research_price_usd,
    model_price,
)
from agent_tools.deep_research import (
    DeepResearchClient,
    DeepResearchResult,
    DeepResearchSurface,
    DeepResearchTier,
    deep_research_model_for,
)
from agent_tools.llm_client import (
    LLMCallResult,
    LLMClient,
    ModelTier,
    available_models,
)
from agent_tools.tools import ToolDef, tool_defs

__all__ = [
    "CostMeter",
    "DeepResearchClient",
    "DeepResearchResult",
    "DeepResearchSurface",
    "DeepResearchTier",
    "LLMCallResult",
    "LLMClient",
    "ModelTier",
    "PricedUsage",
    "ToolDef",
    "available_models",
    "deep_research_model_for",
    "deep_research_price_usd",
    "model_price",
    "tool_defs",
]
