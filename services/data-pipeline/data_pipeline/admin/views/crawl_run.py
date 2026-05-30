"""CrawlRunView — read-only CrawlRun history (status badge formatted)."""

from __future__ import annotations

from typing import Any
from markupsafe import Markup, escape

from data_pipeline.admin import models as m
from data_pipeline.admin.format import status_badge_formatter
from data_pipeline.admin.views._base import _BaseModelView


def crawl_run_plan_formatter(obj: Any, prop: Any) -> Markup | str:
    plan = getattr(obj, prop, None)
    if not plan or not isinstance(plan, dict):
        return str(plan) if plan is not None else ""
    
    html = '<div class="d-flex flex-wrap gap-2">'
    for k, v in plan.items():
        html += f'<span class="badge bg-blue-lt"><strong>{escape(str(k))}:</strong> {escape(str(v))}</span>'
    html += '</div>'
    return Markup(html)


def crawl_run_result_formatter(obj: Any, prop: Any) -> Markup | str:
    res = getattr(obj, prop, None)
    if not res or not isinstance(res, dict):
        return str(res) if res is not None else ""
    
    html = '<div class="card card-sm shadow-sm" style="border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; overflow: hidden; width: 100%;">'
    
    # Top section: Metadata summary
    html += '<div class="card-body bg-light border-bottom p-2 d-flex flex-wrap gap-3 align-items-center" style="font-size: 0.8rem;">'
    if "model" in res:
        html += f'<div><strong>Model:</strong> <span class="badge bg-purple-lt">{escape(str(res["model"]))}</span></div>'
    if "dr_status" in res:
        status_color = "green" if res["dr_status"] == "completed" else "red"
        html += f'<div><strong>Status:</strong> <span class="badge bg-{status_color}-lt">{escape(str(res["dr_status"]))}</span></div>'
    if "dr_cached" in res:
        cached_color = "azure" if res["dr_cached"] else "secondary"
        html += f'<div><strong>Cached:</strong> <span class="badge bg-{cached_color}-lt">{res["dr_cached"]}</span></div>'
    if "dr_elapsed_seconds" in res:
        html += f'<div><strong>Elapsed:</strong> <span class="text-muted font-monospace">{res["dr_elapsed_seconds"]}s</span></div>'
    html += '</div>'
    
    # Middle section: Output preview
    html += '<div class="card-body p-3">'
    if "output_preview" in res:
        html += '<h5 class="text-uppercase text-muted mb-2" style="font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;">Synthesis Preview</h5>'
        html += f'<blockquote class="blockquote mb-3" style="font-size: 0.9rem; border-left: 3px solid #4f46e5; padding-left: 10px; color: #374151; font-style: italic;">"{escape(str(res["output_preview"]))}"</blockquote>'
    
    # Scoring details
    if "scoring" in res and isinstance(res["scoring"], dict):
        sc = res["scoring"]
        html += '<h5 class="text-uppercase text-muted mt-3 mb-2" style="font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;">Scoring deltas</h5>'
        html += '<div class="row g-2 mb-3">'
        for dim in ["delta_technical", "delta_economic", "delta_regulatory", "delta_supply"]:
            val = sc.get(dim)
            if val is not None:
                try:
                    val_float = float(val)
                except (ValueError, TypeError):
                    continue
                dim_name = dim.replace("delta_", "").title()
                badge_class = "green-lt" if val_float > 0 else ("red-lt" if val_float < 0 else "secondary-lt")
                sign = "+" if val_float > 0 else ""
                html += f"""
                    <div class="col-6 col-sm-3">
                        <div class="p-2 border rounded text-center bg-white">
                            <div class="text-muted small text-uppercase" style="font-size: 0.6rem; font-weight: 600;">{dim_name}</div>
                            <span class="badge bg-{badge_class} font-monospace fw-bold mt-1" style="font-size: 0.85rem;">{sign}{val_float}</span>
                        </div>
                    </div>
                """
        html += '</div>'
        if "rationale" in sc and sc["rationale"]:
            html += '<h5 class="text-uppercase text-muted mb-1" style="font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;">Scoring Rationale</h5>'
            html += f'<div class="text-muted p-2 bg-light rounded mb-3" style="font-size: 0.8rem; border-left: 3px solid #10b981;">{escape(str(sc["rationale"]))}</div>'
            
    # Citations
    if "citations" in res and isinstance(res["citations"], list) and res["citations"]:
        html += '<h5 class="text-uppercase text-muted mt-3 mb-2" style="font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;">Citations</h5>'
        html += '<div class="list-group list-group-flush border rounded" style="font-size: 0.8rem; max-height: 150px; overflow-y: auto; max-width: 100%;">'
        for c in res["citations"]:
            title = escape(str(c.get("title") or "Source"))
            url = escape(str(c.get("url") or "#"))
            try:
                domain = url.split("/")[2] if "://" in url else "web"
            except IndexError:
                domain = "web"
            html += f'<a href="{url}" target="_blank" class="list-group-item list-group-item-action p-2 d-flex justify-content-between align-items-center text-primary">'
            html += f'<span><i class="fa-solid fa-link me-1 text-muted"></i> {title}</span>'
            html += f'<span class="badge bg-secondary-lt font-monospace" style="font-size: 0.65rem;">{domain}</span>'
            html += '</a>'
        html += '</div>'
        
    html += '</div></div>'
    return Markup(html)


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
    column_formatters_detail = {
        m.CrawlRun.status: status_badge_formatter,
        m.CrawlRun.plan: crawl_run_plan_formatter,
        m.CrawlRun.result_summary: crawl_run_result_formatter,
    }
    can_create = False
    can_edit = False
    can_delete = False
