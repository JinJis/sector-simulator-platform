"""Custom SQLAdmin page: LLM Marketing Cockpit.

Enables manual bilingual content generation per active vision, copy review,
custom platform guidelines (tone/style & examples), and manual publishing
to Threads & Instagram Graph APIs.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import FastAPI
from sqladmin import BaseView, expose
from sqlalchemy import text
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from data_pipeline.jobs.marketing_digest import _build_snapshot, _call_marketing_agent

log = logging.getLogger(__name__)


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


class LLMMarketingView(BaseView):
    name = "Marketing Cockpit"
    icon = "fa-solid fa-bullhorn"
    category = "Financial"
    identity = "marketing"

    @expose("/marketing", methods=["GET"])
    async def marketing_page(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        async with engine.connect() as conn:
            # Query active sectors (is_vision_eligible = True, status = 'live')
            res = await conn.execute(
                text(
                    "SELECT slug, name FROM sectors "
                    "WHERE is_vision_eligible = TRUE AND status = 'live' "
                    "ORDER BY slug ASC"
                )
            )
            visions = [(r[0], r[1]) for r in res.fetchall()]

        threads_key = os.environ.get("THREADS_API_KEY", "")
        instagram_key = os.environ.get("INSTAGRAM_API_KEY", "")

        # Fetch style and example guidelines from job_configs
        job_config = getattr(app.state, "job_config", None)
        threads_tone = ""
        threads_examples = ""
        instagram_tone = ""
        instagram_examples = ""

        if job_config is not None:
            threads_tone = await job_config.get("MARKETING_TONE_THREADS") or ""
            threads_examples = await job_config.get("MARKETING_EXAMPLES_THREADS") or ""
            instagram_tone = await job_config.get("MARKETING_TONE_INSTAGRAM") or ""
            instagram_examples = await job_config.get("MARKETING_EXAMPLES_INSTAGRAM") or ""

        return await self.templates.TemplateResponse(
            request,
            "marketing_cockpit.html",
            context={
                "title": "Marketing Cockpit",
                "subtitle": (
                    "Manual social content builder. Generate high-impact "
                    "bilingual copy, review/edit, and publish to social platforms."
                ),
                "visions": visions,
                "threads_configured": _is_configured(threads_key),
                "instagram_configured": _is_configured(instagram_key),
                "active_vision": None,
                "generated_posts": None,
                "threads_tone": threads_tone,
                "threads_examples": threads_examples,
                "instagram_tone": instagram_tone,
                "instagram_examples": instagram_examples,
                "has_applied_guidelines": "true",
                "success_msg": request.query_params.get("success_msg"),
                "error_msg": request.query_params.get("error_msg"),
            },
        )

    @expose("/marketing/generate", methods=["POST"])
    async def marketing_generate(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        form_data = await request.form()
        vision_slug = form_data.get("vision_slug")
        apply_guidelines = form_data.get("apply_guidelines") or "false"

        if not vision_slug:
            return Response(content="Missing vision_slug parameter", status_code=400)

        async with engine.connect() as conn:
            res = await conn.execute(
                text(
                    "SELECT slug, name FROM sectors "
                    "WHERE is_vision_eligible = TRUE AND status = 'live' "
                    "ORDER BY slug ASC"
                )
            )
            visions = [(r[0], r[1]) for r in res.fetchall()]

        # Load guidelines values from job_config to preserve UI settings
        job_config = getattr(app.state, "job_config", None)
        threads_tone = ""
        threads_examples = ""
        instagram_tone = ""
        instagram_examples = ""

        if job_config is not None:
            threads_tone = await job_config.get("MARKETING_TONE_THREADS") or ""
            threads_examples = await job_config.get("MARKETING_EXAMPLES_THREADS") or ""
            instagram_tone = await job_config.get("MARKETING_TONE_INSTAGRAM") or ""
            instagram_examples = await job_config.get("MARKETING_EXAMPLES_INSTAGRAM") or ""

        repo = getattr(app.state, "signal_repo", None)
        if repo is None:
            return await self.templates.TemplateResponse(
                request,
                "marketing_cockpit.html",
                context={
                    "title": "Marketing Cockpit",
                    "subtitle": "Manual social content builder.",
                    "visions": visions,
                    "threads_configured": False,
                    "instagram_configured": False,
                    "active_vision": vision_slug,
                    "generated_posts": None,
                    "threads_tone": threads_tone,
                    "threads_examples": threads_examples,
                    "instagram_tone": instagram_tone,
                    "instagram_examples": instagram_examples,
                    "has_applied_guidelines": apply_guidelines,
                    "error_msg": "signal_repo not configured — DATABASE_URL is required.",
                },
            )

        # Read JobConfigs or defaults
        window_days = 7
        limit = 100
        if job_config is not None:
            window_days = await job_config.get_typed(
                "RECOMPUTE_WINDOW_DAYS", default=7, kind="int"
            )
            limit = await job_config.get_typed(
                "RECOMPUTE_LIMIT", default=100, kind="int"
            )

        since = datetime.now(UTC) - timedelta(days=window_days)
        web_base_url = os.environ.get("PUBLIC_WEB_BASE_URL", "http://localhost:3000")

        snapshot = await _build_snapshot(
            slug=vision_slug,
            repo=repo,
            web_base_url=web_base_url,
            since=since,
            limit=limit,
        )

        if snapshot is None:
            msg = f"Vision '{vision_slug}' has no capabilities (nothing to generate yet)."
            return await self.templates.TemplateResponse(
                request,
                "marketing_cockpit.html",
                context={
                    "title": "Marketing Cockpit",
                    "subtitle": "Manual social content builder.",
                    "visions": visions,
                    "threads_configured": False,
                    "instagram_configured": False,
                    "active_vision": vision_slug,
                    "generated_posts": None,
                    "threads_tone": threads_tone,
                    "threads_examples": threads_examples,
                    "instagram_tone": instagram_tone,
                    "instagram_examples": instagram_examples,
                    "has_applied_guidelines": apply_guidelines,
                    "error_msg": msg,
                },
            )

        # Inject custom tone and examples guidelines if requested by operator
        if apply_guidelines == "true":
            snapshot["custom_guidelines"] = (
                f"### Threads Platform Guidelines\n"
                f"- Tone & Style: {threads_tone}\n"
                f"- Example Post Copy:\n```\n{threads_examples}\n```\n\n"
                f"### Instagram Platform Guidelines\n"
                f"- Tone & Style: {instagram_tone}\n"
                f"- Example Post Copy:\n```\n{instagram_examples}\n```"
            )

        agent_url = os.environ.get("AGENT_ORCHESTRATION_URL", "http://localhost:8002")
        async with httpx.AsyncClient() as client:
            body = await _call_marketing_agent(
                agent_url=agent_url,
                client=client,
                snapshot=snapshot,
            )

        if body is None:
            msg = "Failed to generate marketing copy via LLM Agent. Check agent logs."
            return await self.templates.TemplateResponse(
                request,
                "marketing_cockpit.html",
                context={
                    "title": "Marketing Cockpit",
                    "subtitle": "Manual social content builder.",
                    "visions": visions,
                    "threads_configured": False,
                    "instagram_configured": False,
                    "active_vision": vision_slug,
                    "generated_posts": None,
                    "threads_tone": threads_tone,
                    "threads_examples": threads_examples,
                    "instagram_tone": instagram_tone,
                    "instagram_examples": instagram_examples,
                    "has_applied_guidelines": apply_guidelines,
                    "error_msg": msg,
                },
            )

        post_set = body.get("post_set") or {}
        cost_usd = float(body.get("cost_usd", 0.0))
        headline_insight = post_set.get("headline_insight", "")
        angle = post_set.get("angle", "")

        # Format posts cleanly for editing in textareas
        formatted_posts = {}
        for post in post_set.get("posts", []):
            platform = post.get("platform")
            ko = post.get("ko") or {}
            en = post.get("en") or {}
            hashtags = " ".join(post.get("hashtags", []))

            formatted_text = (
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
            formatted_posts[platform] = formatted_text

        threads_key = os.environ.get("THREADS_API_KEY", "")
        instagram_key = os.environ.get("INSTAGRAM_API_KEY", "")

        return await self.templates.TemplateResponse(
            request,
            "marketing_cockpit.html",
            context={
                "title": "Marketing Cockpit",
                "subtitle": "Manual social content builder.",
                "visions": visions,
                "threads_configured": _is_configured(threads_key),
                "instagram_configured": _is_configured(instagram_key),
                "active_vision": vision_slug,
                "generated_posts": formatted_posts,
                "headline_insight": headline_insight,
                "angle": angle,
                "cost_usd": cost_usd,
                "threads_tone": threads_tone,
                "threads_examples": threads_examples,
                "instagram_tone": instagram_tone,
                "instagram_examples": instagram_examples,
                "has_applied_guidelines": apply_guidelines,
                "success_msg": "Marketing copy generated successfully!",
            },
        )

    @expose("/marketing/save-guidelines", methods=["POST"])
    async def marketing_save_guidelines(self, request: Request) -> Response:
        app = _parent_app(request)
        engine = getattr(app.state, "_sqladmin_engine", None)
        if engine is None:
            return Response(content="Database engine not loaded", status_code=500)

        form_data = await request.form()
        threads_tone = (form_data.get("threads_tone") or "").strip()
        threads_examples = (form_data.get("threads_examples") or "").strip()
        instagram_tone = (form_data.get("instagram_tone") or "").strip()
        instagram_examples = (form_data.get("instagram_examples") or "").strip()

        # Persist all four guidelines using transactional engine.begin()
        try:
            async with engine.begin() as conn:
                stmt = (
                    "UPDATE job_configs "
                    "SET value = :val, updated_at = NOW(), updated_by = 'admin:marketing' "
                    "WHERE key = :key"
                )
                await conn.execute(
                    text(stmt),
                    [
                        {"val": threads_tone, "key": "MARKETING_TONE_THREADS"},
                        {"val": threads_examples, "key": "MARKETING_EXAMPLES_THREADS"},
                        {"val": instagram_tone, "key": "MARKETING_TONE_INSTAGRAM"},
                        {
                            "val": instagram_examples,
                            "key": "MARKETING_EXAMPLES_INSTAGRAM",
                        },
                    ],
                )

            # Refresh in-memory job_config cache if supported
            job_config = getattr(app.state, "job_config", None)
            if job_config is not None and hasattr(job_config, "load"):
                await job_config.load()

            success_msg = "Custom tone and example guidelines saved successfully!"
            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(success_msg=success_msg), status_code=303
            )

        except Exception as e:
            log.exception("marketing: failed to save guidelines")
            error_msg = f"Failed to save custom guidelines: {e}"
            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(error_msg=error_msg), status_code=303
            )

    @expose("/marketing/publish", methods=["POST"])
    async def marketing_publish(self, request: Request) -> Response:
        form_data = await request.form()
        vision_slug = form_data.get("vision_slug")
        platform = form_data.get("platform")
        copy = form_data.get("copy")

        if not vision_slug or not platform or not copy:
            return Response(content="Missing required form parameters", status_code=400)

        # Check API keys
        threads_key = os.environ.get("THREADS_API_KEY", "").strip()
        instagram_key = os.environ.get("INSTAGRAM_API_KEY", "").strip()

        is_mock = False
        key = ""
        if platform == "threads":
            key = threads_key
            if not _is_configured(key):
                is_mock = True
        elif platform == "instagram":
            key = instagram_key
            if not _is_configured(key):
                is_mock = True
        else:
            return Response(content=f"Invalid platform: {platform}", status_code=400)

        if is_mock:
            # Simulation Mode success
            success_msg = (
                f"Simulated publish to {platform.title()} successfully! "
                f"({platform.title()} API Key was not configured, running in Simulation Mode)"
            )
            log.info(
                "marketing: simulated publish to %s for %s: %s",
                platform,
                vision_slug,
                copy[:100] + "...",
            )
            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(success_msg=success_msg), status_code=303
            )

        # Real Graph API publish!
        try:
            async with httpx.AsyncClient() as client:
                if platform == "threads":
                    # 1. Create container
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

                    # 2. Publish container
                    res_pub = await client.post(
                        "https://graph.threads.net/v1.0/me/threads_publish",
                        params={
                            "creation_id": container_id,
                            "access_token": key,
                        },
                        timeout=15.0,
                    )
                    if res_pub.status_code >= 400:
                        raise RuntimeError(f"Threads API publish container error: {res_pub.text}")
                    media_id = res_pub.json().get("id")
                    success_msg = f"Successfully posted to Threads! Media ID: {media_id}"

                elif platform == "instagram":
                    # Note: Instagram requires an image/video URL.
                    # Since we only have text, we use a placeholder image for the post.
                    placeholder_url = (
                        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe"
                        "?w=1200&auto=format&fit=crop&q=80"
                    )

                    # 1. Create container
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

                    # 2. Publish container
                    res_pub = await client.post(
                        "https://graph.facebook.com/v19.0/me/media_publish",
                        params={
                            "creation_id": container_id,
                            "access_token": key,
                        },
                        timeout=15.0,
                    )
                    if res_pub.status_code >= 400:
                        raise RuntimeError(f"Instagram API publish container error: {res_pub.text}")
                    media_id = res_pub.json().get("id")
                    success_msg = f"Successfully posted to Instagram! Media ID: {media_id}"

            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(success_msg=success_msg), status_code=303
            )

        except Exception as e:
            log.exception("marketing: publish failed")
            error_msg = f"Publishing to {platform.title()} failed: {e}"
            base = request.url_for("admin:marketing_page")
            return RedirectResponse(
                base.include_query_params(error_msg=error_msg), status_code=303
            )
