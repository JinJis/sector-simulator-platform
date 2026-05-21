from __future__ import annotations

from pydantic import BaseModel, Field


class DriverSchema(BaseModel):
    name: str
    default: float
    min: float
    max: float
    unit: str = ""
    description: str = ""
    group: str = ""


class OutputSchema(BaseModel):
    name: str
    series: list[float] | None = None
    scalar: float | None = None
    unit: str = ""
    description: str = ""


class SourceSchema(BaseModel):
    title: str
    url: str = ""
    excerpt: str = ""
    as_of: str = ""
    kind: str = ""


class HistoryPointSchema(BaseModel):
    date: str
    value: float


class ProvenanceSchema(BaseModel):
    history: list[HistoryPointSchema] = Field(default_factory=list)
    sources: list[SourceSchema] = Field(default_factory=list)
    note: str = ""


class SimMetadata(BaseModel):
    slug: str
    name: str
    description: str
    horizon_years: int
    drivers: list[DriverSchema]
    presets: dict[str, dict[str, float]] = Field(default_factory=dict)
    provenance: dict[str, ProvenanceSchema] = Field(default_factory=dict)


class EdgeWeightInput(BaseModel):
    """One edge-weight override. `weight = 1.0` is the neutral default;
    sims read these at choke points to multiply intermediate values."""

    source: str
    target: str
    weight: float


class SimRunRequest(BaseModel):
    drivers: dict[str, float] = Field(default_factory=dict)
    # Phase 2 epic milestone 9: optional per-edge multipliers. Empty list
    # = legacy hand-coded math (every weight defaults to 1.0). Sector-
    # service reads graph_edges from Postgres and passes them in.
    edge_weights: list[EdgeWeightInput] = Field(default_factory=list)


class SimRunResponse(BaseModel):
    slug: str
    drivers: dict[str, float]
    outputs: list[OutputSchema]


class SensitivityEntry(BaseModel):
    driver: str
    swing: float


class SensitivityResponse(BaseModel):
    slug: str
    by_output: dict[str, list[SensitivityEntry]]


class GraphNodeSchema(BaseModel):
    id: str
    label: str
    kind: str  # "driver" | "intermediate" | "output"
    group: str = ""
    unit: str = ""
    description: str = ""


class GraphEdgeSchema(BaseModel):
    source: str
    target: str
    label: str = ""


class SimGraphResponse(BaseModel):
    slug: str
    nodes: list[GraphNodeSchema] = Field(default_factory=list)
    edges: list[GraphEdgeSchema] = Field(default_factory=list)


class ReportRequest(BaseModel):
    """Generate a textual report for a given driver setting.

    `drivers` is the (possibly partial) override map applied over sector
    defaults. `scenario_name` / `scenario_notes` are optional metadata used
    in the report title + body; pass them through when the report is being
    generated from a saved Scenario row so the markdown can quote it.
    """

    drivers: dict[str, float] = Field(default_factory=dict)
    scenario_name: str | None = None
    scenario_notes: str | None = None
    generated_at: str | None = None  # ISO timestamp; server fills if omitted


class ReportSource(BaseModel):
    title: str
    url: str = ""
    as_of: str = ""
    kind: str = ""
    # Drivers whose provenance cites this source — lets the UI surface "this
    # source backs the X, Y inputs" without re-walking provenance.
    drivers: list[str] = Field(default_factory=list)


class ReportResponse(BaseModel):
    slug: str
    generated_at: str
    markdown: str
    # Deduped citations, in display order. Mirrors the markdown body but
    # exposed structurally so the client can render a sidebar / download a
    # .csv / etc. without re-parsing the body.
    sources: list[ReportSource] = Field(default_factory=list)


class LiveResponse(BaseModel):
    """Live snapshot: time-drifted driver values + immediate sim outputs.

    The drivers are deterministic given the tick, so repeated polling within
    the same tick window returns identical values (frontend can cache).
    """

    slug: str
    tick: int
    timestamp: str  # ISO-8601 UTC
    drivers: dict[str, float]
    outputs: list[OutputSchema]
