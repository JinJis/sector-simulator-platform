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


class SimRunRequest(BaseModel):
    drivers: dict[str, float] = Field(default_factory=dict)


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
