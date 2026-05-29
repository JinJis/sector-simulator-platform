"""Capability + CapabilityScore cockpit views."""

from __future__ import annotations

from sqladmin import action
from starlette.requests import Request
from starlette.responses import Response

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import _BaseModelView


class CapabilityView(_BaseModelView, model=m.Capability):
    name = "Capability"
    name_plural = "Capabilities"
    icon = "fa-solid fa-cubes"
    category = "Vision"

    column_list = [
        m.Capability.sector_slug,
        m.Capability.key,
        m.Capability.name,
        m.Capability.weight,
        m.Capability.display_order,
        m.Capability.updated_at,
    ]
    column_searchable_list = [m.Capability.key, m.Capability.name]
    column_sortable_list = [
        m.Capability.sector_slug,
        m.Capability.display_order,
        m.Capability.weight,
    ]
    column_default_sort = [("sector_slug", False), ("display_order", False)]
    can_create = False
    can_delete = False

    @action(
        name="trigger_capability_fetch",
        label="Trigger: capability DR fetch",
        confirmation_message=(
            "Enqueue a Capability Deep-Research fetch for the selected capabilities?"
        ),
    )
    async def trigger_capability_fetch(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        caps = await actions.load_pks_as_capabilities(self, pks)
        for c in caps:
            await actions.enqueue_capability(
                request, vision_slug=c.sector_slug, capability_key=c.key
            )
        return actions.back_to_list(
            request, self.identity, f"capability fetch enqueued ({len(caps)})"
        )

    @action(
        name="trigger_signal_fetch",
        label="Trigger: signal ingest (scoped)",
        confirmation_message=(
            "Run scoped signal ingest (arxiv + USPTO + news) for the selected capabilities?"
        ),
    )
    async def trigger_signal_fetch(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        caps = await actions.load_pks_as_capabilities(self, pks)
        for c in caps:
            await actions.enqueue_signal(
                request, vision_slug=c.sector_slug, capability_key=c.key
            )
        return actions.back_to_list(
            request, self.identity, f"signal ingest enqueued ({len(caps)})"
        )


class CapabilityScoreView(_BaseModelView, model=m.CapabilityScore):
    name = "Capability score"
    name_plural = "Capability scores"
    icon = "fa-solid fa-chart-line"
    category = "Vision"

    # `capability` is a SQLAlchemy relationship column — SQLAdmin renders
    # the related Capability's __str__ ("name [sector/key]") so the
    # operator sees a human-readable identifier alongside the opaque
    # capability_id. (Lazy-loaded by the async session.)
    column_list = [
        m.CapabilityScore.capability_id,
        m.CapabilityScore.capability,
        m.CapabilityScore.composite,
        m.CapabilityScore.technical,
        m.CapabilityScore.economic,
        m.CapabilityScore.regulatory,
        m.CapabilityScore.supply,
        m.CapabilityScore.is_current,
        m.CapabilityScore.as_of,
    ]
    column_sortable_list = [m.CapabilityScore.as_of, m.CapabilityScore.is_current]
    column_default_sort = ("as_of", True)
    can_create = False
    can_edit = False
    can_delete = False
