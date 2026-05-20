from __future__ import annotations

import math
import time
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from platform_sdk import SimulationBase

from simulation_service.registry import all_sims, get_sim
from simulation_service.schemas import (
    DriverSchema,
    HistoryPointSchema,
    LiveResponse,
    OutputSchema,
    ProvenanceSchema,
    SensitivityEntry,
    SensitivityResponse,
    SimMetadata,
    SimRunRequest,
    SimRunResponse,
    SourceSchema,
)

app = FastAPI(title="simulation-service", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Live tick window in seconds. Within a tick, /live returns stable values.
LIVE_TICK_SECONDS = 3
# Drift amplitude as a fraction of (max - min) per driver. ±5% of range.
LIVE_AMPLITUDE = 0.05
# Period of the sinusoid, in ticks. ~60 ticks * 3s = 3 minutes per cycle.
LIVE_PERIOD_TICKS = 60.0


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
        provenance={
            name: ProvenanceSchema(
                history=[HistoryPointSchema(date=h.date, value=h.value) for h in p.history],
                sources=[
                    SourceSchema(
                        title=s.title, url=s.url, excerpt=s.excerpt, as_of=s.as_of
                    )
                    for s in p.sources
                ],
                note=p.note,
            )
            for name, p in sim_cls.provenance.items()
        },
    )


def _live_drivers(sim_cls: type[SimulationBase], tick: int) -> dict[str, float]:
    """Deterministic smooth drift around each driver's default value."""
    out: dict[str, float] = {}
    for i, (name, d) in enumerate(sim_cls.drivers.items()):
        amp = (d.range[1] - d.range[0]) * LIVE_AMPLITUDE
        phase = (i * 0.7) % (2 * math.pi)
        delta = amp * math.sin(2 * math.pi * tick / LIVE_PERIOD_TICKS + phase)
        value = d.default + delta
        out[name] = max(d.range[0], min(d.range[1], value))
    return out


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


@app.get("/sims/{slug}/live", response_model=LiveResponse)
def sim_live(slug: str) -> LiveResponse:
    """Mock live feed: smoothly drifting driver values + sim outputs.

    Phase 2 will replace the drift logic with real data-pipeline-service feeds
    keyed off `Provenance.sources`. Until then this is honest about being a
    demo signal.
    """
    try:
        sim_cls = get_sim(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    tick = int(time.time() // LIVE_TICK_SECONDS)
    drivers = _live_drivers(sim_cls, tick)
    outputs = sim_cls().simulate(**drivers)
    return LiveResponse(
        slug=slug,
        tick=tick,
        timestamp=datetime.now(UTC).isoformat(timespec="seconds"),
        drivers=drivers,
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
