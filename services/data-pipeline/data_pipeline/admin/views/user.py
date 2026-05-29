"""UserView — read-only User cockpit page (mutations go through the
user-app's own flow; SQLAdmin stays read-only here to avoid breaking
session state)."""

from __future__ import annotations

from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class UserView(_BaseModelView, model=m.User):
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-user"
    category = "Operations"

    column_list = [
        m.User.email,
        m.User.name,
        m.User.tier,
        m.User.is_bot,
        m.User.bot_kind,
        m.User.created_at,
    ]
    column_searchable_list = [m.User.email, m.User.name]
    column_sortable_list = [m.User.email, m.User.tier, m.User.created_at]
    column_default_sort = ("created_at", True)
    can_create = False
    can_edit = False
    can_delete = False
