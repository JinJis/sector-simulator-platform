"""AuthenticationBackend for SQLAdmin.

Reuses the existing single-account env-driven scheme from the
deprecated Next.js admin app (`ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`ADMIN_SESSION_SECRET`) so existing operators don't need to learn a
new credential. Session cookie is signed with `itsdangerous`
(HMAC-SHA256, 7d TTL) — same shape as the Next.js cookie, different
name to avoid stomping on a parallel deploy.

Why not OAuth: this is a single-admin internal cockpit; adding an
identity provider here is overkill for the current scale. Swap in
`fastapi-users` or Authlib if the operator count grows.
"""

from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from starlette.responses import RedirectResponse

log = logging.getLogger(__name__)

ADMIN_SESSION_COOKIE = "tssp_admin_sqladmin_session"
# Match the Next.js admin's 7d session TTL.
SESSION_TTL_SECONDS = 7 * 24 * 3600


def _secret() -> str | None:
    raw = os.environ.get("ADMIN_SESSION_SECRET", "").strip()
    return raw or None


def _expected_email() -> str | None:
    raw = os.environ.get("ADMIN_EMAIL", "").strip()
    return raw or None


def _expected_password() -> str | None:
    raw = os.environ.get("ADMIN_PASSWORD", "").strip()
    return raw or None


class AdminAuth(AuthenticationBackend):
    """Single-account session cookie. Three env vars must be set;
    otherwise the login form refuses every attempt (no silent bypass)."""

    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = str(form.get("username", "")).strip()
        password = str(form.get("password", ""))
        expected_email = _expected_email()
        expected_password = _expected_password()
        secret = _secret()

        if not (expected_email and expected_password and secret):
            log.warning(
                "admin login: refused — ADMIN_EMAIL/PASSWORD/SESSION_SECRET not configured"
            )
            return False
        # constant-time compare to avoid timing oracle on credentials
        if not hmac.compare_digest(email, expected_email):
            return False
        if not hmac.compare_digest(password, expected_password):
            return False

        serializer = URLSafeTimedSerializer(secret, salt="admin-session")
        token = serializer.dumps(
            {
                "email": email,
                "iat": datetime.now(timezone.utc).isoformat(),
            }
        )
        # SQLAdmin uses Starlette's SessionMiddleware (set up in mount.py)
        # so storing the token in request.session is enough; the response
        # cookie is signed by Starlette itself with SECRET_KEY.
        request.session["admin_token"] = token
        return True

    async def logout(self, request: Request) -> bool:
        request.session.pop("admin_token", None)
        return True

    async def authenticate(self, request: Request) -> bool | RedirectResponse:
        token = request.session.get("admin_token")
        if not token:
            return False
        secret = _secret()
        if not secret:
            return False
        serializer = URLSafeTimedSerializer(secret, salt="admin-session")
        try:
            payload = serializer.loads(token, max_age=SESSION_TTL_SECONDS)
        except SignatureExpired:
            request.session.pop("admin_token", None)
            return False
        except BadSignature:
            request.session.pop("admin_token", None)
            return False
        expected_email = _expected_email()
        if expected_email and payload.get("email") != expected_email:
            # The expected email rotated (deploy change); existing
            # cookies are no longer valid.
            request.session.pop("admin_token", None)
            return False
        return True


def session_ttl_delta() -> timedelta:
    return timedelta(seconds=SESSION_TTL_SECONDS)
