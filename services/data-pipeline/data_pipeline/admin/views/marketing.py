"""Custom SQLAdmin page: LLM Marketing Cockpit.

A strategy-first social content studio for the Vision Feasibility Monitor.

Flow (three surfaces):
  1. **Studio** (``/marketing``, the sidebar landing) — pick a target
     (a live vision *or* "no specific vision" to promote the platform
     itself) and choose one of five funnel strategies presented as cards,
     then generate.
  2. **Review & Publish** (rendered by ``/marketing/generate``) — edit the
     bilingual Threads + Instagram copy and publish per platform.
  3. **Settings** (``/marketing/settings``) — publishing-key status and the
     per-platform custom tone / example guidelines.

``marketing_page`` (the Studio) must stay the **first** ``@expose``d method:
SQLAdmin derives a BaseView's sidebar link from the first-defined exposed
route, so the cockpit lands on the Studio.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import FastAPI
from sqladmin import BaseView, expose
from sqlalchemy import text
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from data_pipeline.jobs.marketing_digest import _build_snapshot, _call_marketing_agent

log = logging.getLogger(__name__)

# Strategy catalogue — one card per funnel stage on the Studio. The ``key``
# matches the agent workflow's ``_STRATEGY_PROMPTS``; the rest is presentation.
# ``needs_vision`` strategies are vision-specific (they read a vision's
# bottleneck / actors) and are disabled in "no specific vision" promo mode.
STRATEGIES: list[dict] = [
    {
        "key": "early_hype",
        "name": "Hook / Awareness",
        "funnel": "Top of funnel",
        "color": "purple",
        "icon": "fa-bolt",
        "tagline": "Hype or real?",
        "desc": (
            "A scroll-stopping, slightly contrarian hook that frames us as the "
            "hype-free BS detector for frontier tech. Built to spark debate and "
            "pull in the curious."
        ),
        "example": "“LEO edge computing: a $10B breakthrough — or just VC hype?”",
        "needs_vision": False,
    },
    {
        "key": "vision_bottleneck",
        "name": "Bottleneck Insight",
        "funnel": "Middle of funnel",
        "color": "blue",
        "icon": "fa-link",
        "tagline": "The one gating capability",
        "desc": (
            "Our signature data-story: Liebig's Law — the single weakest "
            "capability gates the whole vision — and the signals that just "
            "moved it. The proof that the score means something."
        ),
        "example": "“Fusion's real blocker isn't the plasma. It's the magnets — at 41/100.”",
        "needs_vision": True,
    },
    {
        "key": "high_level_pitch",
        "name": "Product Pitch",
        "funnel": "Top / Middle",
        "color": "green",
        "icon": "fa-rocket",
        "tagline": "How the monitor works",
        "desc": (
            "Authoritative value prop: decompose a bold vision into a capability "
            "tree, crawl papers and filings daily, roll it into one 5-second "
            "feasibility score. Great for promoting the platform itself."
        ),
        "example": "“We turn ‘will fusion happen?’ into one number, updated daily.”",
        "needs_vision": False,
    },
    {
        "key": "actor_race",
        "name": "Actor / Market Race",
        "funnel": "Bottom of funnel",
        "color": "orange",
        "icon": "fa-trophy",
        "tagline": "Who's actually winning",
        "desc": (
            "Competitive, investor-oriented framing of the race between labs, "
            "startups and incumbents driving the capabilities. For readers who "
            "track the field to allocate attention and capital."
        ),
        "example": "“Three labs chase room-temp superconductors. One moved the needle this month.”",
        "needs_vision": True,
    },
    {
        "key": "grounded_digest",
        "name": "Evidence / Authority",
        "funnel": "Trust",
        "color": "teal",
        "icon": "fa-shield-halved",
        "tagline": "Anti-hype, source-grounded",
        "desc": (
            "Win serious capital and researchers: every score delta drills to a "
            "verifiable primary source. No predictions, no PR — just the ground "
            "truth, citation by citation."
        ),
        "example": "“No predictions. No PR. Every point links to an arXiv paper or an SEC filing.”",
        "needs_vision": False,
    },
]

_DEFAULT_CONCEPT = "vision_bottleneck"
_PROMO_FALLBACK_CONCEPT = "high_level_pitch"
_VISION_ONLY_CONCEPTS = {s["key"] for s in STRATEGIES if s["needs_vision"]}
_VALID_CONCEPTS = {s["key"] for s in STRATEGIES}


def _parent_app(request: Request) -> FastAPI:
    """Walk back to the outer FastAPI app whose lifespan owns the DB engines."""
    inner = request.app
    parent = getattr(inner.state, "parent_app", None)
    if parent is None:
        raise RuntimeError("marketing cockpit view: parent_app reference missing")
    return parent


def _is_configured(key: str) -> bool:
    """Verify if an API key is loaded and not dummy/mock."""
    k = key.strip()
    if not k:
        return False
    kl = k.lower()
    return not (kl.startswith("mock") or kl.startswith("dummy"))


async def _load_guidelines(app: FastAPI) -> dict[str, str]:
    """Read the four custom tone/example guideline values from job_configs."""
    job_config = getattr(app.state, "job_config", None)
    keys = (
        "MARKETING_TONE_THREADS",
        "MARKETING_EXAMPLES_THREADS",
        "MARKETING_TONE_INSTAGRAM",
        "MARKETING_EXAMPLES_INSTAGRAM",
    )
    out = {k: "" for k in keys}
    if job_config is not None:
        for k in keys:
            out[k] = await job_config.get(k) or ""
    return out


def _compose_guidelines(g: dict[str, str]) -> str:
    """Build the operator-defined custom_guidelines block for the agent."""
    return (
        f"### Threads Platform Guidelines\n"
        f"- Tone & Style: {g['MARKETING_TONE_THREADS']}\n"
        f"- Example Post Copy:\n```\n{g['MARKETING_EXAMPLES_THREADS']}\n```\n\n"
        f"### Instagram Platform Guidelines\n"
        f"- Tone & Style: {g['MARKETING_TONE_INSTAGRAM']}\n"
        f"- Example Post Copy:\n```\n{g['MARKETING_EXAMPLES_INSTAGRAM']}\n```"
    )


class LLMMarketingView(BaseView):
    name = "Marketing Cockpit"
    icon = "fa-solid fa-bullhorn"
    category = "Financial"
    identity = "marketing"

    async def _list_visions(self, request: Request) -> list[tuple[str, str]]:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return []
        async with engine.connect() as conn:
            res = await conn.execute(
                text(
                    "SELECT slug, name FROM sectors "
                    "WHERE is_vision_eligible = TRUE AND status = 'live' "
                    "ORDER BY name ASC"
                )
            )
            return [(r[0], r[1]) for r in res.fetchall()]

    # ── Studio (sidebar landing — keep this the first exposed method) ──────
    @expose("/marketing", methods=["GET"])
    async def marketing_page(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        visions = await self._list_visions(request)
        guidelines = await _load_guidelines(app)
        guidelines_configured = any(v.strip() for v in guidelines.values())

        selected_concept = request.query_params.get("campaign_concept") or _DEFAULT_CONCEPT
        if selected_concept not in _VALID_CONCEPTS:
            selected_concept = _DEFAULT_CONCEPT

        return await self.templates.TemplateResponse(
            request,
            "marketing_studio.html",
            context={
                "title": "Marketing Studio",
                "subtitle": "Choose a strategy, then generate ready-to-post social copy.",
                "visions": visions,
                "strategies": STRATEGIES,
                "vision_only_concepts": sorted(_VISION_ONLY_CONCEPTS),
                "promo_fallback_concept": _PROMO_FALLBACK_CONCEPT,
                "selected_vision": request.query_params.get("vision_slug") or "",
                "selected_concept": selected_concept,
                "threads_configured": _is_configured(os.environ.get("THREADS_API_KEY", "")),
                "instagram_configured": _is_configured(os.environ.get("INSTAGRAM_API_KEY", "")),
                "guidelines_configured": guidelines_configured,
                "success_msg": request.query_params.get("success_msg"),
                "error_msg": request.query_params.get("error_msg"),
            },
        )

    # ── Settings (publishing keys + custom guidelines) ────────────────────
    @expose("/marketing/settings", methods=["GET"])
    async def marketing_settings(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        guidelines = await _load_guidelines(app)
        return await self.templates.TemplateResponse(
            request,
            "marketing_settings.html",
            context={
                "title": "Marketing Settings",
                "subtitle": "Publishing keys and custom platform tone / example guidelines.",
                "threads_configured": _is_configured(os.environ.get("THREADS_API_KEY", "")),
                "instagram_configured": _is_configured(os.environ.get("INSTAGRAM_API_KEY", "")),
                "threads_tone": guidelines["MARKETING_TONE_THREADS"],
                "threads_examples": guidelines["MARKETING_EXAMPLES_THREADS"],
                "instagram_tone": guidelines["MARKETING_TONE_INSTAGRAM"],
                "instagram_examples": guidelines["MARKETING_EXAMPLES_INSTAGRAM"],
                "success_msg": request.query_params.get("success_msg"),
                "error_msg": request.query_params.get("error_msg"),
            },
        )

    # ── Generate → render Review & Publish ────────────────────────────────
    @expose("/marketing/generate", methods=["POST"])
    async def marketing_generate(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        form_data = await request.form()
        vision_slug = (form_data.get("vision_slug") or "").strip()
        apply_guidelines = (form_data.get("apply_guidelines") or "false") == "true"
        campaign_concept = form_data.get("campaign_concept") or _DEFAULT_CONCEPT
        if campaign_concept not in _VALID_CONCEPTS:
            campaign_concept = _DEFAULT_CONCEPT

        platform_promo = not vision_slug
        # Vision-specific strategies make no sense without a vision — fall back.
        if platform_promo and campaign_concept in _VISION_ONLY_CONCEPTS:
            campaign_concept = _PROMO_FALLBACK_CONCEPT

        def _back_to_studio(error: str) -> RedirectResponse:
            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(
                    error_msg=error,
                    vision_slug=vision_slug,
                    campaign_concept=campaign_concept,
                ),
                status_code=303,
            )

        repo = getattr(app.state, "signal_repo", None)
        if repo is None and not platform_promo:
            return _back_to_studio("signal_repo not configured — DATABASE_URL is required.")

        web_base_url = os.environ.get("PUBLIC_WEB_BASE_URL", "http://localhost:3000")

        snapshot: dict[str, Any] | None
        if platform_promo:
            snapshot = {
                "vision_name": "Vision Feasibility Monitor",
                "vision_slug": "",
                "vision_url": f"{web_base_url.rstrip('/')}/visions",
                "capabilities": [],
                "notable_signal": None,
                "platform_promo": True,
            }
        else:
            assert repo is not None  # guarded above for the non-promo path
            job_config = getattr(app.state, "job_config", None)
            window_days = 7
            limit = 100
            if job_config is not None:
                window_days = await job_config.get_typed(
                    "RECOMPUTE_WINDOW_DAYS", default=7, kind="int"
                )
                limit = await job_config.get_typed("RECOMPUTE_LIMIT", default=100, kind="int")
            since = datetime.now(UTC) - timedelta(days=window_days)
            snapshot = await _build_snapshot(
                slug=vision_slug,
                repo=repo,
                web_base_url=web_base_url,
                since=since,
                limit=limit,
            )
            if snapshot is None:
                return _back_to_studio(
                    f"Vision '{vision_slug}' has no capabilities (nothing to "
                    "generate yet). Pick another vision, or generate a "
                    "platform-level post with no vision selected."
                )

        snapshot["campaign_concept"] = campaign_concept
        if apply_guidelines:
            snapshot["custom_guidelines"] = _compose_guidelines(await _load_guidelines(app))

        agent_url = os.environ.get("AGENT_ORCHESTRATION_URL", "http://localhost:8002")
        async with httpx.AsyncClient() as client:
            body = await _call_marketing_agent(
                agent_url=agent_url, client=client, snapshot=snapshot
            )

        if body is None:
            return _back_to_studio(
                "Failed to generate marketing copy via the LLM agent. Check the "
                "agent-orchestration logs."
            )

        post_set = body.get("post_set") or {}
        cost_usd = float(body.get("cost_usd", 0.0))

        formatted_posts = {}
        for post in post_set.get("posts", []):
            platform = post.get("platform")
            ko = post.get("ko") or {}
            en = post.get("en") or {}
            hashtags = " ".join(post.get("hashtags", []))
            formatted_posts[platform] = (
                f"[KO]\n"
                f"🔥 {ko.get('hook', '')}\n\n"
                f"{ko.get('body', '')}\n\n"
                f"📍 {ko.get('cta', '')}\n\n"
                f"[EN]\n"
                f"✨ {en.get('hook', '')}\n\n"
                f"{en.get('body', '')}\n\n"
                f"🔗 {en.get('cta', '')}\n\n"
                f"{hashtags}"
            ).strip()

        strategy = next((s for s in STRATEGIES if s["key"] == campaign_concept), STRATEGIES[0])
        return await self.templates.TemplateResponse(
            request,
            "marketing_review.html",
            context={
                "title": "Review & Publish",
                "subtitle": "Edit the generated copy, then publish per platform.",
                "active_vision": vision_slug,
                "platform_promo": platform_promo,
                "target_label": "Platform (no specific vision)"
                if platform_promo
                else snapshot.get("vision_name", vision_slug),
                "generated_posts": formatted_posts,
                "headline_insight": post_set.get("headline_insight", ""),
                "angle": post_set.get("angle", ""),
                "cost_usd": cost_usd,
                "strategy": strategy,
                "campaign_concept": campaign_concept,
                "threads_configured": _is_configured(os.environ.get("THREADS_API_KEY", "")),
                "instagram_configured": _is_configured(os.environ.get("INSTAGRAM_API_KEY", "")),
            },
        )

    @expose("/marketing/save-guidelines", methods=["POST"])
    async def marketing_save_guidelines(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        form_data = await request.form()
        values = {
            "MARKETING_TONE_THREADS": (form_data.get("threads_tone") or "").strip(),
            "MARKETING_EXAMPLES_THREADS": (form_data.get("threads_examples") or "").strip(),
            "MARKETING_TONE_INSTAGRAM": (form_data.get("instagram_tone") or "").strip(),
            "MARKETING_EXAMPLES_INSTAGRAM": (form_data.get("instagram_examples") or "").strip(),
        }

        base = request.url_for("admin:marketing_settings")
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE job_configs "
                        "SET value = :val, updated_at = NOW(), "
                        "updated_by = 'admin:marketing' WHERE key = :key"
                    ),
                    [{"val": v, "key": k} for k, v in values.items()],
                )

            job_config = getattr(app.state, "job_config", None)
            if job_config is not None and hasattr(job_config, "load"):
                await job_config.load()

            return RedirectResponse(
                base.include_query_params(success_msg="Custom tone and example guidelines saved."),
                status_code=303,
            )
        except Exception as e:
            log.exception("marketing: failed to save guidelines")
            return RedirectResponse(
                base.include_query_params(error_msg=f"Failed to save custom guidelines: {e}"),
                status_code=303,
            )

    @expose("/marketing/publish", methods=["POST"])
    async def marketing_publish(self, request: Request) -> Response:
        form_data = await request.form()
        vision_slug = form_data.get("vision_slug")
        platform = form_data.get("platform")
        copy = form_data.get("copy")

        if not platform or not copy:
            return Response(content="Missing required form parameters", status_code=400)

        base = request.url_for("admin:marketing_page")

        threads_key = os.environ.get("THREADS_API_KEY", "").strip()
        instagram_key = os.environ.get("INSTAGRAM_API_KEY", "").strip()

        if platform == "threads":
            key = threads_key
        elif platform == "instagram":
            key = instagram_key
        else:
            return Response(content=f"Invalid platform: {platform}", status_code=400)

        if not _is_configured(key):
            # Simulation Mode — no live key configured.
            log.info(
                "marketing: simulated publish to %s for %s: %s…",
                platform,
                vision_slug,
                copy[:100],
            )
            return RedirectResponse(
                base.include_query_params(
                    success_msg=(
                        f"Simulated publish to {platform.title()} "
                        f"({platform.title()} API key not configured — Simulation "
                        "Mode). Add a key in Settings to post for real."
                    )
                ),
                status_code=303,
            )

        try:
            async with httpx.AsyncClient() as client:
                if platform == "threads":
                    res = await client.post(
                        "https://graph.threads.net/v1.0/me/threads",
                        params={
                            "media_type": "TEXT",
                            "text": copy,
                            "access_token": key,
                        },
                        timeout=15.0,
                    )
                    if res.status_code >= 400:
                        raise RuntimeError(f"Threads API create container error: {res.text}")
                    container_id = res.json().get("id")
                    res_pub = await client.post(
                        "https://graph.threads.net/v1.0/me/threads_publish",
                        params={"creation_id": container_id, "access_token": key},
                        timeout=15.0,
                    )
                    if res_pub.status_code >= 400:
                        raise RuntimeError(f"Threads API publish container error: {res_pub.text}")
                    media_id = res_pub.json().get("id")
                    success_msg = f"Successfully posted to Threads! Media ID: {media_id}"
                else:  # instagram
                    # Instagram requires an image/video URL; text-only posts use
                    # a neutral placeholder image for the container.
                    placeholder_url = (
                        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe"
                        "?w=1200&auto=format&fit=crop&q=80"
                    )
                    res = await client.post(
                        "https://graph.facebook.com/v19.0/me/media",
                        params={
                            "image_url": placeholder_url,
                            "caption": copy,
                            "access_token": key,
                        },
                        timeout=15.0,
                    )
                    if res.status_code >= 400:
                        raise RuntimeError(f"Instagram API create container error: {res.text}")
                    container_id = res.json().get("id")
                    res_pub = await client.post(
                        "https://graph.facebook.com/v19.0/me/media_publish",
                        params={"creation_id": container_id, "access_token": key},
                        timeout=15.0,
                    )
                    if res_pub.status_code >= 400:
                        raise RuntimeError(f"Instagram API publish container error: {res_pub.text}")
                    media_id = res_pub.json().get("id")
                    success_msg = f"Successfully posted to Instagram! Media ID: {media_id}"

            return RedirectResponse(
                base.include_query_params(success_msg=success_msg), status_code=303
            )
        except Exception as e:
            log.exception("marketing: publish failed")
            return RedirectResponse(
                base.include_query_params(
                    error_msg=f"Publishing to {platform.title()} failed: {e}"
                ),
                status_code=303,
            )
