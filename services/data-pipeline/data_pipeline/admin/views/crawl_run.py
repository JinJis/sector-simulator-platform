"""CrawlRunView — read-only CrawlRun history (status badge formatted)."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.format import status_badge_formatter
from data_pipeline.admin.views._base import _BaseModelView


class CrawlRunView(_BaseModelView, model=m.CrawlRun):
    name = "Crawl run"
    name_plural = "Crawl runs"
    icon = "fa-solid fa-spinner"
    category = "Operations"

    column_list = [
        m.CrawlRun.id,
        m.CrawlRun.vision_slug,
        m.CrawlRun.fetcher_kind,
        m.CrawlRun.status,
        m.CrawlRun.cost_usd,
        m.CrawlRun.signals_written,
        m.CrawlRun.started_at,
        m.CrawlRun.ended_at,
    ]
    column_searchable_list = [m.CrawlRun.id, m.CrawlRun.vision_slug]
    column_sortable_list = [
        m.CrawlRun.started_at,
        m.CrawlRun.status,
        m.CrawlRun.fetcher_kind,
    ]
    column_default_sort = ("started_at", True)
    column_formatters = {m.CrawlRun.status: status_badge_formatter}
    column_formatters_detail = {m.CrawlRun.status: status_badge_formatter}
    can_create = False
    can_edit = False
    can_delete = False
