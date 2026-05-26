"""HTTP client for the data-pipeline service (M49c).

Crawler fetchers don't run M39 adapters (arXiv / USPTO / NewsAPI) in-
process — those live in `services/data-pipeline/data_pipeline/signals/`
and are owned by the daily ingest cron. The crawler orchestrator just
asks the data-pipeline to run an ingest scoped to one (vision ×
capability) via this client; the data-pipeline writes the resulting
Signal rows directly. Crawler keeps the CrawlRun bookkeeping +
cost / count surfacing.

Mirrors the pattern of `agents.py` (HTTP wrapper for agent-
orchestration's SignalExtractor).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Schemas — mirror data-pipeline /jobs/signal-ingest/scope shape
# --------------------------------------------------------------------------


class ScopedIngestRequest(BaseModel):
    sector_slug: str
    capability_keys: list[str] | None = None
    lookback_days: int = Field(default=3, ge=1, le=30)
    per_capability_limit: int = Field(default=10, ge=1, le=100)


class ScopedIngestResult(BaseModel):
    started_at: str
    finished_at: str | None = None
    visions_processed: int = 0
    capabilities_processed: int = 0
    raw_signals_fetched: int = 0
    extractor_calls: int = 0
    extractor_failures: int = 0
    signals_written: int = 0
    extractor_total_cost_usd: float = 0.0
    errors: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


def default_data_pipeline_url() -> str | None:
    base = os.environ.get("DATA_PIPELINE_URL", "").strip()
    return base or None


class DataPipelineClient(Protocol):
    async def scoped_signal_ingest(self, req: ScopedIngestRequest) -> ScopedIngestResult: ...


@dataclass
class HttpDataPipelineClient:
    """Production client. Tests inject a fake `DataPipelineClient`."""

    base_url: str
    timeout_seconds: float = 120.0

    async def scoped_signal_ingest(self, req: ScopedIngestRequest) -> ScopedIngestResult:
        url = f"{self.base_url.rstrip('/')}/jobs/signal-ingest/scope"
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            resp = await client.post(url, json=req.model_dump(mode="json"))
            resp.raise_for_status()
            payload: Any = resp.json()
        return ScopedIngestResult.model_validate(payload)
