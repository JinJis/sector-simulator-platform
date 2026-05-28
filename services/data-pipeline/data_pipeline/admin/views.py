"""ModelView definitions for SQLAdmin.

One class per surfaced model. Column lists are explicit (not the SQLA
introspection default) so a Prisma column add doesn't surprise an
operator with PII or noise. Heavy / large columns (JSONB payload,
description text) are kept on the detail page but kept off the list.

Per-row trigger / decide actions are decorated via `@action` and call
helpers in `actions.py` so the trigger logic lives in one place.
"""

from __future__ import annotations

import logging

from sqladmin import ModelView, action
from starlette.requests import Request
from starlette.responses import Response

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.format import KST_TYPE_FORMATTERS

log = logging.getLogger(__name__)


class _BaseModelView(ModelView):
    """Shared defaults for every cockpit ModelView. Currently just the
    timezone-aware datetime formatter (KST or whatever
    ADMIN_DISPLAY_TZ resolves to) so the operator never sees a raw
    UTC timestamp in a list / details view."""

    # SQLAdmin overrides BASE_FORMATTERS per-view, so we hand it the
    # full map (None + bool + datetime) — losing the bool tick/cross
    # icon would be a regression.
    column_type_formatters = KST_TYPE_FORMATTERS


class SectorView(_BaseModelView, model=m.Sector):
    name = "Vision"
    name_plural = "Visions"
    icon = "fa-solid fa-bullseye"
    category = "Vision"

    column_list = [
        m.Sector.slug,
        m.Sector.name,
        m.Sector.status,
        m.Sector.is_vision_eligible,
        m.Sector.vision_question,
        m.Sector.updated_at,
    ]
    column_searchable_list = [m.Sector.slug, m.Sector.name]
    column_sortable_list = [m.Sector.slug, m.Sector.status, m.Sector.updated_at]
    column_default_sort = ("updated_at", True)
    form_excluded_columns = [m.Sector.created_at, m.Sector.updated_at]
    can_create = False
    can_delete = False

    @action(
        name="trigger_hello_world",
        label="Trigger: hello-world fetch",
        confirmation_message="Enqueue a hello-world DR ping for the selected vision(s)?",
    )
    async def trigger_hello_world(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        sectors = await actions.load_pks_as_sectors(self, pks)
        run_ids: list[str] = []
        for s in sectors:
            run_ids.append(await actions.enqueue_hello(request, vision_slug=s.slug))
        return actions.back_to_list(
            request, self.identity, f"hello-world enqueued ({len(run_ids)})"
        )

    @action(
        name="trigger_digest",
        label="Trigger: Deep Research digest",
        confirmation_message="Enqueue a daily DR digest for the selected vision(s)?",
    )
    async def trigger_digest(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        sectors = await actions.load_pks_as_sectors(self, pks)
        run_ids: list[str] = []
        for s in sectors:
            run_ids.append(await actions.enqueue_digest(request, vision_slug=s.slug))
        return actions.back_to_list(
            request, self.identity, f"digest enqueued ({len(run_ids)})"
        )


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


class RiskView(_BaseModelView, model=m.Risk):
    name = "Risk"
    name_plural = "Risks"
    icon = "fa-solid fa-triangle-exclamation"
    category = "Vision"

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


class VisionFeasibilityView(_BaseModelView, model=m.VisionFeasibility):
    name = "Feasibility snapshot"
    name_plural = "Feasibility snapshots"
    icon = "fa-solid fa-gauge-high"
    category = "Vision"

    column_list = [
        m.VisionFeasibility.sector_slug,
        m.VisionFeasibility.composite,
        m.VisionFeasibility.binding_capability_key,
        m.VisionFeasibility.eta_median_years,
        m.VisionFeasibility.delta_90d,
        m.VisionFeasibility.is_current,
        m.VisionFeasibility.as_of,
    ]
    column_sortable_list = [
        m.VisionFeasibility.sector_slug,
        m.VisionFeasibility.composite,
        m.VisionFeasibility.as_of,
    ]
    column_default_sort = ("as_of", True)
    can_create = False
    can_edit = False
    can_delete = False


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
    can_create = False
    can_edit = False
    can_delete = False


class CommunityProposalView(_BaseModelView, model=m.CommunityProposal):
    name = "Community proposal"
    name_plural = "Community proposals"
    icon = "fa-solid fa-comments"
    category = "Operations"

    column_list = [
        m.CommunityProposal.sector_slug,
        m.CommunityProposal.target_kind,
        m.CommunityProposal.title,
        m.CommunityProposal.status,
        m.CommunityProposal.vote_score,
        m.CommunityProposal.author_id,
        m.CommunityProposal.created_at,
    ]
    column_searchable_list = [m.CommunityProposal.title, m.CommunityProposal.target_ref]
    column_sortable_list = [
        m.CommunityProposal.created_at,
        m.CommunityProposal.status,
        m.CommunityProposal.vote_score,
    ]
    column_default_sort = ("created_at", True)
    can_create = False
    can_delete = False

    @action(
        name="approve",
        label="Approve (status → applied)",
        confirmation_message=(
            "Approve the selected proposal(s)? Status → applied; the M46e "
            "applier picks up applied rows separately."
        ),
    )
    async def approve(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        result = await actions.decide_proposals(request, pks, status="applied")
        return actions.back_to_list(
            request,
            self.identity,
            f"approved {len(result.decided_ids)}, skipped {len(result.skipped_ids)}",
        )

    @action(
        name="reject",
        label="Reject (status → rejected)",
        confirmation_message="Reject the selected proposal(s)? Status → rejected.",
    )
    async def reject(self, request: Request) -> Response:
        pks = actions.parse_pks(request)
        result = await actions.decide_proposals(request, pks, status="rejected")
        return actions.back_to_list(
            request,
            self.identity,
            f"rejected {len(result.decided_ids)}, skipped {len(result.skipped_ids)}",
        )


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
    # Editing/deleting User goes through the user-app's own flow;
    # SQLAdmin stays read-only here to avoid breaking session state.
    can_create = False
    can_edit = False
    can_delete = False


class AuditLogView(_BaseModelView, model=m.AuditLog):
    name = "Audit log"
    name_plural = "Audit log"
    icon = "fa-solid fa-clipboard-list"
    category = "Operations"

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


ALL_VIEWS: list[type[ModelView]] = [
    SectorView,
    CapabilityView,
    CapabilityScoreView,
    SignalView,
    RiskView,
    ActorView,
    VisionActorView,
    CapabilityActorView,
    EconomicsDatapointView,
    VisionFeasibilityView,
    CrawlRunView,
    CommunityProposalView,
    UserView,
    AuditLogView,
]
