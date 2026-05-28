"""Per-vision activity dashboard for the SQLAdmin cockpit.

`/admin/vision/<slug>/dashboard` — one page that rolls up the last 24h
of ingest activity for a single vision so the operator doesn't have to
cross-reference four ModelViews to answer "is this vision healthy?".

Panels:
  1. Vision header (name, status, vision_question, current composite +
     binding capability + ETA from `vision_feasibility`)
  2. 24h activity tiles (signals written, crawl runs by status,
     capability_score writes)
  3. Recent crawl runs (10 most recent) with status badges + cost
  4. Recent signals (10 most recent) with source_url + per-dim delta
  5. Current capability scores (one row per capability with composite +
     4-dim breakdown + last-updated)

Reads run via the shared `crawl_runs_repo` asyncpg pool — separate
SQLAlchemy session would be redundant when the data we need is
purely tabular reads.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
from fastapi import FastAPI
from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger(__name__)


# ── view models ────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class _VisionHeaderVM:
    slug: str
    name: str
    status: str
    vision_question: str | None
    composite: float | None
    composite_p10: float | None
    composite_p90: float | None
    binding_capability_key: str | None
    eta_median_years: float | None
    feasibility_as_of: datetime | None


@dataclass(frozen=True, slots=True)
class _ActivityTilesVM:
    """Numbers covering the last 24h. Drives the small stat cards."""

    signals_24h: int
    signals_highlighted_24h: int
    crawl_runs_24h: int
    crawl_runs_ok_24h: int
    crawl_runs_failed_24h: int
    score_writes_24h: int
    cost_usd_24h: float  # sum of crawl_runs.cost_usd over the window


@dataclass(frozen=True, slots=True)
class _CrawlRunRowVM:
    id: str
    fetcher_kind: str
    status: str
    cost_usd: float | None
    signals_written: int
    started_at: datetime
    duration_ms: int | None
    error_excerpt: str | None


@dataclass(frozen=True, slots=True)
class _SignalRowVM:
    id: str
    title: str
    source_kind: str
    source_url: str
    published_at: datetime
    delta_technical: float | None
    delta_economic: float | None
    delta_regulatory: float | None
    delta_supply: float | None
    is_highlight: bool


@dataclass(frozen=True, slots=True)
class _CapabilityScoreRowVM:
    capability_id: str
    capability_key: str
    capability_name: str
    weight: float
    composite: float | None
    technical: float | None
    economic: float | None
    regulatory: float | None
    supply: float | None
    as_of: datetime


# ── data loaders ───────────────────────────────────────────────────────


def _parent_app(request: Request) -> FastAPI:
    inner = request.app
    parent = getattr(inner.state, "parent_app", None)
    if parent is None:
        raise RuntimeError(
            "vision dashboard: parent_app reference missing — check mount_admin"
        )
    return parent


def _pool(request: Request) -> asyncpg.Pool:
    """Reuse the asyncpg pool the CrawlRunRepository built at lifespan.
    Sharing one pool keeps connection count tight; the dashboard is
    low-traffic single-operator and doesn't need its own."""
    state = _parent_app(request).state
    repo = getattr(state, "crawl_runs_repo", None)
    if repo is None or getattr(repo, "pool", None) is None:
        raise RuntimeError(
            "vision dashboard: asyncpg pool unavailable — DATABASE_URL not set?"
        )
    return repo.pool


async def _load_header(pool: asyncpg.Pool, slug: str) -> _VisionHeaderVM | None:
    """Sector row + most-recent `is_current=true` VisionFeasibility row.
    Returns None when no Sector with that slug — caller renders 404."""
    async with pool.acquire() as conn:
        s = await conn.fetchrow(
            "SELECT slug, name, status, vision_question FROM sectors WHERE slug = $1",
            slug,
        )
        if s is None:
            return None
        f = await conn.fetchrow(
            """
                SELECT composite, composite_p10, composite_p90,
                       binding_capability_key, eta_median_years, as_of
                FROM vision_feasibility
                WHERE sector_slug = $1 AND is_current = true
                ORDER BY as_of DESC
                LIMIT 1
            """,
            slug,
        )
    return _VisionHeaderVM(
        slug=s["slug"],
        name=s["name"],
        status=s["status"],
        vision_question=s["vision_question"],
        composite=(float(f["composite"]) if f and f["composite"] is not None else None),
        composite_p10=(
            float(f["composite_p10"])
            if f and f["composite_p10"] is not None
            else None
        ),
        composite_p90=(
            float(f["composite_p90"])
            if f and f["composite_p90"] is not None
            else None
        ),
        binding_capability_key=(
            f["binding_capability_key"] if f else None
        ),
        eta_median_years=(
            float(f["eta_median_years"])
            if f and f["eta_median_years"] is not None
            else None
        ),
        feasibility_as_of=(f["as_of"] if f else None),
    )


async def _load_activity_tiles(
    pool: asyncpg.Pool, slug: str, since: datetime
) -> _ActivityTilesVM:
    async with pool.acquire() as conn:
        sigs = await conn.fetchrow(
            """
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE is_highlight) AS highlighted
                FROM signals
                WHERE sector_slug = $1 AND ingested_at >= $2
            """,
            slug,
            since,
        )
        runs = await conn.fetchrow(
            """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'ok') AS ok,
                    COUNT(*) FILTER (WHERE status IN ('failed', 'over_budget')) AS failed,
                    COALESCE(SUM(cost_usd), 0) AS cost_sum
                FROM crawl_runs
                WHERE vision_slug = $1 AND started_at >= $2
            """,
            slug,
            since,
        )
        scores = await conn.fetchrow(
            """
                SELECT COUNT(*) AS total
                FROM capability_scores cs
                JOIN capabilities c ON c.id = cs.capability_id
                WHERE c.sector_slug = $1 AND cs.created_at >= $2
            """,
            slug,
            since,
        )
    return _ActivityTilesVM(
        signals_24h=int(sigs["total"] or 0),
        signals_highlighted_24h=int(sigs["highlighted"] or 0),
        crawl_runs_24h=int(runs["total"] or 0),
        crawl_runs_ok_24h=int(runs["ok"] or 0),
        crawl_runs_failed_24h=int(runs["failed"] or 0),
        score_writes_24h=int(scores["total"] or 0),
        cost_usd_24h=float(runs["cost_sum"] or 0),
    )


async def _load_recent_runs(
    pool: asyncpg.Pool, slug: str, *, limit: int
) -> list[_CrawlRunRowVM]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
                SELECT id, fetcher_kind, status, cost_usd, signals_written,
                       started_at, ended_at, error
                FROM crawl_runs
                WHERE vision_slug = $1
                ORDER BY started_at DESC
                LIMIT $2
            """,
            slug,
            limit,
        )
    out: list[_CrawlRunRowVM] = []
    for r in rows:
        duration_ms = None
        if r["ended_at"] is not None:
            duration_ms = int(
                (r["ended_at"] - r["started_at"]).total_seconds() * 1000
            )
        out.append(
            _CrawlRunRowVM(
                id=r["id"],
                fetcher_kind=r["fetcher_kind"],
                status=r["status"],
                cost_usd=(float(r["cost_usd"]) if r["cost_usd"] is not None else None),
                signals_written=int(r["signals_written"] or 0),
                started_at=r["started_at"],
                duration_ms=duration_ms,
                error_excerpt=(r["error"][:200] if r["error"] else None),
            )
        )
    return out


async def _load_recent_signals(
    pool: asyncpg.Pool, slug: str, *, limit: int
) -> list[_SignalRowVM]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
                SELECT id, title, source_kind, source_url, published_at,
                       delta_technical, delta_economic, delta_regulatory,
                       delta_supply, is_highlight
                FROM signals
                WHERE sector_slug = $1
                ORDER BY ingested_at DESC
                LIMIT $2
            """,
            slug,
            limit,
        )
    return [
        _SignalRowVM(
            id=r["id"],
            title=r["title"],
            source_kind=r["source_kind"],
            source_url=r["source_url"],
            published_at=r["published_at"],
            delta_technical=(
                float(r["delta_technical"]) if r["delta_technical"] is not None else None
            ),
            delta_economic=(
                float(r["delta_economic"]) if r["delta_economic"] is not None else None
            ),
            delta_regulatory=(
                float(r["delta_regulatory"])
                if r["delta_regulatory"] is not None
                else None
            ),
            delta_supply=(
                float(r["delta_supply"]) if r["delta_supply"] is not None else None
            ),
            is_highlight=bool(r["is_highlight"]),
        )
        for r in rows
    ]


async def _load_current_scores(
    pool: asyncpg.Pool, slug: str
) -> list[_CapabilityScoreRowVM]:
    """One row per capability with the most-recent `is_current=true`
    CapabilityScore. Empty list when the vision has no capabilities
    yet (M41-pre vision) or no scores yet (just-committed vision)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
                SELECT
                    c.id AS capability_id,
                    c.key AS capability_key,
                    c.name AS capability_name,
                    c.weight AS weight,
                    c.display_order AS display_order,
                    cs.composite, cs.technical, cs.economic,
                    cs.regulatory, cs.supply, cs.as_of
                FROM capabilities c
                LEFT JOIN LATERAL (
                    SELECT composite, technical, economic, regulatory, supply, as_of
                    FROM capability_scores
                    WHERE capability_id = c.id AND is_current = true
                    ORDER BY as_of DESC
                    LIMIT 1
                ) cs ON true
                WHERE c.sector_slug = $1
                ORDER BY c.display_order, c.key
            """,
            slug,
        )
    return [
        _CapabilityScoreRowVM(
            capability_id=r["capability_id"],
            capability_key=r["capability_key"],
            capability_name=r["capability_name"],
            weight=float(r["weight"]) if r["weight"] is not None else 0.0,
            composite=(float(r["composite"]) if r["composite"] is not None else None),
            technical=(float(r["technical"]) if r["technical"] is not None else None),
            economic=(float(r["economic"]) if r["economic"] is not None else None),
            regulatory=(
                float(r["regulatory"]) if r["regulatory"] is not None else None
            ),
            supply=(float(r["supply"]) if r["supply"] is not None else None),
            as_of=r["as_of"] or datetime.now(UTC),
        )
        for r in rows
    ]


async def _load_signals_in_run_window(
    pool: asyncpg.Pool, *, sector_slug: str, started_at: datetime,
    ended_at: datetime | None, limit: int = 20,
) -> list[_SignalRowVM]:
    """Heuristic match: signals from this vision with `ingested_at`
    between the run's start and end timestamps. Without a `crawl_run_id`
    FK on `signals` this is the best we can do for "what did THIS run
    actually write"; for the bulk-sweep ingests (news/research) the
    window is usually short enough that the match is precise."""
    end = ended_at or datetime.now(UTC)
    # Pad slightly so a signal whose ingested_at is a hair past the
    # crawl_run.ended_at (clock skew, batch flush) is still surfaced.
    end_padded = end + timedelta(seconds=5)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
                SELECT id, title, source_kind, source_url, published_at,
                       delta_technical, delta_economic, delta_regulatory,
                       delta_supply, is_highlight
                FROM signals
                WHERE sector_slug = $1
                  AND ingested_at BETWEEN $2 AND $3
                ORDER BY ingested_at DESC
                LIMIT $4
            """,
            sector_slug,
            started_at,
            end_padded,
            limit,
        )
    return [
        _SignalRowVM(
            id=r["id"],
            title=r["title"],
            source_kind=r["source_kind"],
            source_url=r["source_url"],
            published_at=r["published_at"],
            delta_technical=(
                float(r["delta_technical"]) if r["delta_technical"] is not None else None
            ),
            delta_economic=(
                float(r["delta_economic"]) if r["delta_economic"] is not None else None
            ),
            delta_regulatory=(
                float(r["delta_regulatory"])
                if r["delta_regulatory"] is not None
                else None
            ),
            delta_supply=(
                float(r["delta_supply"]) if r["delta_supply"] is not None else None
            ),
            is_highlight=bool(r["is_highlight"]),
        )
        for r in rows
    ]


# ── views ──────────────────────────────────────────────────────────────


class VisionDashboardView(BaseView):
    """Per-vision activity rollup. Linked from the sidebar entry +
    from a SectorView row action (set up in views.py)."""

    name = "Vision dashboard"
    icon = "fa-solid fa-gauge-high"
    category = "Vision"
    identity = "vision-dashboard"

    @expose("/vision-dashboard", methods=["GET"])
    async def index(self, request: Request) -> Response:
        """No-slug landing — list every vision so the operator can pick
        one. Linking sidebar entries to a slug-parameterised page is
        clunky in SQLAdmin; this two-step is fine."""
        pool = _pool(request)
        async with pool.acquire() as conn:
            sectors = await conn.fetch(
                """
                    SELECT slug, name, status, vision_question, updated_at
                    FROM sectors
                    WHERE is_vision_eligible = true
                    ORDER BY name
                """
            )
        return await self.templates.TemplateResponse(
            request,
            "vision_dashboard_index.html",
            context={
                "title": "Vision dashboard",
                "subtitle": "Pick a vision to see the last 24h of ingest activity.",
                "sectors": [dict(s) for s in sectors],
            },
        )

    @expose("/vision/{slug}/dashboard", methods=["GET"])
    async def vision_page(self, request: Request) -> Response:
        slug = request.path_params["slug"]
        pool = _pool(request)
        header = await _load_header(pool, slug)
        if header is None:
            return await self.templates.TemplateResponse(
                request,
                "vision_dashboard_404.html",
                context={
                    "title": "Vision not found",
                    "subtitle": f"No sector with slug {slug!r}.",
                    "slug": slug,
                },
                status_code=404,
            )
        since = datetime.now(UTC) - timedelta(hours=24)
        tiles = await _load_activity_tiles(pool, slug, since)
        runs = await _load_recent_runs(pool, slug, limit=12)
        signals = await _load_recent_signals(pool, slug, limit=12)
        scores = await _load_current_scores(pool, slug)
        return await self.templates.TemplateResponse(
            request,
            "vision_dashboard.html",
            context={
                "title": f"{header.name} — dashboard",
                "subtitle": f"24h activity for {header.slug}",
                "header": header,
                "tiles": tiles,
                "runs": runs,
                "signals": signals,
                "scores": scores,
                "now_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            },
        )

    @expose("/crawl-run/{run_id}/signals", methods=["GET"])
    async def run_signals_page(self, request: Request) -> Response:
        """Linked signals for a single crawl_run. Approximate: matches by
        (sector + ingested_at within [started_at, ended_at+5s]). Without
        a `crawl_run_id` FK on `signals` this is the best heuristic;
        accurate for the on-demand fetchers (1 run = 1 signal) and
        usable for digest (1 run = 1 signal anchored on binding cap)."""
        run_id = request.path_params["run_id"]
        pool = _pool(request)
        async with pool.acquire() as conn:
            run = await conn.fetchrow(
                """
                    SELECT id, vision_slug, fetcher_kind, status, cost_usd,
                           signals_written, error, started_at, ended_at,
                           result_summary
                    FROM crawl_runs
                    WHERE id = $1
                """,
                run_id,
            )
        if run is None:
            return await self.templates.TemplateResponse(
                request,
                "vision_dashboard_404.html",
                context={
                    "title": "Crawl run not found",
                    "subtitle": f"No crawl_run with id {run_id!r}.",
                    "slug": "",
                },
                status_code=404,
            )
        sigs = await _load_signals_in_run_window(
            pool,
            sector_slug=run["vision_slug"],
            started_at=run["started_at"],
            ended_at=run["ended_at"],
        )
        return await self.templates.TemplateResponse(
            request,
            "crawl_run_signals.html",
            context={
                "title": "Crawl run signals",
                "subtitle": (
                    f"Signals likely written by run "
                    f"{run['fetcher_kind']}/{run['vision_slug']}."
                ),
                "run": dict(run),
                "signals": sigs,
            },
        )


# Helper for templates — pretty-print a dict to a single-line summary.
def _fmt_dict(d: Any) -> str:
    if d is None:
        return "—"
    if not isinstance(d, dict):
        return str(d)
    parts = [f"{k}={v!r}" for k, v in d.items()]
    return ", ".join(parts)[:400]
