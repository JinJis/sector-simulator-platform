"""SignalView — read-only cockpit page for the extracted-signal stream."""

from __future__ import annotations

from typing import Any
from markupsafe import Markup, escape

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


from sqladmin.filters import StaticValuesFilter

def triggering_job_formatter(obj: Any, prop: Any) -> Markup | str:
    val = getattr(obj, prop, None)
    if not val:
        return ""
    val_str = str(val).lower()
    if val_str == "news":
        cron_name = "News Ingest"
        badge_class = "bg-primary-lt"
    elif val_str in ("paper", "patent"):
        cron_name = "Research Ingest"
        badge_class = "bg-teal-lt"
    elif val_str == "research_brief":
        cron_name = "DR Digest / Orchestrator"
        badge_class = "bg-purple-lt"
    else:
        cron_name = val_str.title()
        badge_class = "bg-secondary-lt"
        
    return Markup(f'<span class="badge {badge_class}" title="Source: {escape(val_str)}">{escape(cron_name)}</span>')


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
    
    column_labels = {
        "source_kind": "Triggering Ingest Job",
    }
    column_filters = [
        StaticValuesFilter(
            m.Signal.source_kind,
            values=[
                ("news", "News Ingest"),
                ("paper", "Research Ingest (arXiv)"),
                ("patent", "Research Ingest (USPTO)"),
                ("research_brief", "DR Digest / Orchestrator"),
            ],
            title="Triggering Ingest Job",
        ),
    ]
    column_formatters = {
        m.Signal.source_kind: triggering_job_formatter,
    }
    column_formatters_detail = {
        m.Signal.source_kind: triggering_job_formatter,
    }
    
    can_create = False
    can_edit = False
    can_delete = False
