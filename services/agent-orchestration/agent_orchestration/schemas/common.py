"""Pydantic schemas — WorkflowStatus + WorkflowRecord (used by the runner).

Extracted from the monolithic ``schemas.py`` in slice 7. Imports the
union of Pydantic + stdlib helpers; ruff --fix --select F401 strips
per-file orphans after extraction.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel


class WorkflowStatus(str, Enum):
    """Mirrors Temporal's transitions so the swap to Temporal-backed
    is a renaming exercise, not a re-architecture."""

    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"

class WorkflowRecord(BaseModel):
    """The HTTP-facing view of a workflow. Excludes the per-call usage detail
    that lives on the runner — `cost_usd` is the rolled-up total."""

    id: str
    kind: str
    """Workflow type identifier, e.g. 'decomposition'."""
    status: WorkflowStatus
    created_at: datetime
    updated_at: datetime
    input: dict[str, Any]
    output: dict[str, Any] | None = None
    error: str | None = None
    cost_usd: float = 0.0


# ---- Domain: edge-inference output ---------------------------------------
