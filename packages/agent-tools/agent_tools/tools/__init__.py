"""Agent tool definitions.

Each `ToolDef` is a JSON-schema-shaped contract the agent layer hands to
Claude via the `tools` parameter on Messages API calls. Tool execution is
NOT in this package — the orchestrator (services/agent-orchestration, a
later slice) consumes `agent.custom_tool_use` events and routes them to
the matching `ToolDef.runner`.

Keep these definitions deterministic and read-only where possible. Agents
that need to mutate platform state (creating sectors, deploying code) get
dedicated approval-gated tools added in a separate slice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class ToolDef:
    """Self-contained tool definition + runner.

    `runner` is optional; tools meant for sandboxed execution (LLM-generated
    code, anything destructive) leave it `None` and route through the
    orchestrator's custom-tool-result flow instead.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    runner: Callable[[dict[str, Any]], Any] | None = None
    # Tags for orchestrator routing — e.g. "read_only", "research".
    tags: tuple[str, ...] = field(default_factory=tuple)

    def to_gemini(self) -> dict[str, Any]:
        """Shape Gemini's `tools=[{function_declarations: [...]}]`
        argument expects per declaration. F9 renamed from `to_anthropic`
        — the JSON Schema shape is the same; only the parameter key
        differs (Gemini: `parameters`; Anthropic: `input_schema`)."""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema,
        }


# ---- Bundled starter tool ------------------------------------------------
#
# This one is intentionally tiny: it lets agents look up the sector
# metadata + driver provenance we already serve via simulation-service.
# That's the most common "what do we know about X already?" question an
# upstream Research Agent will ask before going to the web. The runner is
# left unset here — the orchestrator wires it to the existing sim-service
# tRPC procedures in a later slice.


SECTOR_LOOKUP_TOOL = ToolDef(
    name="lookup_sector",
    description=(
        "Fetch the registered metadata for a sector by slug: drivers (name + "
        "default + range + unit + group + description), presets, and the "
        "per-driver provenance (history points + sources with kind labels). "
        "Use this BEFORE web research to check whether the platform already "
        "has authoritative data for a driver."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "slug": {
                "type": "string",
                "description": "Sector slug — e.g. 'space-data-center'.",
            },
            "include_provenance": {
                "type": "boolean",
                "description": (
                    "When true, returns history + sources for every driver. "
                    "When false, just the driver schema. Default true."
                ),
                "default": True,
            },
        },
        "required": ["slug"],
        "additionalProperties": False,
    },
    tags=("read_only", "lookup"),
)


_BUILTIN: dict[str, ToolDef] = {
    SECTOR_LOOKUP_TOOL.name: SECTOR_LOOKUP_TOOL,
}


def tool_defs() -> dict[str, ToolDef]:
    """All known tool definitions keyed by `name`. Returned as a copy so
    callers can locally extend the set without mutating module state."""
    return dict(_BUILTIN)


__all__ = ["SECTOR_LOOKUP_TOOL", "ToolDef", "tool_defs"]
