"""Custom SQLAdmin page: Vision Builder wizard.

Replaces the deprecated `apps/admin/src/app/visions/new/builder-form.tsx`
React form. Two-step flow:

  1. **Prompt** — operator types a one-line vision question + optional
     research brief. POST `/admin/vision-builder/propose` forwards the
     call to sector-service tRPC `visionBuilder.propose`, which:
       - pre-fetches existing Sector slugs + Actor keys (so the validator
         flags dupes and the decomposer reuses existing actors),
       - calls agent-orchestration `/vision-builder/build` (PromptValidator
         → VisionResearch → VisionDecomposition → DataSourceSelector →
         ValidationGate),
       - audits the proposal regardless of outcome.

  2. **Review** — we render the resulting draft (or rejection / gate
     failure) on a separate page. On success the draft is embedded in a
     hidden form field so the commit POST is fully stateless — no
     server-side cache, no session storage.

  3. **Commit** — POST `/admin/vision-builder/commit` reads the hidden
     draft + signal_config from the form, forwards to sector-service
     tRPC `visionBuilder.commit` (one Prisma transaction that writes
     Sector / Capability[] / Risk[] / Actor[] / VisionActor[] /
     CapabilityActor[] / initial CapabilityScore[] / seed
     VisionFeasibility), then redirects to the freshly-committed Sector's
     SQLAdmin detail page.

What we deliberately drop vs. the React version: granular per-field
edit. The React form let the admin tweak each capability/risk/actor
before commit; here you commit as-is or restart with a refined prompt.
Operators who need edits can re-prompt with the specific change
("...same as before but make weight 0.25 for capability X"); the
LLM cost per propose is bounded at ~$0.55 and re-running is fast
enough not to justify the form complexity.

Auth: SQLAdmin's existing `login_required` covers every @expose
handler. The two POST routes also require the SessionMiddleware-signed
admin cookie.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx
from agent_tools import available_models
from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

log = logging.getLogger(__name__)


def _vision_builder_stage_models() -> dict[str, str]:
    """Resolve the actual Gemini model id used by each Vision Builder
    stage (post-F9b semantic tier names: fast / balanced / deep).
    Reads from `LLM_{FAST,BALANCED,DEEP}_MODEL` env vars → falls back
    to llm_client built-in defaults. Surfaced into the propose-form
    progress UI so the operator sees the real model that's running,
    not the tier-name alias."""
    models = available_models()
    return {
        "prompt_validator": models["fast"],
        "vision_decomposition": models["deep"],
        "data_source_selector": models["balanced"],
        "thesis_drafter": models["balanced"],
    }


# Mirror of `apps/admin/.../builder-form.tsx :: STAGE_LABELS`. Kept in
# sync because the agent-orchestration stage names are an API surface.
STAGE_LABELS: dict[str, str] = {
    "prompt_validator": "Stage 1 — Prompt Validator",
    "vision_decomposition": "Stage 2 — Vision Decomposition",
    "data_source_selector": "Stage 3 — Data Source Selector",
    "validation_gate": "Stage 4 — Validation Gate",
}

EXAMPLES: list[str] = [
    "Will commercial fusion power reach grid parity by 2040?",
    "By when will quantum computers break RSA-2048?",
    "Will direct-to-cell satellite voice + data be mass-market by 2030?",
    "Can solid-state batteries hit $50/kWh at scale by 2035?",
]


def _agent_orchestration_url() -> str:
    """Direct address for the agent-orchestration progress endpoint.
    Defaults to the compose internal hostname; falls back to localhost
    for outside-compose dev. Resolved per-request so an env change
    picks up after container restart without rebuild."""
    return (
        os.environ.get("AGENT_ORCHESTRATION_URL", "").strip()
        or "http://agent-orchestration:8002"
    )


def _sector_service_url() -> str:
    """Where to send tRPC calls. Compose default
    `http://sector-service:8001`; falls back to localhost for outside-
    compose dev. Resolved per-request so a `.env` change picks up after
    container restart without rebuild."""
    return (
        os.environ.get("SECTOR_SERVICE_URL", "").strip()
        or "http://sector-service:8001"
    )


class TRPCError(RuntimeError):
    """tRPC call failed. Carries the structured fields the admin error
    panel needs — operator sees the full chain (sector-service → agent-
    orchestration) without URL truncation, and the JSON details panel
    surfaces the tRPC error data dict (path, code, httpStatus, the
    stack from sector-service when NODE_ENV != production)."""

    def __init__(
        self,
        *,
        procedure: str,
        status_code: int,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            f"sector-service tRPC {procedure} returned {status_code}: {message}"
        )
        self.procedure = procedure
        self.status_code = status_code
        self.message = message
        self.data = data or {}


async def _trpc_mutation(
    procedure: str, *, payload: dict[str, Any], timeout_sec: float = 120.0
) -> dict[str, Any]:
    """Call a sector-service tRPC mutation. The Fastify adapter mounts
    the router at `/trpc/*`.

    sector-service runs tRPC v11 WITHOUT a transformer (no superjson),
    so the un-batched HTTP wire format is:
      - request body: the input object directly (no `{"json": ...}`
        wrapping — that only applies when superjson is configured)
      - response body: `{"result": {"data": <output>}}` (again, no
        `.json` sub-wrap)

    Raises :class:`TRPCError` on tRPC error responses — caller catches +
    renders inline via :func:`_format_error_detail`. Timeout is
    deliberately long because propose chains 4 LLM stages including a
    synchronous deep-tier call (15-60s wall time)."""
    url = f"{_sector_service_url()}/trpc/{procedure}"
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        # Try to extract the full tRPC error envelope; fall back to raw
        # body. The envelope shape is `{error: {message, code, data: {
        # path, code, httpStatus, stack? }}}` — we keep `data` whole so
        # the admin's "show details" panel can surface every field.
        envelope_data: dict[str, Any] = {}
        msg = resp.text
        try:
            envelope = resp.json().get("error") or {}
            msg = envelope.get("message") or resp.text
            envelope_data = envelope.get("data") or {}
        except (ValueError, AttributeError):
            pass
        raise TRPCError(
            procedure=procedure,
            status_code=resp.status_code,
            message=msg,
            data=envelope_data,
        )
    data = resp.json()
    try:
        return data["result"]["data"]
    except (KeyError, TypeError) as exc:
        raise TRPCError(
            procedure=procedure,
            status_code=resp.status_code,
            message=f"unexpected response envelope: {data!r}",
        ) from exc


def _format_error_detail(
    exc: BaseException, *, fallback_title: str = "Operation failed"
) -> dict[str, Any]:
    """Build the structured context the admin error banner renders.

    Title is short enough for the alert header; ``message`` is the full
    chained string with no URL-encoding truncation; ``upstream_status``
    (when present) shows in a chip; ``trpc_data`` (when present) is the
    JSON pretty-printed in a collapsible details panel.

    ``debug_hint`` tells the operator the exact docker-compose command
    to run to dig deeper — saves a round-trip to "where do I find the
    real stack trace?"
    """
    title = fallback_title
    message = str(exc) or repr(exc)
    upstream_status: int | None = None
    trpc_data: dict[str, Any] | None = None

    if isinstance(exc, TRPCError):
        upstream_status = exc.status_code
        trpc_data = exc.data or None
        # Try to detect which downstream stage actually failed from the
        # message chain. Cheap heuristic — the agent-orchestration
        # endpoint name is the most reliable signal we get back through
        # sector-service.
        if "/vision-builder/build" in message:
            title = "Vision Builder pipeline failed (agent-orchestration)"
        elif "/vision-builder/commit" in message:
            title = "Vision Builder commit failed (sector-service)"
        elif "agent-orchestration returned" in message:
            title = "agent-orchestration upstream call failed"
        else:
            title = f"sector-service tRPC {exc.procedure} failed"

    debug_hint = (
        "docker compose logs agent-orchestration --tail=200 | "
        "grep -iE 'vision-builder|llm_client|workflow' — the full stack "
        "trace lives in the agent-orchestration container, not the tRPC "
        "response body."
    )
    return {
        "title": title,
        "message": message,
        "upstream_status": upstream_status,
        "trpc_data": trpc_data,
        "debug_hint": debug_hint,
    }


@dataclass(frozen=True, slots=True)
class _DraftSummary:
    """Compact view-model the review template renders. Pulls just the
    counts + the headline fields from a possibly-large draft JSON so
    the operator gets a one-glance sanity check before committing."""

    slug: str
    name: str
    vision_question: str
    initial_composite: float | None
    binding_capability_key: str | None
    eta_median_years: float | None
    capability_count: int
    risk_count: int
    actor_count: int
    capability_actors_count: int
    dependencies_count: int


def _summarize_draft(draft: dict[str, Any]) -> _DraftSummary:
    init = draft.get("initial_feasibility") or {}
    return _DraftSummary(
        slug=draft.get("slug", ""),
        name=draft.get("name", ""),
        vision_question=draft.get("vision_question", ""),
        initial_composite=init.get("initial_composite"),
        binding_capability_key=init.get("binding_capability_key"),
        eta_median_years=init.get("eta_median_years"),
        capability_count=len(draft.get("capabilities") or []),
        risk_count=len(draft.get("risks") or []),
        actor_count=len(draft.get("actors") or []),
        capability_actors_count=len(draft.get("capability_actors") or []),
        dependencies_count=len(draft.get("dependencies") or []),
    )


class VisionBuilderView(BaseView):
    """Sidebar entry → multi-step LLM wizard for adding a new Vision.

    `category="Vision"` slots it next to the read-only Sector / Capability
    list. `identity="vision-builder"` keeps URL paths human-readable."""

    name = "Vision Builder"
    icon = "fa-solid fa-wand-magic-sparkles"
    category = "Vision"
    identity = "vision-builder"

    async def _render_prompt(
        self,
        request: Request,
        *,
        prompt: str = "",
        research_brief: str = "",
        error_detail: dict[str, Any] | None = None,
    ) -> Response:
        """Render the Stage 1 form. Used by both the GET landing and the
        POST error path so the operator stays on the same surface with
        their form values preserved + a structured error banner."""
        return await self.templates.TemplateResponse(
            request,
            "vision_builder_prompt.html",
            context={
                "title": "Vision Builder",
                "subtitle": (
                    "Type a one-line vision question. The conductor (PromptValidator → "
                    "VisionDecomposition → DataSourceSelector → ValidationGate) drafts "
                    "the capability tree; you review before commit. Budget ≤$0.55 / "
                    "successful build."
                ),
                "examples": EXAMPLES,
                "prompt": prompt,
                "research_brief": research_brief,
                "error_detail": error_detail,
                "stage_models": _vision_builder_stage_models(),
            },
        )

    @expose("/vision-builder", methods=["GET"])
    async def prompt_page(self, request: Request) -> Response:
        """Stage 1 form (GET landing). No error context — the propose
        POST handler renders this template directly with `error_detail`
        when a submission fails."""
        return await self._render_prompt(request)

    @expose("/vision-builder/propose", methods=["POST"])
    async def propose(self, request: Request) -> Response:
        """Stage 1 submit. Forward to sector-service tRPC. The propose
        procedure handles pre-fetching slug+actor keys and the audit
        log — we just render the result. On any failure we re-render
        the form inline with structured error context so the operator
        sees the full chain (no URL truncation) and their typed prompt
        + research_brief survive the round-trip."""
        form = await request.form()
        prompt = str(form.get("prompt", "")).strip()
        research_brief = str(form.get("research_brief", "")).strip()
        if len(prompt) < 15:
            return await self._render_prompt(
                request,
                prompt=prompt,
                research_brief=research_brief,
                error_detail={
                    "title": "Prompt validation failed",
                    "message": "prompt is too short (min 15 chars)",
                    "upstream_status": None,
                    "trpc_data": None,
                    "debug_hint": None,
                },
            )
        if len(prompt) > 4000:
            return await self._render_prompt(
                request,
                prompt=prompt,
                research_brief=research_brief,
                error_detail={
                    "title": "Prompt validation failed",
                    "message": "prompt is too long (max 4000 chars)",
                    "upstream_status": None,
                    "trpc_data": None,
                    "debug_hint": None,
                },
            )

        payload: dict[str, Any] = {
            "prompt": prompt,
            "research_brief": research_brief or None,
        }
        try:
            result = await _trpc_mutation("visionBuilder.propose", payload=payload)
        except Exception as exc:  # noqa: BLE001
            # Log the full exception server-side for grep-ability, then
            # render the form with structured error context — full
            # message survives, no URL truncation. The operator can
            # copy-paste the agent-orchestration grep hint from the
            # details panel.
            log.warning("vision-builder propose failed", exc_info=exc)
            return await self._render_prompt(
                request,
                prompt=prompt,
                research_brief=research_brief,
                error_detail=_format_error_detail(
                    exc, fallback_title="Vision Builder propose failed"
                ),
            )

        validation = result.get("validation") or {}
        gate = result.get("gate") or None
        draft = result.get("draft") or None
        rejected = not validation.get("is_valid", True)
        gate_failed = (not rejected) and (gate is not None) and (gate.get("ok") is False)
        success = (not rejected) and (not gate_failed) and (draft is not None)

        summary = _summarize_draft(draft) if (success and draft) else None
        return await self.templates.TemplateResponse(
            request,
            "vision_builder_review.html",
            context={
                "title": "Vision Builder — review",
                "subtitle": (
                    "Review the agent's draft. Commit writes one transaction; "
                    "reject and re-prompt if anything is off."
                ),
                "prompt": prompt,
                "research_brief": research_brief,
                "result": result,
                "validation": validation,
                "gate": gate,
                "draft": draft,
                "summary": summary,
                "rejected": rejected,
                "gate_failed": gate_failed,
                "success": success,
                # Embedded as form-field strings so the commit POST stays
                # stateless. Template uses `|tojson` to escape safely.
                "draft_json": json.dumps(draft) if draft else "",
                "signal_config_json": json.dumps(result.get("signal_config")),
                "stage_labels": STAGE_LABELS,
            },
        )

    @expose("/vision-builder/progress/latest", methods=["GET"])
    async def progress_latest(self, request: Request) -> Response:
        """Slice 15 — proxy to agent-orchestration's single-tenant
        progress slot. The propose JS polls this endpoint every 1.5s
        during the in-flight overlay; returns the same JSON shape
        agent-orchestration produces (no envelope translation) so the
        client can mirror the slot directly into UI state.

        Returns 503 + a small JSON body when agent-orchestration is
        unreachable — the polling JS treats that as "keep waiting,
        backend hiccup" rather than fatal."""
        url = f"{_agent_orchestration_url()}/vision-builder/progress/latest"
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(url)
        except Exception as exc:  # noqa: BLE001
            return Response(
                content=json.dumps(
                    {
                        "available": False,
                        "error": f"agent-orchestration unreachable: {exc}",
                    }
                ),
                status_code=503,
                media_type="application/json",
            )
        # Pass the upstream body through unchanged — agent-orchestration
        # owns the shape, we don't re-serialise.
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type="application/json",
        )

    @expose("/vision-builder/commit", methods=["POST"])
    async def commit(self, request: Request) -> Response:
        """Stage 2 submit. Reads draft + signal_config from hidden form
        fields populated by the review template. Forwards to sector-
        service tRPC `visionBuilder.commit` which does the one-shot
        Prisma transaction + audit log. On success redirects to the new
        Sector's SQLAdmin detail page."""
        form = await request.form()
        draft_raw = str(form.get("draft_json", ""))
        signal_config_raw = str(form.get("signal_config_json", "null"))
        if not draft_raw:
            return _redirect_with_error(request, "commit missing draft payload")
        try:
            draft = json.loads(draft_raw)
            signal_config = json.loads(signal_config_raw)
        except json.JSONDecodeError as exc:
            return _redirect_with_error(request, f"commit payload not valid JSON: {exc}")

        payload = {
            "draft": draft,
            "signal_config": signal_config,
            "author_label": os.environ.get("ADMIN_EMAIL") or "sqladmin",
        }
        try:
            out = await _trpc_mutation(
                "visionBuilder.commit", payload=payload, timeout_sec=30.0
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("vision-builder commit failed: %s", exc)
            return _redirect_with_error(request, f"commit failed: {exc}")

        slug = out.get("slug", "")
        log.info(
            "vision-builder commit ok: slug=%s caps=%s risks=%s actors=%s/%s",
            slug,
            out.get("capability_count"),
            out.get("risk_count"),
            out.get("actor_count_inserted"),
            out.get("actor_count_reused"),
        )
        # Redirect to the SQLAdmin Sector detail page so the operator
        # can verify the row. The Sector PK is `id`, not `slug`, so we
        # need to look it up — but committing just wrote it, so the
        # list view filtered by slug is the most reliable landing.
        list_url = request.url_for("admin:list", identity="sector")
        return RedirectResponse(
            list_url.include_query_params(
                search=slug,
                msg=(
                    f"vision committed: {slug} "
                    f"({out.get('capability_count')} caps, "
                    f"{out.get('risk_count')} risks, "
                    f"{out.get('actor_count_inserted')} new actors, "
                    f"{out.get('actor_count_reused')} reused)"
                ),
            ),
            status_code=303,
        )


def _redirect_with_error(request: Request, msg: str) -> RedirectResponse:
    """Redirect to the prompt page with `?error=...` so the form
    template renders a banner. Keeps the user on the same surface
    without the prompt textarea being clobbered (the template can
    optionally re-populate from `?prompt=`)."""
    base = request.url_for("admin:prompt_page")
    return RedirectResponse(base.include_query_params(error=msg), status_code=303)


