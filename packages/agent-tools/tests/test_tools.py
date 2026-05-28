from __future__ import annotations

from agent_tools import tool_defs
from agent_tools.tools import SECTOR_LOOKUP_TOOL


def test_tool_defs_includes_starter_lookup_sector() -> None:
    defs = tool_defs()
    assert "lookup_sector" in defs
    assert defs["lookup_sector"] is SECTOR_LOOKUP_TOOL


def test_tool_def_serializes_to_gemini_shape() -> None:
    payload = SECTOR_LOOKUP_TOOL.to_gemini()
    assert payload["name"] == "lookup_sector"
    assert "description" in payload
    # Gemini's function_declarations use `parameters` (not Anthropic's
    # `input_schema`) for the JSON Schema body. The shape inside is
    # identical.
    schema = payload["parameters"]
    assert schema["type"] == "object"
    # Schema must declare `slug` as required + describe `include_provenance`.
    assert "slug" in schema["required"]
    assert "include_provenance" in schema["properties"]
    # Strict shape — important for the function-calling runner.
    assert schema["additionalProperties"] is False


def test_tool_defs_is_a_copy_not_a_live_view() -> None:
    """Mutating the result must not affect the module-level registry."""
    snapshot = tool_defs()
    snapshot.clear()
    assert "lookup_sector" in tool_defs()
