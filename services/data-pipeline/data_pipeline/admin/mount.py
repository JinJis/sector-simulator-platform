"""Mount-point for the SQLAdmin surface.

`mount_admin(app)` is called once from `data_pipeline.main.create_app`.
It wires:
  - An async SQLAlchemy engine pointed at the same Postgres DB Prisma
    manages, derived from DATABASE_URL.
  - The SessionMiddleware that SQLAdmin's AuthenticationBackend needs
    for its `request.session` access.
  - The AdminAuth backend + every ModelView in `views.ALL_VIEWS`.

Idempotent: a re-call (e.g., reload during dev) inspects whether the
admin is already mounted before re-registering.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Final

from fastapi import FastAPI
from sqladmin import Admin
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from data_pipeline.admin.auth import AdminAuth
from data_pipeline.admin.format import register_jinja_filters
from data_pipeline.admin.queue_view import QueueView
from data_pipeline.admin.views import ALL_VIEWS
from data_pipeline.admin.vision_builder_view import VisionBuilderView

log = logging.getLogger(__name__)

ADMIN_BASE_URL: Final = "/admin"
_ENGINE_ATTR: Final = "_sqladmin_engine"
_MOUNTED_ATTR: Final = "_sqladmin_mounted"


class _ForceSchemeMiddleware:
    """Pin the ASGI scope's `scheme` to a fixed value (http/https).

    Use when running behind a TLS-terminating proxy that doesn't set
    `X-Forwarded-Proto` — e.g., the Google Cloud Workstation proxy
    serving `*.proxy.googlers.com`. Without it, uvicorn's `--proxy-
    headers` flag has no header to honor and SQLAdmin's templates render
    `http://` static URLs on an `https://` page, which every modern
    browser blocks as Mixed Content. The admin then shows up as raw
    HTML with no styling.

    Gate this with `ADMIN_FORCE_URL_SCHEME=https` in the env when the
    proxy is known to terminate TLS. Leave unset in environments where
    the upstream `X-Forwarded-Proto` header is actually trustworthy.
    """

    def __init__(self, app: ASGIApp, *, scheme: str) -> None:
        if scheme not in ("http", "https"):
            raise ValueError(f"scheme must be http|https, got {scheme!r}")
        self.app = app
        self.scheme = scheme

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") in ("http", "websocket"):
            scope = {**scope, "scheme": self.scheme}
        await self.app(scope, receive, send)


def _async_dsn() -> str | None:
    """Translate the Prisma-style sync DSN into an asyncpg-compatible one.

    `DATABASE_URL` is whatever Prisma wants (e.g.,
    `postgresql://user:pass@host:port/db`). SQLAlchemy needs the
    `postgresql+asyncpg://` scheme so it picks the asyncpg driver.
    """
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        return None
    if raw.startswith("postgresql+asyncpg://"):
        return raw
    if raw.startswith("postgresql://"):
        return "postgresql+asyncpg://" + raw[len("postgresql://") :]
    if raw.startswith("postgres://"):
        return "postgresql+asyncpg://" + raw[len("postgres://") :]
    return raw


def mount_admin(app: FastAPI) -> Admin | None:
    """Mount SQLAdmin onto `app` at `/admin`. Returns the Admin instance
    on success, or None if `DATABASE_URL` isn't configured (the
    data-pipeline can still serve its non-admin endpoints).

    The SessionMiddleware uses `ADMIN_SESSION_SECRET` as its signing
    key — same secret the AuthenticationBackend signs its token with.
    Without it, sessions can't be created and the login form refuses
    every credential (handled in auth.AdminAuth.login).
    """
    if getattr(app.state, _MOUNTED_ATTR, False):
        log.info("admin: already mounted, skipping")
        return getattr(app.state, "admin", None)

    dsn = _async_dsn()
    if not dsn:
        log.warning(
            "admin: DATABASE_URL not set, /admin disabled — set it to mount"
        )
        return None

    secret = os.environ.get("ADMIN_SESSION_SECRET", "").strip()
    if not secret:
        # SessionMiddleware insists on a SECRET_KEY; without one the
        # whole admin surface can't sign cookies, so we refuse to
        # mount rather than crash later on first request.
        log.warning(
            "admin: ADMIN_SESSION_SECRET not set, /admin disabled — set it to mount"
        )
        return None

    engine: AsyncEngine = create_async_engine(
        dsn,
        # Tight pool — admin is low-traffic. Asyncpg + SQLAlchemy
        # default pool size 5 is fine; we explicitly cap to make the
        # operator aware that this engine is meant for a single
        # browser tab, not the user app's hot path.
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
    )
    app.state._sqladmin_engine = engine  # noqa: SLF001

    # SessionMiddleware → SQLAdmin AuthenticationBackend reads
    # request.session for the signed admin token. Cookie name is
    # explicit to avoid clashing with any other session cookie a
    # mounted app might set.
    app.add_middleware(
        SessionMiddleware,
        secret_key=secret,
        session_cookie="tssp_admin_session",
        same_site="lax",
        # 7 days — matches the AuthenticationBackend's max_age check.
        max_age=7 * 24 * 3600,
    )

    # Optional scheme override for environments behind a proxy that
    # strips / omits X-Forwarded-Proto. See _ForceSchemeMiddleware
    # docstring for the rationale. Starlette wraps middlewares in LIFO
    # order, so adding this AFTER SessionMiddleware means the scheme
    # override runs first on the inbound path — which is what we want.
    forced = os.environ.get("ADMIN_FORCE_URL_SCHEME", "").strip().lower()
    if forced in ("http", "https"):
        app.add_middleware(_ForceSchemeMiddleware, scheme=forced)
        log.info("admin: ADMIN_FORCE_URL_SCHEME=%s — scheme pinned for url_for", forced)

    # `templates_dir` is added to the Jinja loader BEFORE SQLAdmin's
    # own PackageLoader, so files we drop in `admin/templates/` take
    # precedence — that's how `queue.html` (rendered by QueueView)
    # extends `sqladmin/layout.html` cleanly.
    templates_dir = str(Path(__file__).parent / "templates")
    admin = Admin(
        app=app,
        engine=engine,
        base_url=ADMIN_BASE_URL,
        title="data-pipeline admin",
        authentication_backend=AdminAuth(secret_key=secret),
        templates_dir=templates_dir,
    )
    # SQLAdmin creates its own inner Starlette and mounts it on `app`.
    # `request.app` inside any action handler resolves to the INNER
    # Starlette — not the FastAPI app whose lifespan owns
    # `crawl_runs_repo` / `queue_client` / `proposal_writer`. Stash a
    # back-reference so `admin/actions.py :: parent_app(request)` can
    # walk back to the outer app state at action time.
    admin.admin.state.parent_app = app

    # Register the `kst` Jinja filter + `kst_label` global so custom
    # templates can render every datetime in the operator's display
    # timezone (ADMIN_DISPLAY_TZ, default Asia/Seoul).
    register_jinja_filters(admin.templates.env)

    for view_cls in ALL_VIEWS:
        admin.add_view(view_cls)
    # Custom Queue + Crons page — not tied to a SQLAlchemy model.
    admin.add_base_view(QueueView)
    # Vision Builder wizard — three-step Jinja flow that forwards to
    # sector-service tRPC for the heavy commit transaction.
    admin.add_base_view(VisionBuilderView)

    # Register the secure dashboard endpoints on the main FastAPI app
    from data_pipeline.admin.dashboard_api import router as dashboard_api_router
    app.include_router(dashboard_api_router)

    app.state.admin = admin
    app.state._sqladmin_mounted = True  # noqa: SLF001
    log.info(
        "admin: mounted at %s with %d model views", ADMIN_BASE_URL, len(ALL_VIEWS)
    )
    return admin
