"""Repo-layer unit tests.

`InMemoryWorkflowRepository` is exercised directly; `PostgresWorkflowRepository`
needs a live Postgres so its tests are skipped when DATABASE_URL is
unset. The skipped path still imports asyncpg eagerly to catch
missing-dep regressions.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest

from agent_orchestration.repo import (
    InMemoryWorkflowRepository,
    PostgresWorkflowRepository,
    build_repository,
)
from agent_orchestration.schemas import WorkflowRecord, WorkflowStatus


def _make_record(
    wid: str = "wf_test1",
    kind: str = "decomposition",
    status: WorkflowStatus = WorkflowStatus.pending,
    cost_usd: float = 0.0,
) -> WorkflowRecord:
    now = datetime.now(UTC)
    return WorkflowRecord(
        id=wid,
        kind=kind,
        status=status,
        created_at=now,
        updated_at=now,
        input={"description": "test"},
        output=None,
        error=None,
        cost_usd=cost_usd,
    )


# ---- In-memory --------------------------------------------------------


class TestInMemoryRepo:
    @pytest.mark.asyncio
    async def test_create_then_get_round_trips(self) -> None:
        repo = InMemoryWorkflowRepository()
        rec = _make_record()
        await repo.create(rec)
        fetched = await repo.get(rec.id)
        assert fetched is not None
        assert fetched.id == rec.id
        assert fetched.status == WorkflowStatus.pending

    @pytest.mark.asyncio
    async def test_update_overwrites(self) -> None:
        repo = InMemoryWorkflowRepository()
        rec = _make_record(cost_usd=0.0)
        await repo.create(rec)
        updated = rec.model_copy(
            update={"status": WorkflowStatus.succeeded, "cost_usd": 0.42}
        )
        await repo.update(updated)
        got = await repo.get(rec.id)
        assert got is not None
        assert got.status == WorkflowStatus.succeeded
        assert got.cost_usd == 0.42

    @pytest.mark.asyncio
    async def test_get_unknown_returns_none(self) -> None:
        repo = InMemoryWorkflowRepository()
        assert await repo.get("nope") is None

    @pytest.mark.asyncio
    async def test_list_orders_newest_first(self) -> None:
        repo = InMemoryWorkflowRepository()
        first = _make_record(wid="wf_first")
        second = _make_record(wid="wf_second")
        # Force a deterministic creation order.
        second = second.model_copy(
            update={"created_at": first.created_at + timedelta(seconds=1)}
        )
        await repo.create(first)
        await repo.create(second)
        listed = await repo.list()
        assert [r.id for r in listed[:2]] == ["wf_second", "wf_first"]

    @pytest.mark.asyncio
    async def test_list_filters_by_kind(self) -> None:
        repo = InMemoryWorkflowRepository()
        await repo.create(_make_record(wid="wf_a", kind="decomposition"))
        await repo.create(_make_record(wid="wf_b", kind="research"))
        decomposition = await repo.list(kind="decomposition")
        assert [r.id for r in decomposition] == ["wf_a"]
        research = await repo.list(kind="research")
        assert [r.id for r in research] == ["wf_b"]

    @pytest.mark.asyncio
    async def test_mark_dangling_is_a_noop_in_memory(self) -> None:
        repo = InMemoryWorkflowRepository()
        await repo.create(_make_record(status=WorkflowStatus.running))
        count = await repo.mark_dangling_as_failed(
            statuses=["running"],
            stale_before=datetime.now(UTC),
            reason="crashed",
        )
        # In-memory repos die with the process, so there's no dangling
        # state to sweep on startup. The repo signals this by returning
        # zero updates — consumers should rely on the count rather than
        # asserting the record changed.
        assert count == 0


# ---- build_repository --------------------------------------------------


class TestBuildRepository:
    @pytest.mark.asyncio
    async def test_falls_back_to_in_memory_when_no_database_url(self) -> None:
        repo = await build_repository(None)
        assert isinstance(repo, InMemoryWorkflowRepository)

    @pytest.mark.asyncio
    async def test_falls_back_to_in_memory_for_empty_string(self) -> None:
        repo = await build_repository("")
        assert isinstance(repo, InMemoryWorkflowRepository)


# ---- Postgres (skipped without a live DB) ------------------------------

_DB_URL = os.environ.get("AGENT_ORCH_TEST_DATABASE_URL")


@pytest.mark.skipif(
    not _DB_URL,
    reason="AGENT_ORCH_TEST_DATABASE_URL not set; Postgres repo tests skipped",
)
class TestPostgresRepo:
    """When a live test DB is available, run the same round-trip as
    above against PostgresWorkflowRepository. Each test creates rows in
    a deterministic id-space and cleans up after itself."""

    @pytest.fixture
    async def repo(self):
        r = await PostgresWorkflowRepository.connect(_DB_URL or "")
        async with r._pool.acquire() as conn:  # noqa: SLF001
            await conn.execute(
                "DELETE FROM agent_workflows WHERE id LIKE 'wf_pgtest_%'"
            )
        yield r
        async with r._pool.acquire() as conn:  # noqa: SLF001
            await conn.execute(
                "DELETE FROM agent_workflows WHERE id LIKE 'wf_pgtest_%'"
            )
        await r.close()

    @pytest.mark.asyncio
    async def test_create_then_get_round_trips(self, repo) -> None:
        rec = _make_record(wid="wf_pgtest_create")
        await repo.create(rec)
        got = await repo.get("wf_pgtest_create")
        assert got is not None
        assert got.status == WorkflowStatus.pending
        assert got.input == {"description": "test"}

    @pytest.mark.asyncio
    async def test_mark_dangling_flips_stale_running_to_failed(self, repo) -> None:
        stale = _make_record(wid="wf_pgtest_stale", status=WorkflowStatus.running)
        stale = stale.model_copy(
            update={"updated_at": datetime.now(UTC) - timedelta(hours=1)}
        )
        await repo.create(stale)
        count = await repo.mark_dangling_as_failed(
            statuses=["running"],
            stale_before=datetime.now(UTC) - timedelta(minutes=1),
            reason="crashed",
        )
        assert count == 1
        got = await repo.get("wf_pgtest_stale")
        assert got is not None
        assert got.status == WorkflowStatus.failed
        assert got.error == "crashed"
