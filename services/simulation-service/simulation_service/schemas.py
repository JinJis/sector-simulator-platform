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


class SimMetadata(BaseModel):
    slug: str
    name: str
    description: str
    horizon_years: int
    drivers: list[DriverSchema]
    presets: dict[str, dict[str, float]] = Field(default_factory=dict)


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
    # output name → driver entries sorted by |swing| desc.
    by_output: dict[str, list[SensitivityEntry]]
