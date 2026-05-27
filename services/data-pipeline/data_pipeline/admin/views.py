"""ModelView definitions for SQLAdmin.

One class per surfaced model. Column lists are explicit (not the SQLA
introspection default) so a Prisma column add doesn't surprise an
operator with PII or noise. Heavy / large columns (JSONB payload,
description text) are kept on the detail page but kept off the list.

Per-row actions (trigger fetcher, approve/reject proposal, toggle cron)
land in `actions.py` and are wired in here via `column_actions`.
"""

from __future__ import annotations

from sqladmin import ModelView

from data_pipeline.admin import models as m


class SectorView(ModelView, model=m.Sector):
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


class CapabilityView(ModelView, model=m.Capability):
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


class CapabilityScoreView(ModelView, model=m.CapabilityScore):
    name = "Capability score"
    name_plural = "Capability scores"
    icon = "fa-solid fa-chart-line"
    category = "Vision"

    column_list = [
        m.CapabilityScore.capability_id,
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


class SignalView(ModelView, model=m.Signal):
    name = "Signal"
    name_plural = "Signals"
    icon = "fa-solid fa-tower-broadcast"
    category = "Vision"

    column_list = [
        m.Signal.sector_slug,
        m.Signal.source_kind,
        m.Signal.title,
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


class RiskView(ModelView, model=m.Risk):
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


class ActorView(ModelView, model=m.Actor):
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


class VisionActorView(ModelView, model=m.VisionActor):
    name = "Vision↔Actor"
    name_plural = "Vision↔Actors"
    icon = "fa-solid fa-link"
    category = "Vision"

    column_list = [
        m.VisionActor.sector_slug,
        m.VisionActor.actor_id,
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


class CapabilityActorView(ModelView, model=m.CapabilityActor):
    name = "Capability↔Actor"
    name_plural = "Capability↔Actors"
    icon = "fa-solid fa-link"
    category = "Vision"

    column_list = [
        m.CapabilityActor.capability_id,
        m.CapabilityActor.actor_id,
        m.CapabilityActor.role,
        m.CapabilityActor.stage,
        m.CapabilityActor.updated_at,
    ]
    column_sortable_list = [m.CapabilityActor.role, m.CapabilityActor.updated_at]
    column_default_sort = ("updated_at", True)
    can_create = False
    can_delete = False


class EconomicsDatapointView(ModelView, model=m.EconomicsDatapoint):
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


class VisionFeasibilityView(ModelView, model=m.VisionFeasibility):
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


class CrawlRunView(ModelView, model=m.CrawlRun):
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


class CommunityProposalView(ModelView, model=m.CommunityProposal):
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


class UserView(ModelView, model=m.User):
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


class AuditLogView(ModelView, model=m.AuditLog):
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
