"""Single-tenant in-process Vision Builder progress slot.

Process-local module singleton (no Redis, no DB) holding the latest
pipeline's per-stage state. Conductor publishes events via
:func:`emit`; the admin UI polls :func:`snapshot` (proxied through the
``GET /vision-builder/progress/latest`` HTTP endpoint).

Trade-off: single global slot means the last submission wins — fine for
the single-operator dev environment. Multi-operator would need a
per-submission registry keyed by a submission_id threaded through the
data-pipeline → sector-service → agent-orchestration call chain;
deferred until prod requires it (see [[no-prod-compat]]).

Event taxonomy:
- ``pipeline_started`` — operator submits; ``current_stage`` is None,
  ``stages`` empty.
- ``stage_started`` — ``current_stage`` set, ``stages`` unchanged.
- ``stage_completed`` — ``current_stage`` cleared, a new entry
  appended to ``stages``.
- ``pipeline_complete`` — terminal; ``status`` flips to ``succeeded``
  or ``failed``.

The conductor's progress_sink callable wraps :func:`emit` so the
conductor stays pure — no module-level import of this singleton from
business logic.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

log = logging.getLogger(__name__)


ProgressStatus = Literal["running", "succeeded", "failed"]


@dataclass(frozen=True, slots=True)
class StageEvent:
    """One completed stage in the in-flight pipeline. Mirrors
    :class:`StageMetricDto` but lives in a separate dataclass so the
    progress module stays independent of the Pydantic schema layer."""

    name: str
    started_at: str        # ISO 8601 UTC
    duration_ms: int
    cost_usd: float
    output_summary: str | None = None


@dataclass
class _Slot:
    """The whole current snapshot. ``stages`` accumulates as the
    pipeline progresses; ``current_stage`` is the in-flight stage name
    (None when between stages or terminal)."""

    prompt: str = ""
    started_at: str = ""
    current_stage: str | None = None
    stages: list[StageEvent] = field(default_factory=list)
    total_cost_usd: float = 0.0
    status: ProgressStatus = "running"
    finished_at: str | None = None
    error: str | None = None


# Module singleton. Guarded by a lock because the HTTP polling endpoint
# (called from the FastAPI thread pool) and the conductor (called from
# the request handler's event loop) can race on read/write.
_lock = threading.Lock()
_slot: _Slot = _Slot(status="succeeded")  # empty initial state


def reset(*, prompt: str) -> None:
    """Operator submitted a new pipeline — wipe the slot and stamp
    ``prompt`` + ``started_at``. Called by the conductor's progress
    sink at the very start."""
    global _slot
    with _lock:
        _slot = _Slot(
            prompt=prompt,
            started_at=datetime.now(UTC).isoformat(timespec="seconds"),
            current_stage=None,
            stages=[],
            total_cost_usd=0.0,
            status="running",
            finished_at=None,
            error=None,
        )
    log.info("progress: pipeline_started prompt=%r", prompt[:80])


def stage_started(name: str) -> None:
    """One stage is about to start its LLM call (or pure-Python work).
    The UI flips its ``current_stage`` label to this."""
    with _lock:
        _slot.current_stage = name
    log.info("progress: stage_started %s", name)


def stage_completed(
    *,
    name: str,
    started_at: datetime,
    duration_ms: int,
    cost_usd: float,
    output_summary: str | None,
) -> None:
    """Stage finished cleanly. Append to ``stages``, clear
    ``current_stage`` (next stage_started will set it again), and
    accumulate cost."""
    with _lock:
        _slot.stages.append(
            StageEvent(
                name=name,
                started_at=started_at.astimezone(UTC).isoformat(timespec="seconds"),
                duration_ms=duration_ms,
                cost_usd=round(cost_usd, 6),
                output_summary=output_summary,
            )
        )
        _slot.total_cost_usd = round(_slot.total_cost_usd + cost_usd, 6)
        # Only clear current_stage if it matched what just completed —
        # avoids racing with the next stage_started.
        if _slot.current_stage == name:
            _slot.current_stage = None
    log.info(
        "progress: stage_completed %s duration=%dms cost=$%.4f",
        name,
        duration_ms,
        cost_usd,
    )


def pipeline_complete(
    *, status: ProgressStatus = "succeeded", error: str | None = None
) -> None:
    """Terminal event. ``status="failed"`` + ``error`` are set when
    the conductor or HTTP layer caught an exception. UI stops polling
    once it sees ``status != "running"``."""
    with _lock:
        _slot.current_stage = None
        _slot.status = status
        _slot.finished_at = datetime.now(UTC).isoformat(timespec="seconds")
        if error is not None:
            _slot.error = error
    log.info("progress: pipeline_complete status=%s", status)


def snapshot() -> dict[str, Any]:
    """Return the current slot as a JSON-serialisable dict. Called by
    the HTTP polling endpoint; returns the empty initial slot when no
    pipeline has run since boot."""
    with _lock:
        return {
            "prompt": _slot.prompt,
            "started_at": _slot.started_at,
            "current_stage": _slot.current_stage,
            "stages": [asdict(s) for s in _slot.stages],
            "total_cost_usd": _slot.total_cost_usd,
            "status": _slot.status,
            "finished_at": _slot.finished_at,
            "error": _slot.error,
        }
