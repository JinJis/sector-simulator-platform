from __future__ import annotations

from pydantic import BaseModel, Field


class DriverSchema(BaseModel):
    name: str
    default: float
    min: float
    max: float
    unit: str = ""
    description: str = ""


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


class SimRunRequest(BaseModel):
    drivers: dict[str, float] = Field(default_factory=dict)


class SimRunResponse(BaseModel):
    slug: str
    drivers: dict[str, float]
    outputs: list[OutputSchema]
