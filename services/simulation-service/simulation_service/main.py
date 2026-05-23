from __future__ import annotations

import math
import time
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from platform_sdk import EdgeWeights, SimulationBase

from simulation_service.registry import (
    all_sims_async,
    get_sim_async,
    invalidate,
    invalidate_all,
)
from simulation_service.report import build_report
from simulation_service.schemas import (
    DriverSchema,
    EdgeWeightInput,
    GraphEdgeSchema,
    GraphNodeSchema,
    HistoryPointSchema,
    LiveResponse,
    OutputSchema,
    ProvenanceSchema,
    ReportRequest,
    ReportResponse,
    SensitivityEntry,
    SensitivityResponse,
    SimGraphResponse,
    SimMetadata,
    SimRunRequest,
    SimRunResponse,
    SourceSchema,
)


def _to_edge_weights(items: list[EdgeWeightInput]) -> EdgeWeights:
    """Translate the FastAPI request payload into an EdgeWeights dict.

    Missing pairs default to 1.0 at lookup time; we only need to add
    entries that diverge from neutral.
    """
    ew = EdgeWeights()
    for item in items:
        if abs(item.weight - 1.0) < 1e-12:
            # Skip neutral edges so the lookup map stays small.
            continue
        ew[(item.source, item.target)] = item.weight
    return ew

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
                        title=s.title,
                        url=s.url,
                        excerpt=s.excerpt,
                        as_of=s.as_of,
                        kind=s.kind,
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


@app.post("/sims/{slug}/reload", status_code=204)
async def reload_sim(slug: str) -> None:
    """Drop the cached GenericDagSim subclass for `slug` so the next
    sim.* request re-reads the DB.

    Called by sector-service after every graph or sector mutation —
    keeps the agent-generated sim's runtime view in sync with the
    Postgres source of truth. No-op for in-code sims (they ignore the
    cache invalidation since they're class objects, not DB-derived).
    """
    invalidate(slug)
    return None


@app.post("/sims/_reload-all", status_code=204)
async def reload_all_sims() -> None:
    """Bulk invalidation for the cases where sector-service does
    something graph-wide (re-seed, reset). Cheaper than enumerating
    every slug to call /sims/{slug}/reload."""
    invalidate_all()
    return None


@app.on_event("shutdown")
async def _shutdown() -> None:
    """Drain the asyncpg pool on graceful shutdown so the next process
    boot doesn't hit `connection slot full`."""
    from simulation_service.db_loader import close_pool

    await close_pool()


@app.get("/sims", response_model=list[SimMetadata])
async def list_sims() -> list[SimMetadata]:
    return [_metadata(cls) for cls in await all_sims_async()]


@app.get("/sims/{slug}", response_model=SimMetadata)
async def get_sim_meta(slug: str) -> SimMetadata:
    try:
        return _metadata(await get_sim_async(slug))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e


@app.post("/sims/{slug}/run", response_model=SimRunResponse)
async def run_sim(slug: str, req: SimRunRequest) -> SimRunResponse:
    try:
        sim_cls = await get_sim_async(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    try:
        resolved = sim_cls.resolve_drivers(req.drivers)
        edge_weights = _to_edge_weights(req.edge_weights)
        # GenericDagSim subclasses pick up the spec from their class
        # attribute (set by make_generic_dag_class); in-code sims
        # ignore the unused kwarg. Both honor edge_weights.
        outputs = sim_cls(edge_weights=edge_weights).simulate(**resolved)
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
async def sim_sensitivity(slug: str) -> SensitivityResponse:
    try:
        sim_cls = await get_sim_async(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    raw = sim_cls().sensitivity()
    by_output: dict[str, list[SensitivityEntry]] = {}
    for out_name, drivers in raw.items():
        entries = [SensitivityEntry(driver=d, swing=s) for d, s in drivers.items()]
        entries.sort(key=lambda e: abs(e.swing), reverse=True)
        by_output[out_name] = entries
    return SensitivityResponse(slug=slug, by_output=by_output)


@app.post("/sims/{slug}/report", response_model=ReportResponse)
async def sim_report(slug: str, req: ReportRequest) -> ReportResponse:
    """Templated markdown report. No LLM in this slice — the layout and
    wording is deterministic so caching is trivial and the UI can iterate
    on shape before we spend tokens. Phase 2 will swap the body builder
    for an LLM call (with the templated version as fallback)."""
    try:
        sim_cls = await get_sim_async(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    try:
        resolved = sim_cls.resolve_drivers(req.drivers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return build_report(sim_cls=sim_cls, req=req, resolved_drivers=resolved)


@app.get("/sims/{slug}/graph", response_model=SimGraphResponse)
async def sim_graph(slug: str) -> SimGraphResponse:
    """Causal dependency graph: drivers → intermediates → outputs.

    Authored by hand on each `SimulationBase` subclass for now (Phase 2
    early slice). Returns empty nodes/edges if the sim hasn't declared a
    graph yet, so the frontend can render a placeholder rather than 404.
    """
    try:
        sim_cls = await get_sim_async(slug)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"sim not found: {slug}") from e

    g = sim_cls.graph
    return SimGraphResponse(
        slug=slug,
        nodes=[
            GraphNodeSchema(
                id=n.id,
                label=n.label,
                kind=n.kind,
                group=n.group,
                unit=n.unit,
                description=n.description,
            )
            for n in g.nodes
        ],
        edges=[
            GraphEdgeSchema(source=e.source, target=e.target, label=e.label)
            for e in g.edges
        ],
    )


@app.get("/sims/{slug}/live", response_model=LiveResponse)
async def sim_live(slug: str) -> LiveResponse:
    """Mock live feed: smoothly drifting driver values + sim outputs.

    Phase 2 will replace the drift logic with real data-pipeline-service feeds
    keyed off `Provenance.sources`. Until then this is honest about being a
    demo signal.
    """
    try:
        sim_cls = await get_sim_async(slug)
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


# =====================================================================
# M40 — Feasibility recompute endpoint
#
# Reads current capability scores from the DB, aggregates per-capability
# composites and the vision composite (with binding-constraint logic),
# fits an ETA from recent vision_feasibility history, and writes a new
# VisionFeasibility row (is_current=true, prior demoted).
#
# Called by:
#   - data-pipeline's recompute_feasibility cron (daily, after signal
#     ingest + ScoreUpdater agent has written new capability_scores)
#   - admin manual trigger via sector-service's `feasibility.recompute`
#     tRPC mutation
# =====================================================================


@app.post("/feasibility/recompute/{slug}", status_code=200)
async def feasibility_recompute(slug: str) -> dict:
    """Recompute vision feasibility from current capability scores.

    Returns:
        Snapshot summary { composite, p10, p90, binding_capability_key,
        eta_median_years }. Caller uses this for logs + observability;
        the durable record is in vision_feasibility.
    """
    from simulation_service.db_loader import get_pool
    from simulation_service.feasibility import (
        CapabilityForVision,
        aggregate_vision,
        compute_delta_90d,
        estimate_eta,
    )
    from simulation_service.feasibility.eta import TrajectoryPoint

    pool = await get_pool()
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL unset — feasibility recompute requires DB",
        )

    async with pool.acquire() as conn:
        sector = await conn.fetchrow(
            "SELECT slug FROM sectors WHERE slug = $1", slug
        )
        if not sector:
            raise HTTPException(status_code=404, detail=f"vision {slug} not found")

        # Current capability composites + weights.
        cap_rows = await conn.fetch(
            """
            SELECT c.key, c.weight,
                   cs.composite, cs.composite_p10, cs.composite_p90
            FROM capabilities c
            LEFT JOIN capability_scores cs
              ON cs.capability_id = c.id AND cs.is_current = TRUE
            WHERE c.sector_slug = $1
            """,
            slug,
        )
        caps = [
            CapabilityForVision(
                key=r["key"],
                weight=r["weight"],
                composite=r["composite"],
                composite_p10=r["composite_p10"],
                composite_p90=r["composite_p90"],
            )
            for r in cap_rows
        ]

        # Aggregate.
        agg = aggregate_vision(caps)
        if agg is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"vision {slug} has no capabilities with current scores — "
                    "score updater hasn't run yet"
                ),
            )

        # Pull prior trajectory for ETA + delta_90d. Look back 1 year.
        traj_rows = await conn.fetch(
            """
            SELECT as_of, composite, composite_p10, composite_p90
            FROM vision_feasibility
            WHERE sector_slug = $1
              AND as_of >= NOW() - INTERVAL '365 days'
            ORDER BY as_of ASC
            """,
            slug,
        )
        # asyncpg returns naive datetimes from TIMESTAMP columns; force
        # UTC-aware so we can mix with datetime.now(UTC) for the synthetic
        # "current point" without TypeError on sort.
        trajectory = [
            TrajectoryPoint(
                as_of=(
                    r["as_of"].replace(tzinfo=UTC)
                    if r["as_of"].tzinfo is None
                    else r["as_of"]
                ),
                composite=r["composite"],
                composite_p10=r["composite_p10"],
                composite_p90=r["composite_p90"],
            )
            for r in traj_rows
        ]

        # Synthesize "current point" — what ETA + delta treat as today.
        now_point = TrajectoryPoint(
            as_of=datetime.now(UTC),
            composite=agg.composite,
            composite_p10=agg.composite_p10,
            composite_p90=agg.composite_p90,
        )
        eta = estimate_eta(trajectory + [now_point])
        delta_90d = compute_delta_90d(trajectory + [now_point])

        # Demote prior current + insert new in one tx.
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE vision_feasibility
                SET is_current = FALSE
                WHERE sector_slug = $1 AND is_current = TRUE
                """,
                slug,
            )
            await conn.execute(
                """
                INSERT INTO vision_feasibility (
                  id, sector_slug, as_of, is_current,
                  composite, composite_p10, composite_p90,
                  binding_capability_key,
                  eta_median_years, eta_p10_years, eta_p90_years,
                  delta_90d, rationale, created_at
                )
                VALUES (
                  gen_random_uuid()::text, $1, NOW(), TRUE,
                  $2, $3, $4, $5,
                  $6, $7, $8, $9, $10, NOW()
                )
                """,
                slug,
                agg.composite,
                agg.composite_p10,
                agg.composite_p90,
                agg.binding_capability_key,
                eta.median_years,
                eta.p10_years,
                eta.p90_years,
                delta_90d,
                f"M40 recompute over {len(caps)} capabilities",
            )

    return {
        "composite": agg.composite,
        "composite_p10": agg.composite_p10,
        "composite_p90": agg.composite_p90,
        "binding_capability_key": agg.binding_capability_key,
        "eta_median_years": eta.median_years,
        "eta_p10_years": eta.p10_years,
        "eta_p90_years": eta.p90_years,
        "delta_90d": delta_90d,
        "capability_count": len(caps),
    }
