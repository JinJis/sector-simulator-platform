"""Regression tests for the SQLAdmin Queue + Crons custom routes.

Specifically: the pause/resume/run-now actions all redirect back to
the queue index via `request.url_for("admin:queue_page")`. SQLAdmin's
`@expose` derives the route name from the handler's *function name*,
not from `@expose("/queue", ...)` or from `BaseView.identity`, so
typing the name as "admin:queue" (the path) raises NoMatchFound at
runtime. Pin the URL the redirect targets so a future rename of
`queue_page` doesn't silently break it again.
"""

from __future__ import annotations

import os

import pytest
from starlette.testclient import TestClient


# `_BypassAuth` patches `AdminAuth.authenticate` so the protected
# admin routes are reachable inside the test client. We can't import
# `data_pipeline.admin.auth` at module-import time because conftest
# tweaks env; do it inside the fixture.
@pytest.fixture
def client() -> TestClient:
    # Minimal env so the app's create_app() builds the scheduler + the
    # admin mount without erroring.
    os.environ.setdefault(
        "DATABASE_URL",
        "postgresql://platform:platform@localhost:6543/platform_dev",
    )
    os.environ.setdefault("ADMIN_SESSION_SECRET", "test-secret")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
    os.environ.setdefault("INGEST_SCHEDULE", "on")

    from data_pipeline.admin import auth  # noqa: PLC0415

    async def _ok(self, request):  # noqa: ANN001, ANN202, ARG001
        return True

    auth.AdminAuth.authenticate = _ok  # type: ignore[method-assign]

    from data_pipeline.main import create_app  # noqa: PLC0415

    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(
    "action",
    ["pause", "resume", "run"],
)
def test_queue_action_redirects_back_to_queue_page(
    client: TestClient, action: str
) -> None:
    """Every scheduler action returns 303 → /admin/queue with a `msg=`
    query param. Catches the NoMatchFound bug we hit at runtime when
    the route name was typed as `admin:queue` (the path) instead of
    `admin:queue_page` (the handler's __name__)."""
    # `refresh_quotes_daily` is always armed in the test env (INGEST_
    # SCHEDULE=on + the cron has no extra gate), so the modify_job
    # call has a real target.
    resp = client.post(
        f"/admin/queue/scheduler/{action}/refresh_quotes_daily",
        follow_redirects=False,
    )
    assert resp.status_code == 303, resp.text
    loc = resp.headers["location"]
    assert "/admin/queue" in loc, loc
    assert "msg=" in loc, loc
