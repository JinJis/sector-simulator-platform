"""Agent-tools — LLM client + grounded research + tool definitions.

Phase 2 entrypoint slice: every agent code path goes through `LLMClient`
so cost logging, prompt caching, and model routing are centralized.

Phase 4 (post-merger): grounded research replaces the deprecated Vertex
Deep Research preview API. The legacy `DeepResearch*` names are still
exported as aliases for downstream code that hasn't been re-imported
yet — they point at the new GroundedResearch* implementations.
"""

from agent_tools.cost import (
    CostMeter,
    PricedUsage,
    deep_research_price_usd,
    model_price,
)
from agent_tools.grounded_research import (
    GroundedCitation,
    GroundedResearchClient,
    GroundedResearchResult,
    GroundedResearchSurface,
    GroundedResearchTier,
    grounded_model_for,
)
from agent_tools.llm_client import (
    LLMCallResult,
    LLMClient,
    ModelTier,
    available_models,
)
from agent_tools.tools import ToolDef, tool_defs

# ---- Legacy DR aliases (delete once downstream is fully migrated) ----
# Kept so `from agent_tools import DeepResearchClient` still works
# during the migration window. Same object — the alias is a name only.
DeepResearchClient = GroundedResearchClient
DeepResearchResult = GroundedResearchResult
DeepResearchSurface = GroundedResearchSurface
DeepResearchTier = GroundedResearchTier
deep_research_model_for = grounded_model_for


__all__ = [
    "CostMeter",
    "DeepResearchClient",  # legacy alias
    "DeepResearchResult",  # legacy alias
    "DeepResearchSurface",  # legacy alias
    "DeepResearchTier",  # legacy alias
    "GroundedCitation",
    "GroundedResearchClient",
    "GroundedResearchResult",
    "GroundedResearchSurface",
    "GroundedResearchTier",
    "LLMCallResult",
    "LLMClient",
    "ModelTier",
    "PricedUsage",
    "ToolDef",
    "available_models",
    "deep_research_model_for",  # legacy alias
    "deep_research_price_usd",  # deprecated shim, see cost.py
    "grounded_model_for",
    "model_price",
    "tool_defs",
]
