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
from typing import Final

from fastapi import FastAPI
from sqladmin import Admin
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from starlette.middleware.sessions import SessionMiddleware

from data_pipeline.admin.auth import AdminAuth
from data_pipeline.admin.views import ALL_VIEWS

log = logging.getLogger(__name__)

ADMIN_BASE_URL: Final = "/admin"
_ENGINE_ATTR: Final = "_sqladmin_engine"
_MOUNTED_ATTR: Final = "_sqladmin_mounted"


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

    admin = Admin(
        app=app,
        engine=engine,
        base_url=ADMIN_BASE_URL,
        title="data-pipeline admin",
        authentication_backend=AdminAuth(secret_key=secret),
    )
    for view_cls in ALL_VIEWS:
        admin.add_view(view_cls)

    app.state.admin = admin
    app.state._sqladmin_mounted = True  # noqa: SLF001
    log.info(
        "admin: mounted at %s with %d model views", ADMIN_BASE_URL, len(ALL_VIEWS)
    )
    return admin
