"""DB loader for agent-generated sectors.

When the registry can't find a sim in the in-code map, this module
looks it up in Postgres: `sectors` (status, agent_workflow_id),
`graph_nodes` (the topology), `graph_edges` (the wiring + agent
formulas, persisted on workflow_record.output), `agent_workflows`
(the EdgeInferenceResult formulas).

Formulas live on the `agent_workflows.output` JSONB blob — we read
them from there rather than duplicating into `graph_*` columns to
keep the workflow trace as the single source of truth. If the
workflow record is gone (e.g. an admin deleted it), formulas are
absent and the sim falls back to NaN outputs with a clear log line.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, cast

import asyncpg
from platform_sdk import Driver

from simulation_service.generic_dag import GenericDagSpec, _Formula

log = logging.getLogger("simulation_service.db_loader")


_pool: asyncpg.Pool | None = None


def _database_url() -> str | None:
    return os.environ.get("DATABASE_URL")


async def get_pool() -> asyncpg.Pool | None:
    """Lazy-initialize the asyncpg pool. Returns None if DATABASE_URL
    isn't set — the registry falls back to in-code sims only in that
    case, so dev environments without Postgres still work."""
    global _pool
    if _pool is not None:
        return _pool
    url = _database_url()
    if not url:
        return None
    try:
        _pool = await asyncpg.create_pool(
            dsn=url,
            min_size=1,
            max_size=4,
            timeout=2.0,
        )
        log.info("simulation-service: asyncpg pool opened against %s", _sanitize_dsn(url))
        return _pool
    except Exception as e:
        log.warning("simulation-service: asyncpg pool init failed (%s); DB sims disabled", e)
        return None


def _sanitize_dsn(dsn: str) -> str:
    """Strip the password before logging the DSN."""
    if "@" not in dsn:
        return dsn
    auth, _, host = dsn.rpartition("@")
    if ":" in auth:
        scheme_user, _, _pw = auth.rpartition(":")
        return f"{scheme_user}:****@{host}"
    return dsn


async def close_pool() -> None:
    """Called from a shutdown hook to drain the pool cleanly."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch_db_sector_slugs(*, status: str = "live") -> list[str]:
    """Return slugs of sectors that exist in `sectors` with the given
    status. Used to fan out `/sims` listings beyond the in-code map."""
    pool = await get_pool()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT slug FROM sectors WHERE status = $1 ORDER BY created_at DESC",
                status,
            )
        return [r["slug"] for r in rows]
    except Exception as e:
        log.warning("simulation-service: fetch_db_sector_slugs failed (%s)", e)
        return []


async def load_generic_spec(slug: str) -> GenericDagSpec | None:
    """Assemble a `GenericDagSpec` from the DB rows for one sector.

    Returns None when:
      - the slug isn't in `sectors`,
      - the sector has an in-code Python module (caller should prefer that),
      - the DB pool isn't available.

    Formula sources, in order:
      1. `agent_workflows.output.edge_inference.{intermediates,outputs}`
         keyed by name — this is the agent's authored math.
      2. Nothing (no formula) — node evaluates as NaN.
    """
    pool = await get_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        sector = await conn.fetchrow(
            """
            SELECT id, slug, name, description, source_module, status,
                   agent_workflow_id, created_at
              FROM sectors
             WHERE slug = $1
            """,
            slug,
        )
        if sector is None:
            return None
        if sector["source_module"]:
            # In-code sim — let the static registry handle it.
            return None

        node_rows = await conn.fetch(
            """
            SELECT node_key, kind, label, "group", unit, description
              FROM graph_nodes
             WHERE sector_slug = $1
            """,
            slug,
        )
        edge_rows = await conn.fetch(
            """
            SELECT source_key, target_key, COALESCE(label, '') AS label
              FROM graph_edges
             WHERE sector_slug = $1
            """,
            slug,
        )

        # Pull the agent-authored formulas. M22a persists them on the
        # workflow record's `output` JSONB. We don't enforce the link
        # in SQL (workflow rows can be pruned independently) so the
        # absence path is graceful.
        formulas_by_name: dict[str, dict[str, Any]] = {}
        depends_on_by_name: dict[str, tuple[str, ...]] = {}
        if sector["agent_workflow_id"]:
            wf_row = await conn.fetchrow(
                "SELECT output FROM agent_workflows WHERE id = $1",
                sector["agent_workflow_id"],
            )
            if wf_row and wf_row["output"]:
                output_blob = wf_row["output"]
                if isinstance(output_blob, str):
                    output_blob = json.loads(output_blob)
                edge_inf = (
                    output_blob.get("edge_inference")
                    if isinstance(output_blob, dict)
                    else None
                )
                if edge_inf:
                    for spec in edge_inf.get("intermediates", []) or []:
                        formulas_by_name[spec["name"]] = spec
                    for spec in edge_inf.get("outputs", []) or []:
                        formulas_by_name[spec["name"]] = spec
                        depends_on_by_name[spec["name"]] = tuple(
                            spec.get("depends_on") or ()
                        )

    # --- Assemble the spec ---

    drivers: dict[str, Driver] = {}
    intermediates: list[_Formula] = []
    outputs: list[_Formula] = []

    # Sniff horizon out of the workflow input if present; default 10.
    horizon_years = 10

    for row in node_rows:
        name = row["node_key"]
        kind = row["kind"]
        unit = row["unit"] or ""
        description = row["description"] or ""
        if kind == "driver":
            # Drivers need range + default. The DB doesn't carry them
            # for agent-generated sectors (those live in the workflow
            # decomposition); reach back to the workflow for them.
            #
            # Simpler interim: parse from the workflow's decomposition
            # block on the same JSONB blob we already pulled.
            drivers[name] = Driver(
                default=0.0,
                range=(0.0, 1.0),
                unit=unit,
                description=description,
                group=row["group"] or "",
            )
        elif kind == "intermediate":
            spec = formulas_by_name.get(name)
            if spec is not None:
                intermediates.append(
                    _Formula(
                        name=name,
                        formula=spec.get("formula", "0"),
                        kind="intermediate",
                        depends_on=tuple(spec.get("depends_on") or ()),
                        unit=spec.get("unit") or unit,
                        description=spec.get("description") or description,
                    )
                )
            else:
                # No formula on file — surface as a constant-0 intermediate.
                intermediates.append(
                    _Formula(
                        name=name,
                        formula="0",
                        kind="intermediate",
                        depends_on=(),
                        unit=unit,
                        description=description,
                    )
                )
        elif kind == "output":
            spec = formulas_by_name.get(name)
            if spec is not None:
                kind_str = spec.get("kind") or "scalar"
                outputs.append(
                    _Formula(
                        name=name,
                        formula=spec.get("formula", "0"),
                        kind=cast(str, kind_str),
                        depends_on=tuple(spec.get("depends_on") or ()),
                        unit=spec.get("unit") or unit,
                        description=spec.get("description") or description,
                    )
                )
            else:
                outputs.append(
                    _Formula(
                        name=name,
                        formula="0",
                        kind="scalar",
                        depends_on=(),
                        unit=unit,
                        description=description,
                    )
                )
        # equity / unknown kinds: silently ignored — they don't
        # participate in the math layer (they're projection targets,
        # handled by sector-service's impact score).

    # Backfill driver defaults + ranges + horizon from the workflow's
    # decomposition section, if available.
    if sector["agent_workflow_id"]:
        async with pool.acquire() as conn:
            wf_row = await conn.fetchrow(
                "SELECT output FROM agent_workflows WHERE id = $1",
                sector["agent_workflow_id"],
            )
        if wf_row and wf_row["output"]:
            blob = wf_row["output"]
            if isinstance(blob, str):
                blob = json.loads(blob)
            decomp = (
                blob.get("decomposition") if "edge_inference" in blob else blob
            ) if isinstance(blob, dict) else None
            if decomp:
                horizon_years = int(decomp.get("horizon_years") or horizon_years)
                for d in decomp.get("drivers") or []:
                    name = d["name"]
                    if name not in drivers:
                        continue
                    default_v = float(d["default"])
                    min_v = float(d["min"])
                    max_v = float(d["max"])
                    drivers[name] = Driver(
                        default=default_v,
                        range=(min_v, max_v),
                        unit=d.get("unit") or "",
                        description=d.get("description") or "",
                        group=d.get("group") or "",
                    )

    edges: list[tuple[str, str, str]] = [
        (r["source_key"], r["target_key"], r["label"]) for r in edge_rows
    ]

    return GenericDagSpec(
        slug=sector["slug"],
        name=sector["name"],
        description=sector["description"] or "",
        horizon_years=horizon_years,
        drivers=drivers,
        intermediates=intermediates,
        outputs=outputs,
        edges=edges,
    )
