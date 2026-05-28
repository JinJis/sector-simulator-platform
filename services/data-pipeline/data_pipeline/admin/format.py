"""Timezone + datetime display helpers for the SQLAdmin cockpit.

Postgres stores everything as `timestamptz` (UTC). The admin surface
is for a single Korean operator, so we render every visible timestamp
in KST (Asia/Seoul, UTC+9) — the user shouldn't have to do mental
conversion.

Two surfaces need the conversion:

  1. **SQLAdmin ModelView columns** (auto-rendered datetime fields).
     `column_type_formatters` on each ModelView maps `datetime` to
     `kst_datetime_formatter`.

  2. **Custom Jinja templates** (queue.html, vision_dashboard.html,
     crawl_run_signals.html). Registered as a Jinja filter `kst` so
     the template can write `{{ row.last.started_at | kst('%H:%M:%S') }}`.

Override via `ADMIN_DISPLAY_TZ` env (e.g., `UTC` or `America/Los_Angeles`)
if a future operator isn't on KST. Falls back to KST when unset/invalid.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

log = logging.getLogger(__name__)


def _resolve_display_tz() -> ZoneInfo:
    raw = os.environ.get("ADMIN_DISPLAY_TZ", "Asia/Seoul").strip()
    try:
        return ZoneInfo(raw or "Asia/Seoul")
    except ZoneInfoNotFoundError:
        log.warning(
            "admin: ADMIN_DISPLAY_TZ=%r not recognised; falling back to Asia/Seoul",
            raw,
        )
        return ZoneInfo("Asia/Seoul")


# Resolved once at import; ADMIN_DISPLAY_TZ changes require a container
# restart, same contract as the other admin env vars.
DISPLAY_TZ: ZoneInfo = _resolve_display_tz()

# Short tag the templates render next to the time so the operator can
# tell at a glance what zone they're seeing. "KST" for Seoul, otherwise
# the tzinfo abbreviation at *now* (best-effort).
DISPLAY_TZ_LABEL: str = (
    "KST" if str(DISPLAY_TZ) == "Asia/Seoul" else datetime.now(DISPLAY_TZ).strftime("%Z")
)


def to_display_tz(dt: datetime | None) -> datetime | None:
    """Convert a UTC (or naive-assumed-UTC) datetime into DISPLAY_TZ.
    Postgres returns timezone-aware datetimes via asyncpg, but the
    SQLAlchemy session sometimes hands us naive ones — assume those are
    UTC rather than guess local time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(DISPLAY_TZ)


def format_display(
    dt: datetime | None,
    fmt: str = "%Y-%m-%d %H:%M:%S",
    *,
    with_tz: bool = False,
) -> str:
    """Render `dt` in DISPLAY_TZ. `with_tz=True` appends " KST" (or
    whatever the configured tz is)."""
    converted = to_display_tz(dt)
    if converted is None:
        return "—"
    out = converted.strftime(fmt)
    return f"{out} {DISPLAY_TZ_LABEL}" if with_tz else out


# ──────────────────────────────────────────────────────────────────────
# SQLAdmin integration
# ──────────────────────────────────────────────────────────────────────


def kst_datetime_formatter(value: Any) -> str:
    """Used as the `datetime` entry in `column_type_formatters` on each
    ModelView. SQLAdmin invokes this for every visible datetime column —
    list view, details view, and search results."""
    if not isinstance(value, datetime):
        return str(value) if value is not None else ""
    return format_display(value, fmt="%Y-%m-%d %H:%M:%S", with_tz=True)


# Drop-in `column_type_formatters` for every ModelView in the cockpit.
# Mirrors SQLAdmin's `BASE_FORMATTERS` (None / bool) and adds the
# datetime override.
KST_TYPE_FORMATTERS: dict[type, Any] = {
    type(None): lambda _: "",
    bool: None,  # populated at import to avoid a circular reference
    datetime: kst_datetime_formatter,
}


def _populate_bool_formatter() -> None:
    """Carry over SQLAdmin's tick/cross bool formatter so overriding
    `column_type_formatters` per-view doesn't lose it."""
    from sqladmin.formatters import bool_formatter  # noqa: PLC0415

    KST_TYPE_FORMATTERS[bool] = bool_formatter


_populate_bool_formatter()


# ──────────────────────────────────────────────────────────────────────
# Jinja integration
# ──────────────────────────────────────────────────────────────────────


def register_jinja_filters(env: Any) -> None:
    """Register the `kst` filter + a `kst_label` global on the Jinja env.

    Usage in templates:

        {{ row.last.started_at | kst('%H:%M:%S') }}    {# 17:30:25 #}
        {{ row.last.started_at | kst }}                {# 2026-05-28 17:30:25 #}
        {{ now_utc | kst('%Y-%m-%d %H:%M:%S', true) }} {# 2026-05-28 17:30:25 KST #}

    `kst_label` is `'KST'` for Seoul (or the tz abbreviation otherwise)
    so templates can render the suffix conditionally.
    """

    def _kst(
        dt: datetime | str | None,
        fmt: str = "%Y-%m-%d %H:%M:%S",
        with_tz: bool = False,
    ) -> str:
        # The `now_utc` context var is an ISO string (we render it that
        # way in queue_view.py for compactness). Parse on the way in so
        # the template can call `| kst` on either type.
        parsed: datetime | None
        if isinstance(dt, str):
            try:
                parsed = datetime.fromisoformat(dt)
            except ValueError:
                return dt  # leave malformed strings untouched
        else:
            parsed = dt
        return format_display(parsed, fmt=fmt, with_tz=with_tz)

    env.filters["kst"] = _kst
    env.globals["kst_label"] = DISPLAY_TZ_LABEL
