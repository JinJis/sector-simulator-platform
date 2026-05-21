"""Sim registry — static in-code map + DB-backed fallback (M22b).

Resolution order for a slug:

  1. In-code Python class (`_REGISTRY`) — the hand-authored sims.
  2. DB-loaded `GenericDagSim` instance — agent-proposed sectors that
     made it past `sector.proposeFromAgent` and have status=live (or
     draft, when the admin app explicitly looks them up).

The DB path is cached per process so repeated `/sims/{slug}/run` calls
don't re-query Postgres for the topology. Cache invalidation:
sector-service POSTs `/sims/{slug}/reload` after every graph or sector
mutation; that endpoint clears the entry.
"""

from __future__ import annotations

import asyncio
import logging

from platform_sdk import SimulationBase

from simulation_service.db_loader import (
    fetch_db_sector_slugs,
    load_generic_spec,
)
from simulation_service.generic_dag import (
    GenericDagSim,
    GenericDagSpec,
    make_generic_dag_class,
)
from simulation_service.sims.memory_semi import MemorySemiSim
from simulation_service.sims.placeholder import PlaceholderSim
from simulation_service.sims.sofc import SOFCSim
from simulation_service.sims.space_data_center import SpaceDataCenterSim

log = logging.getLogger("simulation_service.registry")

# Order here = order in /sims listing = order in the UI sector picker.
_REGISTRY: dict[str, type[SimulationBase]] = {
    SpaceDataCenterSim.slug: SpaceDataCenterSim,
    MemorySemiSim.slug: MemorySemiSim,
    SOFCSim.slug: SOFCSim,
    PlaceholderSim.slug: PlaceholderSim,
}

# Per-process cache of DB-loaded sims. Keyed by slug; the value is the
# dynamically-built `GenericDagSim` subclass (NOT an instance — the SDK
# contract is class-based).
_DB_CACHE: dict[str, type[GenericDagSim]] = {}


def all_sims() -> list[type[SimulationBase]]:
    """Synchronous list of in-code sims, kept for backwards compat
    (used by tests + the synchronous `_metadata` paths in main.py)."""
    return list(_REGISTRY.values())


async def all_sims_async() -> list[type[SimulationBase]]:
    """Full sim catalog including DB-backed agent-generated sectors.
    Cache-prefers entries already loaded; new live DB sectors get their
    `GenericDagSim` class built on first surface."""
    out: list[type[SimulationBase]] = list(_REGISTRY.values())
    try:
        db_slugs = await fetch_db_sector_slugs(status="live")
    except Exception as e:
        log.warning("registry: failed to enumerate DB sectors (%s)", e)
        return out
    for slug in db_slugs:
        if slug in _REGISTRY:
            continue  # in-code wins
        cls = _DB_CACHE.get(slug)
        if cls is None:
            cls = await _try_load(slug)
            if cls is None:
                continue
        out.append(cls)
    return out


def get_sim(slug: str) -> type[SimulationBase]:
    """Synchronous lookup — in-code map only. Used by paths that can't
    await (the report builder runs from a sync FastAPI handler today)."""
    if slug in _REGISTRY:
        return _REGISTRY[slug]
    cached = _DB_CACHE.get(slug)
    if cached is not None:
        return cached
    raise KeyError(slug)


async def get_sim_async(slug: str) -> type[SimulationBase]:
    """Async lookup that falls back to the DB loader for agent-
    generated sectors. Raises KeyError if the slug is unknown
    everywhere."""
    if slug in _REGISTRY:
        return _REGISTRY[slug]
    cached = _DB_CACHE.get(slug)
    if cached is not None:
        return cached
    cls = await _try_load(slug)
    if cls is None:
        raise KeyError(slug)
    return cls


async def _try_load(slug: str) -> type[GenericDagSim] | None:
    """Best-effort spec load + class construction. Caches successful
    builds; logs and returns None on any failure path so the FastAPI
    handler can return a clean 404 / 500 to the caller."""
    try:
        spec: GenericDagSpec | None = await load_generic_spec(slug)
    except Exception as e:
        log.warning("registry: load_generic_spec(%s) failed (%s)", slug, e)
        return None
    if spec is None:
        return None
    cls = make_generic_dag_class(spec)
    _DB_CACHE[slug] = cls
    log.info(
        "registry: built GenericDagSim for slug=%s (drivers=%d, intermediates=%d, outputs=%d)",
        slug,
        len(spec.drivers),
        len(spec.intermediates),
        len(spec.outputs),
    )
    return cls


def invalidate(slug: str) -> None:
    """Drop the cached DB-loaded sim for `slug` so the next access
    re-reads the topology. Called by the `/sims/{slug}/reload` HTTP
    endpoint after sector-service mutations.
    """
    _DB_CACHE.pop(slug, None)


def invalidate_all() -> None:
    """Drop every DB-cache entry. Use on bulk operations (re-seed,
    reset) where invalidating one-by-one would be tedious."""
    _DB_CACHE.clear()


# ---- Convenience: bridge sync helpers to the async loader -----------------


def get_sim_sync_or_db(slug: str) -> type[SimulationBase]:
    """For the few sync code paths (report builder) that still need a
    DB-backed sim, expose a sync wrapper around `get_sim_async`. Uses
    `asyncio.run()` so it must not be called from within an event loop;
    those callers should switch to `get_sim_async` instead."""
    try:
        return get_sim(slug)
    except KeyError:
        pass
    return asyncio.run(get_sim_async(slug))
