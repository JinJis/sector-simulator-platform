"""SectorView — the Vision row's cockpit page (M55 vocabulary: a
``Sector`` row with ``is_vision_eligible=true`` IS a Vision)."""

from __future__ import annotations

from sqladmin import action
from starlette.requests import Request
from starlette.responses import Response
from wtforms import SelectField

from data_pipeline.admin import actions
from data_pipeline.admin import models as m
from data_pipeline.admin.format import status_badge_formatter
from data_pipeline.admin.views._base import _SECTOR_STATUS_CHOICES, _BaseModelView


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
    # Render Sector.status as a colored Tabler badge on both list and
    # details so the operator can spot draft / live / archived at a
    # glance (Vision Builder commits as draft; admin flips to live
    # via the edit form below).
    column_formatters = {m.Sector.status: status_badge_formatter}
    column_formatters_detail = {m.Sector.status: status_badge_formatter}
    can_create = False
    can_delete = False
    # Enable editing so admins can flip status draft → live and tweak
    # name / description / vision_question after a Builder commit.
    # Slug is the FK target everywhere — left out of the form so it
    # stays immutable. The audit / provenance columns
    # (source_module, agent_workflow_id, created_by_user_id) are
    # read-only metadata and don't belong on the edit form either.
    can_edit = True
    form_columns = [
        m.Sector.name,
        m.Sector.description,
        m.Sector.vision_question,
        m.Sector.is_vision_eligible,
        m.Sector.status,
    ]
    # Render status as a dropdown bound to the schema enum instead of
    # a freeform text input — typos here cascade silently (vision.list
    # filters by `status = 'live'` exactly).
    form_overrides = {"status": SelectField}
    form_args = {
        "status": {
            "choices": _SECTOR_STATUS_CHOICES,
            "coerce": str,
        }
    }

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
