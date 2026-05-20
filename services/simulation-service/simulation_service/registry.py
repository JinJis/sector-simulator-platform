from __future__ import annotations

from platform_sdk import SimulationBase

from simulation_service.sims.memory_semi import MemorySemiSim
from simulation_service.sims.placeholder import PlaceholderSim
from simulation_service.sims.sofc import SOFCSim
from simulation_service.sims.space_data_center import SpaceDataCenterSim

# Order here = order in /sims listing = order in the UI sector picker.
_REGISTRY: dict[str, type[SimulationBase]] = {
    SpaceDataCenterSim.slug: SpaceDataCenterSim,
    MemorySemiSim.slug: MemorySemiSim,
    SOFCSim.slug: SOFCSim,
    PlaceholderSim.slug: PlaceholderSim,
}


def all_sims() -> list[type[SimulationBase]]:
    return list(_REGISTRY.values())


def get_sim(slug: str) -> type[SimulationBase]:
    if slug not in _REGISTRY:
        raise KeyError(slug)
    return _REGISTRY[slug]
