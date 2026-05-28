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
from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

log = logging.getLogger(__name__)


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


def _sector_service_url() -> str:
    """Where to send tRPC calls. Compose default
    `http://sector-service:8001`; falls back to localhost for outside-
    compose dev. Resolved per-request so a `.env` change picks up after
    container restart without rebuild."""
    return (
        os.environ.get("SECTOR_SERVICE_URL", "").strip()
        or "http://sector-service:8001"
    )


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

    Raises RuntimeError on tRPC error responses — the caller catches +
    flashes the message to the operator. Timeout is deliberately long
    because propose chains 4 LLM stages including a synchronous opus
    call (15-60s wall time)."""
    url = f"{_sector_service_url()}/trpc/{procedure}"
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        # Try to extract tRPC error envelope; fall back to raw body.
        # The error envelope IS still `{error: {message, ...}}` — no
        # transformer wrapping on errors either.
        try:
            err = resp.json().get("error", {})
            msg = err.get("message") or resp.text
        except (ValueError, AttributeError):
            msg = resp.text
        raise RuntimeError(
            f"sector-service tRPC {procedure} returned {resp.status_code}: {msg}"
        )
    data = resp.json()
    try:
        return data["result"]["data"]
    except (KeyError, TypeError) as exc:
        raise RuntimeError(
            f"sector-service tRPC {procedure} returned unexpected envelope: {data}"
        ) from exc


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

    @expose("/vision-builder", methods=["GET"])
    async def prompt_page(self, request: Request) -> Response:
        """Stage 1 form. `?error=...` query param flashes a banner —
        used after a failed propose redirects back here."""
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
                "error": request.query_params.get("error", ""),
            },
        )

    @expose("/vision-builder/propose", methods=["POST"])
    async def propose(self, request: Request) -> Response:
        """Stage 1 submit. Forward to sector-service tRPC. The propose
        procedure handles pre-fetching slug+actor keys and the audit
        log — we just render the result."""
        form = await request.form()
        prompt = str(form.get("prompt", "")).strip()
        research_brief = str(form.get("research_brief", "")).strip()
        if len(prompt) < 15:
            return _redirect_with_error(request, "prompt is too short (min 15 chars)")
        if len(prompt) > 4000:
            return _redirect_with_error(
                request, "prompt is too long (max 4000 chars)"
            )

        payload: dict[str, Any] = {
            "prompt": prompt,
            "research_brief": research_brief or None,
        }
        try:
            result = await _trpc_mutation("visionBuilder.propose", payload=payload)
        except Exception as exc:  # noqa: BLE001
            log.warning("vision-builder propose failed: %s", exc)
            return _redirect_with_error(request, f"propose failed: {exc}")

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


