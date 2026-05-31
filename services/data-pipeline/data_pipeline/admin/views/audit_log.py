"""AuditLogView — read-only audit-log cockpit page."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class AuditLogView(_BaseModelView, model=m.AuditLog):
    name = "Audit log"
    name_plural = "Audit log"
    icon = "fa-solid fa-clipboard-list"
    category = "Audits"

    column_list = [
        m.AuditLog.action,
        m.AuditLog.sector_slug,
        m.AuditLog.author_label,
        m.AuditLog.created_at,
    ]
    column_searchable_list = [m.AuditLog.action, m.AuditLog.author_label]
    column_sortable_list = [m.AuditLog.created_at, m.AuditLog.action]
    column_default_sort = ("created_at", True)
    can_create = False
    can_edit = False
    can_delete = False
