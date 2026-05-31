"""RiskView — Risk taxonomy cockpit page with editable enum dropdowns
and a Trigger: risk DR fetch row action."""

from __future__ import annotations

from sqladmin import action
from starlette.requests import Request
from starlette.responses import Response
from wtforms import SelectField

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import (
    _NULLABLE_PREFIX,
    _RISK_CATEGORY_CHOICES,
    _RISK_LIKELIHOOD_CHOICES,
    _RISK_SEVERITY_CHOICES,
    _RISK_TIME_HORIZON_CHOICES,
    _SOURCE_KIND_CHOICES,
    _BaseModelView,
)


class RiskView(_BaseModelView, model=m.Risk):
    name = "Risk"
    name_plural = "Risks"
    icon = "fa-solid fa-triangle-exclamation"
    category = "Tables"

    column_list = [
        m.Risk.sector_slug,
        m.Risk.key,
        m.Risk.name,
        m.Risk.category,
        m.Risk.severity,
        m.Risk.likelihood,
        m.Risk.time_horizon,
    ]
    column_searchable_list = [m.Risk.key, m.Risk.name]
    column_sortable_list = [
        m.Risk.sector_slug,
        m.Risk.severity,
        m.Risk.likelihood,
    ]
    column_default_sort = [("sector_slug", False), ("severity", False)]
    can_create = False
    can_delete = False
    # Render the five Risk enum columns (category / severity / likelihood
    # / time_horizon / source_kind) as dropdowns. Freeform input is how
    # we ended up with severity="High" vs "high" drift in the seed data
    # before — every typo silently filters out of severity-sorted views.
    form_overrides = {
        "category": SelectField,
        "severity": SelectField,
        "likelihood": SelectField,
        "time_horizon": SelectField,
        "source_kind": SelectField,
    }
    form_args = {
        "category": {"choices": _RISK_CATEGORY_CHOICES, "coerce": str},
        "severity": {"choices": _RISK_SEVERITY_CHOICES, "coerce": str},
        "likelihood": {"choices": _RISK_LIKELIHOOD_CHOICES, "coerce": str},
        "time_horizon": {"choices": _RISK_TIME_HORIZON_CHOICES, "coerce": str},
        # source_kind is nullable on Risk — empty option clears it.
        "source_kind": {
            "choices": _NULLABLE_PREFIX + _SOURCE_KIND_CHOICES,
            "coerce": str,
        },
    }

    @action(
        name="trigger_risk_fetch",
        label="Trigger: risk DR fetch",
        confirmation_message="Enqueue a Risk DR fetch for the selected risk(s)?",
    )
    async def trigger_risk_fetch(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        risks = await actions.load_pks_as_risks(self, pks)
        for r in risks:
            await actions.enqueue_risk(request, vision_slug=r.sector_slug, risk_key=r.key)
        return actions.back_to_list(
            request, self.identity, f"risk fetch enqueued ({len(risks)})"
        )
