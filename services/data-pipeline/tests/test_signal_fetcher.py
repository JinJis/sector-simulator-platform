"""Offline tests for SignalFetcher + the /fetchers/signal/run endpoint.
All dependencies (CrawlRunRepo, CapabilityReader, the injected
signal_ingest callable) faked. Mirrors the test_capability_fetcher.py /
test_actor_fetcher.py shape."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from data_pipeline.main import create_app
from data_pipeline.crawl_run_repo import CrawlRunRow
from data_pipeline.db.capability_reader import CapabilityRecord
from data_pipeline.deep_research.fetchers.signal import (
    SignalFetcherError,
    SignalFetchRequest,
    run_signal_fetcher,
)
from data_pipeline.jobs.signal_ingest import IngestStats
from fastapi.testclient import TestClient

# --------------------------------------------------------------------------
# In-memory fakes
# --------------------------------------------------------------------------


@dataclass
class _InMemoryRunsRepo:
    rows: dict[str, CrawlRunRow] = field(default_factory=dict)
    _seq: int = 0

    async def create_queued(
        self, *, vision_slug: str, fetcher_kind: str, plan: dict[str, Any]
    ) -> CrawlRunRow:
        self._seq += 1
        rid = f"cr_test_{self._seq}"
        row = CrawlRunRow(
            id=rid,
            vision_slug=vision_slug,
            fetcher_kind=fetcher_kind,
            status="queued",
            plan=plan,
            result_summary=None,
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=None,
            started_at=datetime.now(UTC),
            ended_at=None,
        )
        self.rows[rid] = row
        return row

    async def mark_running(self, run_id: str) -> None:
        self.rows[run_id] = _replace(self.rows[run_id], status="running")

    async def mark_complete(
        self,
        run_id: str,
        *,
        status: str,
        result_summary: dict[str, Any] | None,
        cost_usd: float | None,
        signals_written: int,
        proposals_written: int,
        error: str | None,
    ) -> None:
        prev = self.rows[run_id]
        self.rows[run_id] = _replace(
            prev,
            status=status,
            result_summary=result_summary,
            cost_usd=cost_usd,
            signals_written=signals_written,
            proposals_written=proposals_written,
            error=error,
            ended_at=datetime.now(UTC),
        )

    async def get(self, run_id: str) -> CrawlRunRow | None:
        return self.rows.get(run_id)

    async def list_recent(
        self,
        *,
        vision_slug: str | None = None,
        fetcher_kind: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[CrawlRunRow]:
        out = list(self.rows.values())
        if vision_slug is not None:
            out = [r for r in out if r.vision_slug == vision_slug]
        if fetcher_kind is not None:
            out = [r for r in out if r.fetcher_kind == fetcher_kind]
        if status is not None:
            out = [r for r in out if r.status == status]
        out.sort(key=lambda r: r.started_at, reverse=True)
        return out[:limit]


def _replace(row: CrawlRunRow, **changes: Any) -> CrawlRunRow:
    base = {
        "id": row.id,
        "vision_slug": row.vision_slug,
        "fetcher_kind": row.fetcher_kind,
        "status": row.status,
        "plan": row.plan,
        "result_summary": row.result_summary,
        "cost_usd": row.cost_usd,
        "signals_written": row.signals_written,
        "proposals_written": row.proposals_written,
        "error": row.error,
        "started_at": row.started_at,
        "ended_at": row.ended_at,
    }
    base.update(changes)
    return CrawlRunRow(**base)


@dataclass
class _InMemoryCapabilityReader:
    records: dict[tuple[str, str], CapabilityRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, capability_key: str) -> CapabilityRecord | None:
        return self.records.get((sector_slug, capability_key))


def _make_stats(
    *,
    signals_written: int = 5,
    raw_signals_fetched: int = 5,
    extractor_total_cost_usd: float = 0.0042,
    extractor_failures: int = 0,
) -> IngestStats:
    return IngestStats(
        started_at=datetime(2026, 5, 26, 0, 0, 0, tzinfo=UTC),
        finished_at=datetime(2026, 5, 26, 0, 0, 1, tzinfo=UTC),
        visions_processed=1,
        capabilities_processed=1 if signals_written else 0,
        raw_signals_fetched=raw_signals_fetched,
        extractor_calls=raw_signals_fetched,
        extractor_failures=extractor_failures,
        signals_written=signals_written,
        extractor_total_cost_usd=extractor_total_cost_usd,
        errors=[],
    )


@dataclass
class _FakeSignalIngestFn:
    """Stand-in for the closure crawler/main.py binds around
    run_signal_ingest. Records calls + lets a test force a raise."""

    next_result: IngestStats = field(default_factory=_make_stats)
    raise_for: bool = False
    calls: list[tuple[str, list[str], int, int]] = field(default_factory=list)

    async def __call__(
        self,
        vision_slug: str,
        capability_keys: list[str],
        lookback_days: int,
        per_capability_limit: int,
    ) -> IngestStats:
        self.calls.append((vision_slug, capability_keys, lookback_days, per_capability_limit))
        if self.raise_for:
            raise RuntimeError("data-pipeline unreachable")
        return self.next_result


def _seed_cap_reader() -> _InMemoryCapabilityReader:
    reader = _InMemoryCapabilityReader()
    reader.records[("space-data-center", "rad-hard-compute")] = CapabilityRecord(
        id="cap_radhard_1",
        sector_slug="space-data-center",
        key="rad-hard-compute",
        name="Radiation-hardened compute",
        description="Compute hardware tolerant to LEO radiation.",
        rationale="Without rad-hard silicon, orbital DCs can't run.",
    )
    return reader


# --------------------------------------------------------------------------
# Direct fetcher tests
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_signal_fetcher_records_pipeline_stats_on_run() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    ingest = _FakeSignalIngestFn()

    result = await run_signal_fetcher(
        SignalFetchRequest(
            vision_slug="space-data-center",
            capability_key="rad-hard-compute",
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_ingest_fn=ingest,
    )

    assert result.run.status == "ok"
    assert result.run.signals_written == 5
    assert result.run.cost_usd == pytest.approx(0.0042)
    # ingest was called scoped to the single capability key.
    assert len(ingest.calls) == 1
    vision, caps, lookback, limit = ingest.calls[0]
    assert vision == "space-data-center"
    assert caps == ["rad-hard-compute"]
    assert lookback == 3
    assert limit == 10


@pytest.mark.asyncio
async def test_signal_fetcher_unknown_capability_raises_with_run() -> None:
    runs = _InMemoryRunsRepo()
    reader = _InMemoryCapabilityReader()  # empty
    ingest = _FakeSignalIngestFn()

    with pytest.raises(SignalFetcherError) as excinfo:
        await run_signal_fetcher(
            SignalFetchRequest(vision_slug="space-data-center", capability_key="missing-key"),
            runs_repo=runs,
            capability_reader=reader,
            signal_ingest_fn=ingest,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no capability" in excinfo.value.run.error
    # Ingest was never called.
    assert ingest.calls == []


@pytest.mark.asyncio
async def test_signal_fetcher_pipeline_failure_marks_run_error() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    ingest = _FakeSignalIngestFn(raise_for=True)

    result = await run_signal_fetcher(
        SignalFetchRequest(
            vision_slug="space-data-center",
            capability_key="rad-hard-compute",
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_ingest_fn=ingest,
    )
    assert result.run.status == "error"
    assert result.ingest is None
    assert result.run.error and "RuntimeError" in result.run.error
    assert result.run.signals_written == 0


@pytest.mark.asyncio
async def test_signal_fetcher_zero_signals_still_ok() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    ingest = _FakeSignalIngestFn(
        next_result=_make_stats(
            signals_written=0,
            raw_signals_fetched=0,
            extractor_total_cost_usd=0.0,
        )
    )

    result = await run_signal_fetcher(
        SignalFetchRequest(
            vision_slug="space-data-center",
            capability_key="rad-hard-compute",
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_ingest_fn=ingest,
    )
    assert result.run.status == "ok"
    assert result.run.signals_written == 0
    # Zero cost → cost_usd left null (don't lie about a billed call).
    assert result.run.cost_usd is None


# --------------------------------------------------------------------------
# FastAPI surface
# --------------------------------------------------------------------------



@dataclass
class _FakeQueueClient:
    """Auto-draining stand-in: enqueue() immediately runs the task
    against a ctx dict pulled lazily from `app.state`. Mirrors the
    real worker's startup wiring so tests can keep their existing
    assertions on completed CrawlRun state."""

    app: Any = None
    calls: list = field(default_factory=list)

    async def enqueue(self, task_name, *args, job_id=None, **kwargs):  # noqa: ANN001,ANN002,ANN003,ANN201
        from data_pipeline.queue.tasks import TASK_FUNCTIONS

        self.calls.append(
            {"task": task_name, "args": list(args), "job_id": job_id}
        )
        by_name = {f.__name__: f for f in TASK_FUNCTIONS}
        fn = by_name.get(task_name)
        if fn is None or self.app is None:
            return job_id or f"fake_job_{len(self.calls)}"
        st = self.app.state
        ctx = {
            "runs_repo": getattr(st, "crawl_runs_repo", None),
            "capability_reader": getattr(st, "capability_reader", None),
            "actor_reader": getattr(st, "actor_reader", None),
            "risk_reader": getattr(st, "risk_reader", None),
            "signal_writer": getattr(st, "signal_writer", None),
            "deep_research": getattr(st, "deep_research", None),
            "agent_client": getattr(st, "agent_client", None),
            "signal_ingest_fn": getattr(st, "signal_ingest_fn", None),
            "signal_repo": getattr(st, "signal_repo", None),
        }
        await fn(ctx, *args)
        return job_id or f"fake_job_{len(self.calls)}"

    async def snapshot(self):  # noqa: ANN201
        return None

    async def close(self) -> None:
        pass


def _client_with_fakes() -> tuple[TestClient, _FakeSignalIngestFn]:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = None  # signal path doesn't need DR
    app.state.capability_reader = _seed_cap_reader()
    app.state.signal_writer = None
    app.state.actor_reader = None
    app.state.agent_client = None
    app.state.signal_repo = object()  # truthy → health flag on
    ingest = _FakeSignalIngestFn()
    app.state.signal_ingest_fn = ingest
    app.state.queue_client = _FakeQueueClient(app=app)
    return TestClient(app), ingest


def test_post_signal_returns_run_payload() -> None:
    client, ingest = _client_with_fakes()
    r = client.post(
        "/fetchers/signal/run",
        json={"vision_slug": "space-data-center", "capability_key": "rad-hard-compute"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["fetcher_kind"] == "signal"
    run_id = body["run"]["id"]
    final = client.app.state.crawl_runs_repo.rows[run_id]
    assert final.status == "ok"
    assert len(ingest.calls) == 1


def test_post_signal_404_when_capability_missing() -> None:
    client, _ = _client_with_fakes()
    r = client.post(
        "/fetchers/signal/run",
        json={"vision_slug": "space-data-center", "capability_key": "does-not-exist"},
    )
    assert r.status_code == 200, r.text
    run_id = r.json()["run"]["id"]
    final = client.app.state.crawl_runs_repo.rows[run_id]
    assert final.status == "error"
    assert final.error and "no capability" in final.error


def test_post_signal_503_when_pipeline_unavailable() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = None
    app.state.capability_reader = _seed_cap_reader()
    app.state.signal_writer = None
    app.state.actor_reader = None
    app.state.agent_client = None
    app.state.signal_repo = None
    app.state.signal_ingest_fn = None  # not configured
    client = TestClient(app)
    r = client.post(
        "/fetchers/signal/run",
        json={
            "vision_slug": "space-data-center",
            "capability_key": "rad-hard-compute",
        },
    )
    assert r.status_code == 503


def test_health_surfaces_signal_repo_ready_flag() -> None:
    client, _ = _client_with_fakes()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ready"]["signal_repo"] is True
