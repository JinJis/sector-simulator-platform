"""EconomicsDatapointView — read-only economics-time-series cockpit page."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class EconomicsDatapointView(_BaseModelView, model=m.EconomicsDatapoint):
    name = "Economics datapoint"
    name_plural = "Economics datapoints"
    icon = "fa-solid fa-coins"
    category = "Vision"

    column_list = [
        m.EconomicsDatapoint.sector_slug,
        m.EconomicsDatapoint.metric_key,
        m.EconomicsDatapoint.value,
        m.EconomicsDatapoint.unit,
        m.EconomicsDatapoint.as_of,
        m.EconomicsDatapoint.source_kind,
        m.EconomicsDatapoint.confidence,
    ]
    column_sortable_list = [
        m.EconomicsDatapoint.sector_slug,
        m.EconomicsDatapoint.metric_key,
        m.EconomicsDatapoint.as_of,
    ]
    column_default_sort = ("as_of", True)
    can_create = False
    can_edit = False
    can_delete = False
