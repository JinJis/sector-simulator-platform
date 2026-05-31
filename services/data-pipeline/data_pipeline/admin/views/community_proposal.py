"""CommunityProposalView — admin queue for bot + community-submitted
proposals with approve / reject row actions."""

from __future__ import annotations

from sqladmin import action
from starlette.requests import Request
from starlette.responses import Response
from wtforms import SelectField

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.format import status_badge_formatter
from data_pipeline.admin.views._base import (
    _PROPOSAL_STATUS_CHOICES,
    _PROPOSAL_TARGET_KIND_CHOICES,
    _BaseModelView,
)


class CommunityProposalView(_BaseModelView, model=m.CommunityProposal):
    name = "Community proposal"
    name_plural = "Community proposals"
    icon = "fa-solid fa-comments"
    category = "Jobs"

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
    column_formatters = {m.CommunityProposal.status: status_badge_formatter}
    column_formatters_detail = {m.CommunityProposal.status: status_badge_formatter}
    can_create = False
    can_delete = False
    # target_kind drives the M46e applier dispatch — a typo here means
    # the proposal silently never applies. status drives the queue +
    # filter view. Both must be dropdowns. Note: the approve/reject row
    # actions remain the preferred path; this just hardens manual edits.
    form_overrides = {
        "target_kind": SelectField,
        "status": SelectField,
    }
    form_args = {
        "target_kind": {"choices": _PROPOSAL_TARGET_KIND_CHOICES, "coerce": str},
        "status": {"choices": _PROPOSAL_STATUS_CHOICES, "coerce": str},
    }

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
