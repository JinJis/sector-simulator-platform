"""Offline tests for CapabilityFetcher + the /fetchers/capability/run
endpoint. All dependencies (CrawlRunRepo, CapabilityReader,
SignalWriter, GroundedResearchClient, SignalExtractor agent) are faked."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agent_tools import GroundedResearchClient

from data_pipeline.agents import (
    AgentClient,
    SignalExtractorRequest,
    SignalExtractorRunResult,
    SignalScoring,
)
from data_pipeline.db.capability_reader import CapabilityReader, CapabilityRecord
from data_pipeline.db.signal_writer import SignalUpsert, SignalWriter
from data_pipeline.deep_research.fetchers.capability import (
    CapabilityFetchRequest,
    CapabilityFetcherError,
    run_capability_fetcher,
)
from data_pipeline.main import create_app
from data_pipeline.crawl_run_repo import CrawlRunRow


# --------------------------------------------------------------------------
# In-memory fakes (reused from test_hello_world.py shape)
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

    async def get(
        self, *, sector_slug: str, capability_key: str
    ) -> CapabilityRecord | None:
        return self.records.get((sector_slug, capability_key))


@dataclass
class _InMemorySignalWriter:
    rows: list[SignalUpsert] = field(default_factory=list)
    _seq: int = 0

    async def upsert(self, signal: SignalUpsert) -> str:
        self._seq += 1
        # Mirror the (source_url, capability_id) uniqueness — replace
        # in place if a previous upsert with the same key exists.
        for i, existing in enumerate(self.rows):
            if (
                existing.source_url == signal.source_url
                and existing.capability_id == signal.capability_id
            ):
                self.rows[i] = signal
                return f"sg_test_{i + 1}"
        self.rows.append(signal)
        return f"sg_test_{self._seq}"


@dataclass
class _FakeAgentClient:
    next_scoring: SignalScoring = field(
        default_factory=lambda: SignalScoring(
            delta_technical=2.0,
            delta_economic=1.0,
            delta_regulatory=0.0,
            delta_supply=-1.0,
            confidence=0.8,
            is_highlight=False,
            rationale="fake",
        )
    )
    next_cost_usd: float = 0.0012
    raise_for: bool = False
    calls: list[SignalExtractorRequest] = field(default_factory=list)

    async def score_signal(
        self, req: SignalExtractorRequest
    ) -> SignalExtractorRunResult:
        self.calls.append(req)
        if self.raise_for:
            raise RuntimeError("agent unreachable")
        return SignalExtractorRunResult(
            scoring=self.next_scoring,
            cost_usd=self.next_cost_usd,
            duration_ms=42,
        )


@dataclass
class _FakeUsage:
    prompt_token_count: int = 1200
    candidates_token_count: int = 700
    total_token_count: int = 1900


@dataclass
class _FakeResponse:
    text: str = "Rad-hard compute progressed. AMD MI300 tape-out delayed Q3."
    candidates: list[Any] = field(default_factory=list)
    usage_metadata: _FakeUsage = field(default_factory=_FakeUsage)


@dataclass
class _FakeModels:
    """Stand-in for `genai.Client.models` — only `generate_content` is
    exercised by GroundedResearchClient."""

    calls: list[dict[str, Any]] = field(default_factory=list)
    next: _FakeResponse = field(default_factory=_FakeResponse)

    def generate_content(self, **kwargs: Any) -> _FakeResponse:
        self.calls.append(kwargs)
        return self.next


@dataclass
class _FakeGenAI:
    models: _FakeModels = field(default_factory=_FakeModels)


def _build_deep_research() -> GroundedResearchClient:
    return GroundedResearchClient(
        genai_client=_FakeGenAI(),
    )


def _seed_cap_reader() -> _InMemoryCapabilityReader:
    reader = _InMemoryCapabilityReader()
    reader.records[("space-data-center", "rad-hard-compute")] = CapabilityRecord(
        id="cap_radhard_1",
        sector_slug="space-data-center",
        key="rad-hard-compute",
        name="Radiation-hardened compute",
        description="Compute hardware tolerant to LEO radiation environment.",
        rationale="Without rad-hard silicon, orbital data centers can't run useful workloads.",
    )
    return reader


# --------------------------------------------------------------------------
# Direct fetcher tests
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_capability_fetcher_writes_signal_with_extractor_scoring() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_capability_fetcher(
        CapabilityFetchRequest(
            vision_slug="space-data-center", capability_key="rad-hard-compute"
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )

    assert result.run.status == "ok"
    assert result.signal_id is not None
    assert result.run.signals_written == 1
    assert result.run.cost_usd is not None and result.run.cost_usd > 0
    # Extractor was called with capability metadata fully populated.
    assert len(agent.calls) == 1
    req = agent.calls[0]
    assert req.capability_key == "rad-hard-compute"
    assert req.capability_name.startswith("Radiation")
    assert req.source_kind == "research_brief"
    # Signal row carries the day-bucketed pseudo-URL.
    assert len(writer.rows) == 1
    written = writer.rows[0]
    assert written.source_url.startswith(
        "internal://crawler/capability/space-data-center/rad-hard-compute/"
    )
    assert written.capability_id == "cap_radhard_1"
    assert written.delta_technical == 2.0  # confidence 0.8 >= 0.5
    assert written.delta_supply == -1.0
    assert written.is_highlight is False


@pytest.mark.asyncio
async def test_capability_fetcher_low_confidence_keeps_deltas_null() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(
        next_scoring=SignalScoring(
            delta_technical=5.0,
            delta_economic=5.0,
            delta_regulatory=5.0,
            delta_supply=5.0,
            confidence=0.3,  # below the 0.5 cutoff
            rationale="not confident",
        )
    )

    result = await run_capability_fetcher(
        CapabilityFetchRequest(
            vision_slug="space-data-center", capability_key="rad-hard-compute"
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    written = writer.rows[0]
    assert written.delta_technical is None
    assert written.delta_economic is None
    assert written.delta_regulatory is None
    assert written.delta_supply is None


@pytest.mark.asyncio
async def test_capability_fetcher_unknown_capability_raises_with_run() -> None:
    runs = _InMemoryRunsRepo()
    reader = _InMemoryCapabilityReader()  # empty
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(CapabilityFetcherError) as excinfo:
        await run_capability_fetcher(
            CapabilityFetchRequest(
                vision_slug="space-data-center", capability_key="missing-key"
            ),
            runs_repo=runs,
            capability_reader=reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no capability" in excinfo.value.run.error
    assert "capability not found" in str(excinfo.value)
    # Agent + writer were never invoked.
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_capability_fetcher_extractor_failure_marks_run_error() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(raise_for=True)

    result = await run_capability_fetcher(
        CapabilityFetchRequest(
            vision_slug="space-data-center", capability_key="rad-hard-compute"
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "error"
    assert result.signal_id is None
    assert writer.rows == []
    assert result.run.error and "signal extractor failed" in result.run.error
    # DR cost is still recorded on the run.
    assert result.run.cost_usd is not None and result.run.cost_usd > 0


@pytest.mark.asyncio
async def test_capability_fetcher_dr_failure_skips_extractor_call() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_cap_reader()
    writer = _InMemorySignalWriter()

    # Build a DR client whose Interaction returns failed.
    @dataclass
    class _FailingInteractions:
        def create(self, **kwargs: Any) -> _FakeInteraction:
            return _FakeInteraction(status="failed", error="quota exceeded")

        def get(self, id: str) -> _FakeInteraction:  # noqa: A002
            return _FakeInteraction(id=id, status="failed", error="quota exceeded")

    @dataclass
    class _FailingClient:
        interactions: _FailingInteractions = field(default_factory=_FailingInteractions)

    dr = GroundedResearchClient(genai_client=_FailingClient())
    agent = _FakeAgentClient()

    result = await run_capability_fetcher(
        CapabilityFetchRequest(
            vision_slug="space-data-center", capability_key="rad-hard-compute"
        ),
        runs_repo=runs,
        capability_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "error"
    assert agent.calls == []
    assert writer.rows == []


# --------------------------------------------------------------------------
# FastAPI surface
# --------------------------------------------------------------------------


def _client_with_fakes() -> tuple[TestClient, _InMemorySignalWriter]:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.capability_reader = _seed_cap_reader()
    writer = _InMemorySignalWriter()
    app.state.signal_writer = writer
    app.state.agent_client = _FakeAgentClient()
    return TestClient(app), writer


def test_post_capability_returns_run_payload() -> None:
    client, writer = _client_with_fakes()
    r = client.post(
        "/fetchers/capability/run",
        json={
            "vision_slug": "space-data-center",
            "capability_key": "rad-hard-compute",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["status"] == "ok"
    assert body["run"]["fetcher_kind"] == "capability"
    assert body["run"]["signals_written"] == 1
    assert body["signal_id"] is not None
    assert body["dr_cached"] is False
    assert body["scoring_confidence"] == 0.8
    assert len(writer.rows) == 1


def test_post_capability_404_when_capability_missing() -> None:
    client, _ = _client_with_fakes()
    r = client.post(
        "/fetchers/capability/run",
        json={
            "vision_slug": "space-data-center",
            "capability_key": "does-not-exist",
        },
    )
    assert r.status_code == 404, r.text


def test_post_capability_503_when_agent_unavailable() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.capability_reader = _seed_cap_reader()
    app.state.signal_writer = _InMemorySignalWriter()
    app.state.agent_client = None
    client = TestClient(app)
    r = client.post(
        "/fetchers/capability/run",
        json={
            "vision_slug": "space-data-center",
            "capability_key": "rad-hard-compute",
        },
    )
    assert r.status_code == 503


def test_health_surfaces_agent_client_ready_flag() -> None:
    client, _ = _client_with_fakes()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ready"]["agent_client"] is True
