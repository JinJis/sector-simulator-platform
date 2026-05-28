"""Custom SQLAdmin page: ARQ queue + APScheduler cron toggle.

Replaces the deprecated `apps/admin/data-pipeline/queue/page.tsx` +
`QueueLivePanel.tsx` + `CronScheduleList.tsx` trio. Reads the same
in-process state the FastAPI `/queue/status` and `/health` endpoints
report:

  - Queue snapshot from `app.state.queue_client.snapshot()` — depth,
    in-flight, worker count, deferred. Degrades to "offline" tile when
    Redis is unreachable.
  - APScheduler jobs from `app.state.scheduler.get_jobs()` — id, next
    run, paused/armed state.
  - JOB_INFO is the same human-friendly registry the legacy
    CronScheduleList carried (label / cadence / note per known job id);
    we mirror it here so the cockpit copy stays close to the actual
    job definitions in `main.py`'s lifespan.

Cron toggle: APScheduler's `scheduler.pause_job(id)` and `resume_job(id)`
mutate the running scheduler. The change lasts until the container
restarts (then the lifespan re-arms from env). Permanent off goes
through the env-gate (`*_SCHEDULE=off`) — note this in the UI.

Auto-refresh: `<meta http-equiv="refresh" content="5">` keeps the page
honest without dragging in a JS polling client. 5s matches the legacy
3s tile polling closely enough for the single-operator scale.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from sqladmin import BaseView, expose
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from data_pipeline.admin.cron_history import CronExecution, CronHistoryBuffer

log = logging.getLogger(__name__)


# Mirror of `apps/admin/.../CronScheduleList.tsx :: JOB_INFO`. Keeping
# the two in sync is a short-lived problem — apps/admin gets deleted in
# step 5 of the M55 cockpit migration. After that this is the only copy.
JOB_INFO: dict[str, dict[str, str]] = {
    "news_ingest_5min": {
        "label": "News ingest",
        "cadence": "every 5 min",
        "note": "crawl4ai over Yahoo + Naver + Finviz per vision ticker",
        "env_gate": "NEWS_INGEST_SCHEDULE",
    },
    "research_ingest_hourly": {
        "label": "Research ingest",
        "cadence": "hourly · :07 UTC",
        "note": "arXiv + USPTO per capability keyword set",
        "env_gate": "RESEARCH_INGEST_SCHEDULE",
    },
    "recompute_feasibility_hourly": {
        "label": "Recompute feasibility",
        "cadence": "hourly · :25 UTC",
        "note": "ScoreUpdater agent per capability → vision rollup",
        "env_gate": "",
    },
    "digest_daily": {
        "label": "DR digest (grounded)",
        "cadence": "daily · 06:00 UTC default",
        "note": "gemini-3.1-pro-preview synthesis per vision · ~$0.30/run",
        "env_gate": "DIGEST_SCHEDULE",
    },
    "orchestrator_tick_15min": {
        "label": "Orchestrator picker",
        "cadence": "every 15 min",
        "note": "M49f opportunistic fetcher dispatch",
        "env_gate": "ORCHESTRATOR_SCHEDULE",
    },
    "refresh_quotes_daily": {
        "label": "Refresh quotes",
        "cadence": "daily · 08:30 UTC default",
        "note": "yfinance equity snapshot for PredictionV2 anchor",
        "env_gate": "INGEST_SCHEDULE",
    },
    "resolve_predictions_v2_hourly": {
        "label": "Resolve predictions v2",
        "cadence": "hourly · :05 UTC",
        "note": "M46b band-based prediction resolver",
        "env_gate": "",
    },
}

# Stable display order; falls back to alpha for unknown ids.
JOB_ORDER: dict[str, int] = {
    "news_ingest_5min": 0,
    "orchestrator_tick_15min": 1,
    "resolve_predictions_v2_hourly": 2,
    "research_ingest_hourly": 3,
    "recompute_feasibility_hourly": 4,
    "refresh_quotes_daily": 5,
    "digest_daily": 6,
}


@dataclass(frozen=True, slots=True)
class _SchedulerRowVM:
    """Per-cron-job view model the Jinja template renders into one
    table row. Carries the bits the operator needs at a glance — label
    / cadence / paused state / next-run wall-clock / latest execution
    outcome — and the env gate name to point them at the permanent off
    switch."""

    id: str
    label: str
    cadence: str
    note: str
    env_gate: str
    paused: bool
    next_run_iso: str | None
    # Execution history from the in-memory CronHistoryBuffer. `last`
    # drives the per-row badge; `recent` is shown in a per-row
    # disclosure so the operator can scan recent outcomes without
    # leaving the page.
    last: CronExecution | None
    recent: list[CronExecution]


@dataclass(frozen=True, slots=True)
class _QueueVM:
    """Top-of-page queue snapshot. `available=False` means Redis is
    unreachable — tiles dim out, banner explains the cause."""

    available: bool
    queue_name: str
    queued: int
    in_progress: int
    workers: int
    deferred: int


def _parent_app(request: Request) -> FastAPI:
    """Walk back to the outer FastAPI app whose lifespan owns the
    scheduler + queue client. Same trick as `actions.parent_app` —
    SQLAdmin runs in its own inner Starlette."""
    inner = request.app
    parent = getattr(inner.state, "parent_app", None)
    if parent is None:
        raise RuntimeError(
            "queue view: parent_app reference missing — check mount_admin"
        )
    return parent


async def _queue_snapshot(app: FastAPI) -> _QueueVM:
    q = getattr(app.state, "queue_client", None)
    if q is None:
        return _QueueVM(
            available=False, queue_name="", queued=0, in_progress=0, workers=0,
            deferred=0,
        )
    try:
        snap = await q.snapshot()
    except Exception as exc:  # noqa: BLE001
        log.warning("queue view: snapshot failed: %s", exc)
        return _QueueVM(
            available=False, queue_name="", queued=0, in_progress=0, workers=0,
            deferred=0,
        )
    return _QueueVM(
        available=True,
        queue_name=snap.queue_name,
        queued=snap.queued,
        in_progress=snap.in_progress,
        workers=snap.workers,
        deferred=snap.deferred,
    )


def _scheduler_rows(app: FastAPI) -> tuple[list[_SchedulerRowVM], bool]:
    """Return (armed-rows, scheduler_present). The rows list is sorted
    by `JOB_ORDER`; unknown ids fall to the end alpha-sorted."""
    scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
    if scheduler is None:
        return [], False
    history: CronHistoryBuffer | None = getattr(app.state, "cron_history", None)
    rows: list[_SchedulerRowVM] = []
    for job in scheduler.get_jobs():
        info = JOB_INFO.get(
            job.id,
            {"label": job.id, "cadence": "—", "note": "", "env_gate": ""},
        )
        last = history.last(job.id) if history is not None else None
        recent = history.recent(job.id, limit=8) if history is not None else []
        rows.append(
            _SchedulerRowVM(
                id=job.id,
                label=info["label"],
                cadence=info["cadence"],
                note=info["note"],
                env_gate=info["env_gate"],
                # APScheduler stores `next_run_time=None` while a job is
                # paused — that's the read we surface as "paused".
                paused=job.next_run_time is None,
                next_run_iso=(
                    job.next_run_time.isoformat()
                    if job.next_run_time is not None
                    else None
                ),
                last=last,
                recent=recent,
            )
        )
    rows.sort(key=lambda r: (JOB_ORDER.get(r.id, 99), r.id))
    return rows, True


def _disabled_gates(armed_ids: set[str]) -> list[dict[str, str]]:
    """Known env-gated jobs that the lifespan chose NOT to arm — useful
    for operators who forgot the env var name. Returned in
    JOB_ORDER then alpha order."""
    disabled = [
        {"id": jid, **info}
        for jid, info in JOB_INFO.items()
        if info.get("env_gate") and jid not in armed_ids
    ]
    disabled.sort(key=lambda r: (JOB_ORDER.get(r["id"], 99), r["id"]))
    return disabled


class QueueView(BaseView):
    """Live ARQ queue depth + APScheduler cron list with pause/resume.

    `category="Operations"` slots it next to CrawlRun / CommunityProposal
    in the sidebar; the `fa-bolt` icon mirrors the lightning-bolt
    visual we used for the legacy /admin/data-pipeline/queue tab.
    """

    name = "Queue + Crons"
    icon = "fa-solid fa-bolt"
    category = "Operations"
    identity = "queue"  # used in URL name (admin:queue)

    @expose("/queue", methods=["GET"])
    async def queue_page(self, request: Request) -> Response:
        app = _parent_app(request)
        queue_vm = await _queue_snapshot(app)
        rows, scheduler_present = _scheduler_rows(app)
        armed_ids = {r.id for r in rows if not r.paused}
        disabled = _disabled_gates(armed_ids)
        msg = request.query_params.get("msg", "")
        return await self.templates.TemplateResponse(
            request,
            "queue.html",
            context={
                "title": "Queue + Crons",
                "subtitle": (
                    "ARQ depth + APScheduler armed jobs. "
                    "Pause/resume mutates the running scheduler; permanent off "
                    "is the env gate."
                ),
                "queue": queue_vm,
                "scheduler_present": scheduler_present,
                "rows": rows,
                "disabled": disabled,
                "now_utc": datetime.now(UTC).isoformat(timespec="seconds"),
                "msg": msg,
            },
        )

    @expose("/queue/scheduler/pause/{job_id}", methods=["POST"])
    async def pause_job(self, request: Request) -> Response:
        return await self._toggle(request, action="pause")

    @expose("/queue/scheduler/resume/{job_id}", methods=["POST"])
    async def resume_job(self, request: Request) -> Response:
        return await self._toggle(request, action="resume")

    @expose("/queue/scheduler/run/{job_id}", methods=["POST"])
    async def run_now(self, request: Request) -> Response:
        return await self._toggle(request, action="run")

    async def _toggle(self, request: Request, *, action: str) -> Response:
        """Shared body for pause/resume/run. Mutates the running
        APScheduler. We don't surface raw exceptions to the operator —
        instead we redirect back with `?msg=...` so the page banner
        shows the outcome.
        """
        job_id = request.path_params["job_id"]
        app = _parent_app(request)
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        if scheduler is None:
            return _redirect_with_msg(request, "scheduler not running")
        try:
            if action == "pause":
                scheduler.pause_job(job_id)
                outcome = f"paused {job_id}"
            elif action == "resume":
                scheduler.resume_job(job_id)
                outcome = f"resumed {job_id}"
            elif action == "run":
                # `modify_job(next_run_time=now)` is APScheduler's
                # idiomatic "run as soon as possible" — works regardless
                # of paused state and respects the configured executor.
                scheduler.modify_job(job_id, next_run_time=datetime.now(UTC))
                outcome = f"queued {job_id} for immediate run"
            else:  # defensive — only the three exposed handlers reach this
                outcome = f"unknown action {action!r}"
        except Exception as exc:  # noqa: BLE001
            log.warning("queue view: %s on %s failed: %s", action, job_id, exc)
            outcome = f"{action} on {job_id} failed: {exc}"
        log.info("queue view: %s", outcome)
        return _redirect_with_msg(request, outcome)


def _redirect_with_msg(request: Request, msg: str) -> RedirectResponse:
    """Redirect back to /admin/queue with a flash-style message. SQLAdmin's
    layout doesn't render `?msg=` by default; our custom queue.html does."""
    base = request.url_for("admin:queue")
    return RedirectResponse(base.include_query_params(msg=msg), status_code=303)


def _format_next_run(iso: str | None) -> str:
    """Render `2026-05-27T08:30:00+00:00` as `08:30:19 UTC` for the
    table cell. Falls back to em-dash when paused (next_run_iso=None)."""
    if not iso:
        return "—"
    return iso[11:19] + " UTC"


# Exported for the template — Jinja can call it as `format_next_run(iso)`.
TEMPLATE_GLOBALS = {
    "format_next_run": _format_next_run,
}
