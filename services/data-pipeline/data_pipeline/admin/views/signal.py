"""SignalView — read-only cockpit page for the extracted-signal stream."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class SignalView(_BaseModelView, model=m.Signal):
    name = "Signal"
    name_plural = "Signals"
    icon = "fa-solid fa-tower-broadcast"
    category = "Vision"

    column_list = [
        m.Signal.sector_slug,
        m.Signal.source_kind,
        m.Signal.title,
        # capability + actor relationships render the joined __str__ so
        # the list answers "which capability scored this signal? which
        # actor was matched?" without cross-referencing the IDs by hand.
        m.Signal.capability_id,
        m.Signal.capability,
        m.Signal.actor_id,
        m.Signal.actor,
        m.Signal.is_highlight,
        m.Signal.published_at,
        m.Signal.ingested_at,
    ]
    column_searchable_list = [m.Signal.title, m.Signal.source_url, m.Signal.source_id_ext]
    column_sortable_list = [
        m.Signal.published_at,
        m.Signal.ingested_at,
        m.Signal.is_highlight,
    ]
    column_default_sort = ("ingested_at", True)
    can_create = False
    can_edit = False
    can_delete = False
