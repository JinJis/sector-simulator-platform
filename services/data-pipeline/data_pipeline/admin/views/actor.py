"""Actor + VisionActor + CapabilityActor cockpit views.

Three related views: the global Actor catalog plus the two join
tables (VisionActor scopes an actor to a vision, CapabilityActor binds
an actor to a specific capability with role / stage override).
"""

from __future__ import annotations

from sqladmin import action
from starlette.requests import Request
from starlette.responses import Response
from wtforms import SelectField

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.views._base import (
    _ACTOR_CATEGORY_CHOICES,
    _ACTOR_STAGE_CHOICES,
    _CAPABILITY_ACTOR_ROLE_CHOICES,
    _NULLABLE_PREFIX,
    _BaseModelView,
)


class ActorView(_BaseModelView, model=m.Actor):
    name = "Actor"
    name_plural = "Actors"
    icon = "fa-solid fa-building"
    category = "Vision"

    column_list = [
        m.Actor.key,
        m.Actor.name,
        m.Actor.category,
        m.Actor.iso_country,
        m.Actor.stage,
        m.Actor.updated_at,
    ]
    column_searchable_list = [m.Actor.key, m.Actor.name, m.Actor.name_local]
    column_sortable_list = [
        m.Actor.name,
        m.Actor.category,
        m.Actor.iso_country,
        m.Actor.stage,
    ]
    column_default_sort = ("name", False)
    can_create = False
    can_delete = False
    # Actor.category drives the badge colour + filter on the public
    # Actors page; Actor.stage is the maturity pill. Both are enum-shaped
    # in schema.prisma — render as dropdowns to prevent silent typo drift.
    form_overrides = {
        "category": SelectField,
        "stage": SelectField,
    }
    form_args = {
        "category": {"choices": _ACTOR_CATEGORY_CHOICES, "coerce": str},
        "stage": {"choices": _ACTOR_STAGE_CHOICES, "coerce": str},
    }


class VisionActorView(_BaseModelView, model=m.VisionActor):
    name = "Vision↔Actor"
    name_plural = "Vision↔Actors"
    icon = "fa-solid fa-link"
    category = "Vision"

    column_list = [
        m.VisionActor.sector_slug,
        # `sector` and `actor` are SQLAlchemy relationships that render
        # the joined `__str__` in admin lists — sector name + actor
        # name appear next to the opaque slug/id so the operator can
        # eyeball "which vision, which actor" without two extra tabs.
        m.VisionActor.sector,
        m.VisionActor.actor_id,
        m.VisionActor.actor,
        m.VisionActor.relevance,
        m.VisionActor.display_order,
        m.VisionActor.updated_at,
    ]
    column_sortable_list = [
        m.VisionActor.sector_slug,
        m.VisionActor.relevance,
        m.VisionActor.display_order,
    ]
    column_default_sort = [("sector_slug", False), ("display_order", False)]
    can_create = False
    can_delete = False

    @action(
        name="trigger_actor_fetch",
        label="Trigger: actor DR fetch",
        confirmation_message=(
            "Enqueue an Actor DR fetch for the actor(s) bound to the selected "
            "Vision↔Actor rows? (Actor is global; this join row supplies the "
            "vision context.)"
        ),
    )
    async def trigger_actor_fetch(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        pairs = await actions.load_pks_as_vision_actors(self, pks)
        for va, actor in pairs:
            await actions.enqueue_actor(
                request, vision_slug=va.sector_slug, actor_key=actor.key
            )
        return actions.back_to_list(
            request, self.identity, f"actor fetch enqueued ({len(pairs)})"
        )


class CapabilityActorView(_BaseModelView, model=m.CapabilityActor):
    name = "Capability↔Actor"
    name_plural = "Capability↔Actors"
    icon = "fa-solid fa-link"
    category = "Vision"

    column_list = [
        m.CapabilityActor.capability_id,
        m.CapabilityActor.capability,
        m.CapabilityActor.actor_id,
        m.CapabilityActor.actor,
        m.CapabilityActor.role,
        m.CapabilityActor.stage,
        m.CapabilityActor.updated_at,
    ]
    column_sortable_list = [m.CapabilityActor.role, m.CapabilityActor.updated_at]
    column_default_sort = ("updated_at", True)
    can_create = False
    can_delete = False
    # role is required (schema default "competitor"); stage is a nullable
    # per-capability override of Actor.stage. Both render as dropdowns
    # sharing _ACTOR_STAGE_CHOICES with the global ActorView.
    form_overrides = {
        "role": SelectField,
        "stage": SelectField,
    }
    form_args = {
        "role": {"choices": _CAPABILITY_ACTOR_ROLE_CHOICES, "coerce": str},
        "stage": {
            "choices": _NULLABLE_PREFIX + _ACTOR_STAGE_CHOICES,
            "coerce": str,
        },
    }
