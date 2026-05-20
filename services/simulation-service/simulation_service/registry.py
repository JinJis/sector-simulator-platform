from __future__ import annotations

from platform_sdk import SimulationBase

from simulation_service.sims.placeholder import PlaceholderSim
from simulation_service.sims.space_data_center import SpaceDataCenterSim

_REGISTRY: dict[str, type[SimulationBase]] = {
    SpaceDataCenterSim.slug: SpaceDataCenterSim,
    PlaceholderSim.slug: PlaceholderSim,
}


def all_sims() -> list[type[SimulationBase]]:
    return list(_REGISTRY.values())


def get_sim(slug: str) -> type[SimulationBase]:
    if slug not in _REGISTRY:
        raise KeyError(slug)
    return _REGISTRY[slug]
