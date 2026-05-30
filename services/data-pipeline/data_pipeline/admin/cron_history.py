"""In-memory ring buffer of APScheduler job executions.

Why this exists: APScheduler doesn't persist job-run history anywhere
we can query. Without it the operator opening /admin/queue can't tell
the difference between "scheduler armed but never fired" and
"scheduler firing every minute but always erroring 0 signals". With
this buffer the Queue + Crons page surfaces a "Recent runs" panel per
job — exactly the signal needed to diagnose ingest health.

Cap is per-job (default 20). Older entries evict. State is lost on
container restart — for a durable record use the `crawl_runs` table
(written by the on-demand fetchers + digest + orchestrator dispatcher;
bulk-sweep cron jobs deliberately skip it).
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class CronExecution:
    """One row in the per-job ring buffer."""

    job_id: str
    started_at: datetime
    ended_at: datetime | None
    status: str  # "running" | "ok" | "error" | "missed" | "max_instances"
    duration_ms: int | None
    error: str | None
    output_summary: str | None  # short string distilled from the job's return value
    output_data: dict[str, Any] | None = None


class CronHistoryBuffer:
    """Per-job ring buffer. Append-only with eviction by `maxlen`.

    Indexed by APScheduler `job_id`. `recent(job_id)` returns
    newest-first. `last_status(job_id)` is a convenience for the
    sidebar's per-job badge.
    """

    def __init__(self, *, per_job_cap: int = 20) -> None:
        self._cap = per_job_cap
        self._by_job: dict[str, deque[CronExecution]] = defaultdict(
            lambda: deque(maxlen=per_job_cap)
        )
        # Tracks the `started_at` for an in-flight execution so we can
        # compute duration on the matching EXECUTED/ERROR event. APScheduler
        # doesn't include start time on those events.
        self._inflight: dict[str, datetime] = {}

    # ── event handlers ──────────────────────────────────────────────

    def on_submitted(self, job_id: str) -> None:
        self._inflight[job_id] = datetime.now(UTC)

    def on_executed(self, job_id: str, retval: Any) -> None:
        started = self._inflight.pop(job_id, datetime.now(UTC))
        ended = datetime.now(UTC)
        
        output_data = None
        if retval is not None:
            try:
                import dataclasses
                if dataclasses.is_dataclass(retval):
                    output_data = dataclasses.asdict(retval)
                elif hasattr(retval, "model_dump"):
                    output_data = retval.model_dump()
                elif isinstance(retval, dict):
                    output_data = retval
            except Exception as exc:
                log.warning("Failed to extract output_data in cron_history: %s", exc)

        self._by_job[job_id].append(
            CronExecution(
                job_id=job_id,
                started_at=started,
                ended_at=ended,
                status="ok",
                duration_ms=_duration_ms(started, ended),
                error=None,
                output_summary=_summarize(retval),
                output_data=output_data,
            )
        )

    def on_error(self, job_id: str, exception: BaseException | None) -> None:
        started = self._inflight.pop(job_id, datetime.now(UTC))
        ended = datetime.now(UTC)
        msg = str(exception) if exception is not None else "unknown"
        # Most APScheduler exception messages also include the job_id —
        # trim hard so the table cell stays readable. Operators can hit
        # the container logs for the full traceback.
        self._by_job[job_id].append(
            CronExecution(
                job_id=job_id,
                started_at=started,
                ended_at=ended,
                status="error",
                duration_ms=_duration_ms(started, ended),
                error=msg[:500],
                output_summary=None,
            )
        )

    def on_missed(self, job_id: str, scheduled_run_time: datetime) -> None:
        """`EVENT_JOB_MISSED` fires when a job's scheduled time passed
        while the scheduler was paused/busy. Useful diagnostic: a job
        that's chronically `missed` likely has `max_instances=1` plus a
        previous run that's taking too long."""
        self._by_job[job_id].append(
            CronExecution(
                job_id=job_id,
                started_at=scheduled_run_time,
                ended_at=None,
                status="missed",
                duration_ms=None,
                error=None,
                output_summary="scheduled time missed (scheduler paused/busy)",
            )
        )

    def on_max_instances(self, job_id: str) -> None:
        """Fires when the job's `max_instances` cap blocked a new run.
        Diagnostic mirror of `missed`: this run was *attempted* but
        rejected because the previous one is still executing."""
        now = datetime.now(UTC)
        self._by_job[job_id].append(
            CronExecution(
                job_id=job_id,
                started_at=now,
                ended_at=now,
                status="max_instances",
                duration_ms=0,
                error=None,
                output_summary="prior run still executing — this trigger was dropped",
            )
        )

    # ── read access ─────────────────────────────────────────────────

    def recent(self, job_id: str, *, limit: int = 10) -> list[CronExecution]:
        """Newest-first. Empty list when the job hasn't fired yet."""
        items = list(self._by_job.get(job_id, deque()))
        items.reverse()
        return items[:limit]

    def last(self, job_id: str) -> CronExecution | None:
        deq = self._by_job.get(job_id)
        if not deq:
            return None
        return deq[-1]

    def all_job_ids(self) -> list[str]:
        return sorted(self._by_job.keys())


# ──────────────────────────────────────────────────────────────────────


def _duration_ms(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() * 1000)


def _summarize(retval: Any) -> str:
    """Turn a job's return value into a one-line operator hint. The
    individual `_run_*` functions return mostly Pydantic models or
    dicts — we try common attributes first, then fall back to repr.
    Kept defensive: a bad summarizer should never crash the listener."""
    if retval is None:
        return ""
    try:
        # Pydantic models (RefreshQuotesResult, IngestStats, etc.)
        if hasattr(retval, "model_dump"):
            d = retval.model_dump()
        elif isinstance(retval, dict):
            d = retval
        else:
            return repr(retval)[:200]
        # Pull a handful of common keys; format compactly.
        parts: list[str] = []
        for key in (
            "signals_written",
            "signals",
            "fetched",
            "scored",
            "score_writes",
            "feasibility_writes",
            "ok",
            "err",
            "visions",
            "rows_written",
            "quotes_written",
            "tickers",
            "duration_ms",
        ):
            if key in d:
                parts.append(f"{key}={d[key]}")
        if parts:
            return " ".join(parts)[:200]
        # Fallback: shallow dict repr trimmed.
        return repr(d)[:200]
    except Exception as exc:  # noqa: BLE001
        return f"<summarize failed: {exc}>"
