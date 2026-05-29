"""VisionFeasibilityView — read-only feasibility-snapshot cockpit page."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class VisionFeasibilityView(_BaseModelView, model=m.VisionFeasibility):
    name = "Feasibility snapshot"
    name_plural = "Feasibility snapshots"
    icon = "fa-solid fa-gauge-high"
    category = "Vision"

    column_list = [
        m.VisionFeasibility.sector_slug,
        m.VisionFeasibility.composite,
        m.VisionFeasibility.binding_capability_key,
        m.VisionFeasibility.eta_median_years,
        m.VisionFeasibility.delta_90d,
        m.VisionFeasibility.is_current,
        m.VisionFeasibility.as_of,
    ]
    column_sortable_list = [
        m.VisionFeasibility.sector_slug,
        m.VisionFeasibility.composite,
        m.VisionFeasibility.as_of,
    ]
    column_default_sort = ("as_of", True)
    can_create = False
    can_edit = False
    can_delete = False
