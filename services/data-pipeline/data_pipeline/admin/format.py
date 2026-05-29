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

import json
import logging
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from markupsafe import Markup, escape

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


# ──────────────────────────────────────────────────────────────────────
# JSON / dict pretty-printer
# ──────────────────────────────────────────────────────────────────────


def _json_default(obj: Any) -> Any:
    """Last-resort serializer for values json.dumps doesn't know about
    (datetime, UUID, Decimal, etc.) — convert to ISO/string so the cell
    still renders something readable instead of raising TypeError."""
    if isinstance(obj, datetime):
        return format_display(obj, with_tz=True)
    return str(obj)


# ──────────────────────────────────────────────────────────────────────
# Status badge (lifecycle column on Sector + Workflow + Proposal etc.)
# ──────────────────────────────────────────────────────────────────────

# Map common lifecycle statuses to Tabler's `bg-*-lt` (light) badge
# classes so an operator can see at-a-glance whether a row is live
# (green), in review (yellow), terminated (gray), or errored (red).
# Falls back to neutral secondary when an unmapped value lands —
# defensive against future statuses, no need to crash the list view.
_STATUS_BADGE_TONES: dict[str, str] = {
    # Sector lifecycle (schema.prisma: draft | live | archived)
    "live": "green",
    "draft": "yellow",
    "archived": "secondary",
    # Workflow + crawl run lifecycle (pending → running → succeeded / failed)
    "pending": "azure",
    "queued": "azure",
    "running": "blue",
    "succeeded": "green",
    "ok": "green",
    "failed": "red",
    "error": "red",
    "cancelled": "secondary",
    "skipped": "secondary",
    # Community proposal lifecycle
    "proposed": "azure",
    "applied": "green",
    "rejected": "red",
    "stale": "secondary",
}


def status_badge_formatter(obj: Any, prop: Any) -> Markup | str:
    """Render a status string as a Tabler `badge bg-<tone>-lt` pill so
    list / detail views show colored tags instead of bare text. Pass
    via `column_formatters = {Model.status: status_badge_formatter}`
    on the ModelView.

    SQLAdmin invokes `column_formatters` entries as `(obj, prop)` —
    the row instance plus the property name (string, after SQLAdmin
    normalises the InstrumentedAttribute key). Note this is a *different*
    signature than `column_type_formatters`, which passes `(value)`."""
    value = getattr(obj, prop, None) if isinstance(prop, str) else getattr(
        obj, getattr(prop, "key", str(prop)), None
    )
    if value is None or value == "":
        return ""
    s = str(value)
    tone = _STATUS_BADGE_TONES.get(s.lower(), "secondary")
    return Markup(f'<span class="badge bg-{tone}-lt">{escape(s)}</span>')


def json_pretty_formatter(value: Any) -> Markup | str:
    """Render dict / list JSONB columns as indented, wrap-friendly
    `<pre>` blocks. Returned as `Markup` so SQLAdmin's Jinja templates
    won't HTML-escape the wrapping markup. Truncation is left to the
    CSS (`max-height` + `overflow-y: auto`) so the operator can scroll
    inside the cell without the page growing unboundedly."""
    if value is None:
        return ""
    try:
        text = json.dumps(
            value, indent=2, ensure_ascii=False, default=_json_default, sort_keys=False
        )
    except (TypeError, ValueError):
        text = str(value)
    return Markup(f'<pre class="admin-pretty">{escape(text)}</pre>')


# Drop-in `column_type_formatters` for every ModelView in the cockpit.
# Mirrors SQLAdmin's `BASE_FORMATTERS` (None / bool) and adds the
# datetime override + JSON pretty-printer for JSONB columns.
KST_TYPE_FORMATTERS: dict[type, Any] = {
    type(None): lambda _: "",
    bool: None,  # populated at import to avoid a circular reference
    datetime: kst_datetime_formatter,
    dict: json_pretty_formatter,
    list: json_pretty_formatter,
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
