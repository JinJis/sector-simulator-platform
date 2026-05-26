"""Offline smoke tests for HelloWorldFetcher + the crawler FastAPI
app. Uses an in-memory CrawlRunRepository fake and a stubbed
DeepResearchClient — no DB, no network."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agent_tools import DeepResearchClient, DeepResearchResult

from data_pipeline.deep_research.fetchers.hello_world import (
    HelloWorldRunRequest,
    run_hello_world,
)
from data_pipeline.main import create_app
from data_pipeline.crawl_run_repo import CrawlRunRow


# --------------------------------------------------------------------------
# In-memory fakes
# --------------------------------------------------------------------------


@dataclass
class _InMemoryRepo:
    rows: dict[str, CrawlRunRow] = field(default_factory=dict)
    _seq: int = 0

    async def create_queued(
        self,
        *,
        vision_slug: str,
        fetcher_kind: str,
        plan: dict[str, Any],
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
        prev = self.rows[run_id]
        self.rows[run_id] = _replace(prev, status="running")

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
class _FakeInteraction:
    id: str = "int_test_1"
    status: str = "completed"
    output_text: str = "the crawler is wired correctly."
    error: str | None = None
    usage_metadata: Any = None


@dataclass
class _FakeInteractions:
    create_calls: list[dict[str, Any]] = field(default_factory=list)

    def create(self, **kwargs: Any) -> _FakeInteraction:
        self.create_calls.append(kwargs)
        return _FakeInteraction()

    def get(self, id: str) -> _FakeInteraction:  # noqa: A002
        return _FakeInteraction(id=id)


@dataclass
class _FakeGenAI:
    interactions: _FakeInteractions = field(default_factory=_FakeInteractions)


def _build_deep_research() -> DeepResearchClient:
    return DeepResearchClient(
        genai_client=_FakeGenAI(),
        poll_interval_seconds=0.0,
    )


# --------------------------------------------------------------------------
# Tests — direct fetcher
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hello_world_writes_run_row() -> None:
    repo = _InMemoryRepo()
    dr = _build_deep_research()
    result = await run_hello_world(
        HelloWorldRunRequest(vision_slug="space-data-center"),
        repo=repo,
        deep_research=dr,
    )
    assert result.run.status == "ok"
    assert result.run.fetcher_kind == "hello_world"
    assert result.run.vision_slug == "space-data-center"
    assert result.run.cost_usd is not None and result.run.cost_usd > 0
    assert result.run.result_summary is not None
    assert "interaction_id" in result.run.result_summary
    assert result.run.ended_at is not None
    assert result.cached is False
    assert result.output_text


@pytest.mark.asyncio
async def test_hello_world_caches_second_call() -> None:
    repo = _InMemoryRepo()
    dr = _build_deep_research()
    first = await run_hello_world(
        HelloWorldRunRequest(vision_slug="space-data-center"),
        repo=repo,
        deep_research=dr,
    )
    second = await run_hello_world(
        HelloWorldRunRequest(vision_slug="space-data-center"),
        repo=repo,
        deep_research=dr,
    )
    assert first.cached is False
    assert second.cached is True
    # Cached run still got its own CrawlRun row — we want the audit
    # trail even when the LLM call was skipped.
    assert second.run.id != first.run.id
    # Cached run records 0 cost (DR client returns cost_usd=0 for cache
    # hits → fetcher passes None to the repo).
    assert second.run.cost_usd is None


# --------------------------------------------------------------------------
# Tests — FastAPI surface
# --------------------------------------------------------------------------


def _client_with_fakes() -> TestClient:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRepo()
    app.state.deep_research = _build_deep_research()
    return TestClient(app)


def test_health_reports_ready_flags() -> None:
    client = _client_with_fakes()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["ready"]["repo"] is True
    assert body["ready"]["deep_research"] is True


def test_post_hello_world_returns_run_payload() -> None:
    client = _client_with_fakes()
    r = client.post(
        "/fetchers/hello-world/run",
        json={"vision_slug": "fusion-power"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["status"] == "ok"
    assert body["run"]["vision_slug"] == "fusion-power"
    assert body["run"]["fetcher_kind"] == "hello_world"
    assert body["cached"] is False


def test_list_runs_filters_by_vision() -> None:
    client = _client_with_fakes()
    client.post("/fetchers/hello-world/run", json={"vision_slug": "space-data-center"})
    client.post("/fetchers/hello-world/run", json={"vision_slug": "fusion-power"})

    r = client.get("/jobs/runs?vision=fusion-power")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["vision_slug"] == "fusion-power"


def test_get_run_returns_404_when_missing() -> None:
    client = _client_with_fakes()
    r = client.get("/jobs/runs/cr_does_not_exist")
    assert r.status_code == 404


def test_hello_world_503_when_deep_research_unavailable() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRepo()
    app.state.deep_research = None
    client = TestClient(app)
    r = client.post(
        "/fetchers/hello-world/run",
        json={"vision_slug": "space-data-center"},
    )
    assert r.status_code == 503


def test_hello_world_503_when_repo_unavailable() -> None:
    app = create_app()
    app.state.crawl_runs_repo = None
    app.state.deep_research = _build_deep_research()
    client = TestClient(app)
    r = client.post(
        "/fetchers/hello-world/run",
        json={"vision_slug": "space-data-center"},
    )
    assert r.status_code == 503
