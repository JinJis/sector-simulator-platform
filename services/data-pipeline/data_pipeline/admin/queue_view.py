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
from data_pipeline.cron_specs import (
    CRON_SPECS,
    DISPLAY_ORDER,
    SPEC_BY_ID,
    build_trigger,
    enabled_key,
    schedule_key,
)

log = logging.getLogger(__name__)


# Mirror of `apps/admin/.../CronScheduleList.tsx :: JOB_INFO`. Keeping
# the two in sync is a short-lived problem — apps/admin gets deleted in
# step 5 of the M55 cockpit migration. After that this is the only copy.
# Per-cron metadata + display order live in data_pipeline.cron_specs
# (slice 13). Re-derive the legacy dict/order shapes the rest of this
# module + the template use, so the change is local to one import.
JOB_INFO: dict[str, dict[str, str]] = {
    spec.id: {
        "label": spec.label,
        "cadence": spec.cadence,
        "note": spec.note,
        "schedule_kind": spec.schedule_kind,
        "purpose": spec.purpose,
        "inputs": spec.inputs,
        "outputs": spec.outputs,
    }
    for spec in CRON_SPECS
}
JOB_ORDER: dict[str, int] = DISPLAY_ORDER


@dataclass(frozen=True, slots=True)
class _SchedulerRowVM:
    """Per-cron-job view model the Jinja template renders into one
    table row. Carries the bits the operator needs at a glance — label
    / cadence / paused state / next-run wall-clock / latest execution
    outcome — plus the slice 14 schedule edit fields (kind +
    current_value) so the inline form can render the right widget."""

    id: str
    label: str
    cadence: str
    note: str
    paused: bool
    next_run_iso: str | None
    # Slice 14 — JobConfig-backed schedule, surfaced in the inline
    # edit form. `schedule_kind` is "cron" or "interval_min";
    # `current_schedule` is the raw string the operator can edit
    # (e.g. "30 8 * * *" for cron, "5" for interval_min).
    schedule_kind: str
    current_schedule: str
    purpose: str
    inputs: str
    outputs: str
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


async def _scheduler_rows(app: FastAPI) -> tuple[list[_SchedulerRowVM], bool]:
    """Return (armed-rows, scheduler_present). The rows list is sorted
    by `JOB_ORDER`; unknown ids fall to the end alpha-sorted. Reads
    the current schedule value from `app.state.job_config` so the
    inline edit form renders what's actually driving the trigger."""
    scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
    if scheduler is None:
        return [], False
    history: CronHistoryBuffer | None = getattr(app.state, "cron_history", None)
    job_config = getattr(app.state, "job_config", None)
    rows: list[_SchedulerRowVM] = []
    for job in scheduler.get_jobs():
        info = JOB_INFO.get(
            job.id,
            {
                "label": job.id,
                "cadence": "—",
                "note": "",
                "schedule_kind": "cron",
                "purpose": "—",
                "inputs": "—",
                "outputs": "—",
            },
        )
        spec = SPEC_BY_ID.get(job.id)
        default_sched = spec.default_schedule_value if spec is not None else ""
        current_sched = default_sched
        if job_config is not None:
            current_sched = await job_config.get(
                schedule_key(job.id), default=default_sched
            ) or default_sched
        last = history.last(job.id) if history is not None else None
        recent = history.recent(job.id, limit=8) if history is not None else []
        rows.append(
            _SchedulerRowVM(
                id=job.id,
                label=info["label"],
                cadence=info["cadence"],
                note=info["note"],
                # APScheduler stores `next_run_time=None` while a job is
                # paused — that's the read we surface as "paused".
                paused=job.next_run_time is None,
                next_run_iso=(
                    job.next_run_time.isoformat()
                    if job.next_run_time is not None
                    else None
                ),
                schedule_kind=info["schedule_kind"],
                current_schedule=current_sched,
                purpose=info.get("purpose", "—"),
                inputs=info.get("inputs", "—"),
                outputs=info.get("outputs", "—"),
                last=last,
                recent=recent,
            )
        )
    rows.sort(key=lambda r: (JOB_ORDER.get(r.id, 99), r.id))
    return rows, True


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
        rows, scheduler_present = await _scheduler_rows(app)
        msg = request.query_params.get("msg", "")
        return await self.templates.TemplateResponse(
            request,
            "queue.html",
            context={
                "title": "Queue + Crons",
                "subtitle": (
                    "ARQ depth + every cron's live state. Pause/resume "
                    "writes to the job_configs table so the toggle "
                    "survives container restarts."
                ),
                "queue": queue_vm,
                "scheduler_present": scheduler_present,
                "rows": rows,
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

    @expose("/queue/scheduler/reschedule/{job_id}", methods=["POST"])
    async def reschedule(self, request: Request) -> Response:
        """Slice 14 — edit the schedule value for a cron. Validates
        per-spec (cron expression or float minutes), upserts the
        ``{id}.schedule`` JobConfig row, then calls
        ``scheduler.reschedule_job`` for live apply.

        Failure modes — all redirect back with `?msg=...`:
            - Unknown job id (spec not in SPEC_BY_ID).
            - Empty schedule value.
            - Bad cron expression / non-positive interval.
            - Scheduler not running (DATABASE_URL absent so no jobs
              registered)."""
        job_id = request.path_params["job_id"]
        form = await request.form()
        schedule_value = str(form.get("schedule", "")).strip()

        spec = SPEC_BY_ID.get(job_id)
        if spec is None:
            return _redirect_with_msg(
                request, f"reschedule failed: unknown cron id {job_id!r}"
            )
        if not schedule_value:
            return _redirect_with_msg(
                request, f"reschedule {job_id} failed: schedule value is empty"
            )

        try:
            trigger = build_trigger(spec.schedule_kind, schedule_value)
        except ValueError as exc:
            return _redirect_with_msg(
                request,
                f"reschedule {job_id} failed: invalid "
                f"{spec.schedule_kind} value {schedule_value!r} ({exc})",
            )

        app = _parent_app(request)
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        if scheduler is None:
            return _redirect_with_msg(request, "scheduler not running")
        try:
            scheduler.reschedule_job(job_id, trigger=trigger)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "queue view: reschedule on %s failed: %s", job_id, exc
            )
            return _redirect_with_msg(
                request,
                f"reschedule {job_id} failed: {exc}",
            )
        # Persist AFTER reschedule succeeds, so a bad value never
        # writes to the DB. Same pattern as the enable/disable toggle.
        store = getattr(app.state, "job_config", None)
        if store is not None:
            await store.upsert(
                key=schedule_key(job_id),
                value=schedule_value,
                kind=spec.schedule_kind,
                group="cron_schedule",
                description=(
                    f"Schedule for {spec.label}. "
                    + (
                        "5-field crontab expression (UTC)."
                        if spec.schedule_kind == "cron"
                        else "interval in minutes (float allowed)."
                    )
                ),
                updated_by="admin:queue",
            )
        log.info(
            "queue view: %s rescheduled to %s=%r",
            job_id,
            spec.schedule_kind,
            schedule_value,
        )
        return _redirect_with_msg(
            request,
            f"rescheduled {job_id} → {spec.schedule_kind}={schedule_value!r}",
        )

    async def _toggle(self, request: Request, *, action: str) -> Response:
        """Shared body for pause/resume/run. Mutates the running
        APScheduler AND (for pause/resume) persists the new enabled
        state to job_configs so the toggle survives a container
        restart. `run` is a one-shot kick — no DB write.
        """
        job_id = request.path_params["job_id"]
        app = _parent_app(request)
        scheduler: AsyncIOScheduler | None = getattr(app.state, "scheduler", None)
        if scheduler is None:
            return _redirect_with_msg(request, "scheduler not running")
        try:
            if action == "pause":
                scheduler.pause_job(job_id)
                await _persist_enabled(app, job_id=job_id, enabled=False)
                outcome = f"paused {job_id} (persisted)"
            elif action == "resume":
                scheduler.resume_job(job_id)
                await _persist_enabled(app, job_id=job_id, enabled=True)
                outcome = f"resumed {job_id} (persisted)"
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


async def _persist_enabled(
    app: FastAPI, *, job_id: str, enabled: bool
) -> None:
    """Write the new enabled flag to job_configs. Silent no-op when
    the JobConfigStore isn't on app.state (e.g., DATABASE_URL unset
    fell back to the in-memory variant — the boot loop still has the
    correct state from default_enabled, restart picks the same
    defaults)."""
    store = getattr(app.state, "job_config", None)
    if store is None:
        return
    await store.upsert(
        key=enabled_key(job_id),
        value="on" if enabled else "off",
        kind="schedule_toggle",
        group="cron_enabled",
        updated_by="admin:queue",
    )


def _redirect_with_msg(request: Request, msg: str) -> RedirectResponse:
    """Redirect back to /admin/queue with a flash-style message. SQLAdmin's
    layout doesn't render `?msg=` by default; our custom queue.html does.

    Route name is `admin:queue_page` — SQLAdmin's expose decorator
    derives the name from the handler's function name (`queue_page`),
    not the @expose path or the BaseView's `identity` field. The mount
    wraps it with the outer "admin" prefix.
    """
    base = request.url_for("admin:queue_page")
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
