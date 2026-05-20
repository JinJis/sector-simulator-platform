from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from platform_sdk import SimulationBase

from simulation_service.registry import all_sims, get_sim
from simulation_service.schemas import (
    DriverSchema,
    OutputSchema,
    SensitivityEntry,
    SensitivityResponse,
    SimMetadata,
    SimRunRequest,
    SimRunResponse,
)

app = FastAPI(title="simulation-service", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _metadata(sim_cls: type[SimulationBase]) -> SimMetadata:
    return SimMetadata(
        slug=sim_cls.slug,
        name=sim_cls.name,
        description=sim_cls.description,
        horizon_years=sim_cls.horizon_years,
        drivers=[
            DriverSchema(
                name=name,
                default=d.default,
                min=d.range[0],
                max=d.range[1],
                unit=d.unit,
                description=d.description,
                group=d.group,
            )
            for name, d in sim_cls.drivers.items()
        ],
        presets=dict(sim_cls.presets),
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sims", response_model=list[SimMetadata])
def list_sims() -> list[SimMetadata]:
    return [_metadata(cls) for cls in all_sims()]


@app.get("/sims/{slug}", response_model=SimMetadata)
def get_sim_meta(slug: str) -> SimMetadata:
    try:
        return _metadata(get_sim(slug))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e


@app.post("/sims/{slug}/run", response_model=SimRunResponse)
def run_sim(slug: str, req: SimRunRequest) -> SimRunResponse:
    try:
        sim_cls = get_sim(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    try:
        resolved = sim_cls.resolve_drivers(req.drivers)
        outputs = sim_cls().simulate(**resolved)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return SimRunResponse(
        slug=slug,
        drivers=resolved,
        outputs=[
            OutputSchema(
                name=name,
                series=out.series,
                scalar=out.scalar,
                unit=out.unit,
                description=out.description,
            )
            for name, out in outputs.items()
        ],
    )


@app.get("/sims/{slug}/sensitivity", response_model=SensitivityResponse)
def sim_sensitivity(slug: str) -> SensitivityResponse:
    try:
        sim_cls = get_sim(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    raw = sim_cls().sensitivity()
    by_output: dict[str, list[SensitivityEntry]] = {}
    for out_name, drivers in raw.items():
        entries = [SensitivityEntry(driver=d, swing=s) for d, s in drivers.items()]
        entries.sort(key=lambda e: abs(e.swing), reverse=True)
        by_output[out_name] = entries
    return SensitivityResponse(slug=slug, by_output=by_output)
