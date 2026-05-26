"""Offline tests for ActorFetcher + the /fetchers/actor/run endpoint.
Same shape as test_capability_fetcher.py — all dependencies (repo,
ActorReader, SignalWriter, DeepResearchClient, SignalExtractor agent)
are faked."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from agent_tools import DeepResearchClient
from data_pipeline.agents import (
    SignalExtractorRequest,
    SignalExtractorRunResult,
    SignalScoring,
)
from data_pipeline.db.actor_reader import ActorRecord
from data_pipeline.db.capability_reader import CapabilityRecord
from data_pipeline.db.signal_writer import SignalUpsert
from data_pipeline.deep_research.fetchers.actor import (
    ActorFetcherError,
    ActorFetchRequest,
    run_actor_fetcher,
)
from data_pipeline.main import create_app
from data_pipeline.crawl_run_repo import CrawlRunRow
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
class _InMemoryActorReader:
    records: dict[tuple[str, str], ActorRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, actor_key: str) -> ActorRecord | None:
        return self.records.get((sector_slug, actor_key))


@dataclass
class _InMemorySignalWriter:
    rows: list[SignalUpsert] = field(default_factory=list)
    _seq: int = 0

    async def upsert(self, signal: SignalUpsert) -> str:
        self._seq += 1
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
            delta_technical=1.5,
            delta_economic=0.5,
            delta_regulatory=0.0,
            delta_supply=0.0,
            confidence=0.82,
            is_highlight=True,
            matched_actor_key="spacex",
            rationale="fake",
        )
    )
    next_cost_usd: float = 0.0009
    raise_for: bool = False
    calls: list[SignalExtractorRequest] = field(default_factory=list)

    async def score_signal(self, req: SignalExtractorRequest) -> SignalExtractorRunResult:
        self.calls.append(req)
        if self.raise_for:
            raise RuntimeError("agent unreachable")
        return SignalExtractorRunResult(
            scoring=self.next_scoring,
            cost_usd=self.next_cost_usd,
            duration_ms=37,
        )


@dataclass
class _FakeInteraction:
    id: str = "int_actor_1"
    status: str = "completed"
    output_text: str = (
        "SpaceX shipped Starship V2. Reusable cadence accelerated to 12/yr. "
        "Cost per kg to LEO trending below $200."
    )
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


def _spacex_actor() -> ActorRecord:
    cap = CapabilityRecord(
        id="cap_launch_1",
        sector_slug="space-data-center",
        key="cheap-launch",
        name="Cheap launch capacity",
        description="$/kg to LEO low enough to make orbital DC economics work.",
        rationale="Without sub-$200/kg launch, orbital data centers can't compete on TCO.",
    )
    return ActorRecord(
        id="actor_spacex_1",
        key="spacex",
        sector_slug="space-data-center",
        name="SpaceX",
        signal_keywords=["SpaceX", "Starship", "Falcon 9", "Falcon Heavy"],
        primary_capability=cap,
    )


def _seed_actor_reader() -> _InMemoryActorReader:
    reader = _InMemoryActorReader()
    actor = _spacex_actor()
    reader.records[(actor.sector_slug, actor.key)] = actor
    return reader


# --------------------------------------------------------------------------
# Direct fetcher tests
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_actor_fetcher_writes_signal_tagged_with_actor() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_actor_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_actor_fetcher(
        ActorFetchRequest(vision_slug="space-data-center", actor_key="spacex"),
        runs_repo=runs,
        actor_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )

    assert result.run.status == "ok"
    assert result.signal_id is not None
    assert result.run.signals_written == 1
    assert result.run.cost_usd is not None and result.run.cost_usd > 0

    # Extractor was called with the actor's keyword set + the primary
    # capability's context, so the haiku-tier matching has something to
    # bite on.
    assert len(agent.calls) == 1
    req = agent.calls[0]
    assert req.capability_key == "cheap-launch"
    assert req.source_kind == "research_brief"
    assert len(req.actor_keywords) == 1
    ak = req.actor_keywords[0]
    assert ak.actor_key == "spacex"
    assert "Starship" in ak.aliases

    # Signal row carries actor_id + the day-bucketed pseudo-URL.
    assert len(writer.rows) == 1
    written = writer.rows[0]
    assert written.actor_id == "actor_spacex_1"
    assert written.capability_id == "cap_launch_1"
    assert written.source_url.startswith("internal://crawler/actor/space-data-center/spacex/")
    assert written.delta_technical == 1.5  # confidence 0.82 ≥ 0.5
    assert written.is_highlight is True


@pytest.mark.asyncio
async def test_actor_fetcher_low_confidence_keeps_deltas_null() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_actor_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(
        next_scoring=SignalScoring(
            delta_technical=5.0,
            delta_economic=5.0,
            delta_regulatory=5.0,
            delta_supply=5.0,
            confidence=0.2,  # below the 0.5 cutoff
            rationale="not sure",
        )
    )

    result = await run_actor_fetcher(
        ActorFetchRequest(vision_slug="space-data-center", actor_key="spacex"),
        runs_repo=runs,
        actor_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    written = writer.rows[0]
    # Deltas dropped to null on low confidence; actor_id is still set
    # (the fetcher is per-actor by construction).
    assert written.delta_technical is None
    assert written.delta_economic is None
    assert written.delta_regulatory is None
    assert written.delta_supply is None
    assert written.actor_id == "actor_spacex_1"


@pytest.mark.asyncio
async def test_actor_fetcher_unknown_actor_raises_with_run() -> None:
    runs = _InMemoryRunsRepo()
    reader = _InMemoryActorReader()  # empty
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(ActorFetcherError) as excinfo:
        await run_actor_fetcher(
            ActorFetchRequest(vision_slug="space-data-center", actor_key="ghost-corp"),
            runs_repo=runs,
            actor_reader=reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no actor" in excinfo.value.run.error
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_actor_fetcher_unbound_actor_raises_with_run() -> None:
    """Actor exists in the vision but has no CapabilityActor row — we
    refuse to fabricate a capability anchor."""
    runs = _InMemoryRunsRepo()
    reader = _InMemoryActorReader()
    unbound = ActorRecord(
        id="actor_loose_1",
        key="loose-corp",
        sector_slug="space-data-center",
        name="Loose Corp",
        signal_keywords=["Loose"],
        primary_capability=None,
    )
    reader.records[(unbound.sector_slug, unbound.key)] = unbound
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(ActorFetcherError) as excinfo:
        await run_actor_fetcher(
            ActorFetchRequest(vision_slug="space-data-center", actor_key="loose-corp"),
            runs_repo=runs,
            actor_reader=reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no capability binding" in excinfo.value.run.error
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_actor_fetcher_extractor_failure_marks_run_error() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_actor_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(raise_for=True)

    result = await run_actor_fetcher(
        ActorFetchRequest(vision_slug="space-data-center", actor_key="spacex"),
        runs_repo=runs,
        actor_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "error"
    assert result.signal_id is None
    assert writer.rows == []
    assert result.run.error and "signal extractor failed" in result.run.error
    assert result.run.cost_usd is not None and result.run.cost_usd > 0


@pytest.mark.asyncio
async def test_actor_fetcher_dr_failure_skips_extractor_call() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_actor_reader()
    writer = _InMemorySignalWriter()

    @dataclass
    class _FailingInteractions:
        def create(self, **kwargs: Any) -> _FakeInteraction:
            return _FakeInteraction(status="failed", error="quota exceeded")

        def get(self, id: str) -> _FakeInteraction:  # noqa: A002
            return _FakeInteraction(id=id, status="failed", error="quota exceeded")

    @dataclass
    class _FailingClient:
        interactions: _FailingInteractions = field(default_factory=_FailingInteractions)

    dr = DeepResearchClient(genai_client=_FailingClient(), poll_interval_seconds=0.0)
    agent = _FakeAgentClient()

    result = await run_actor_fetcher(
        ActorFetchRequest(vision_slug="space-data-center", actor_key="spacex"),
        runs_repo=runs,
        actor_reader=reader,
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
    app.state.capability_reader = None  # not used by the actor endpoint
    app.state.actor_reader = _seed_actor_reader()
    writer = _InMemorySignalWriter()
    app.state.signal_writer = writer
    app.state.agent_client = _FakeAgentClient()
    return TestClient(app), writer


def test_post_actor_returns_run_payload() -> None:
    client, writer = _client_with_fakes()
    r = client.post(
        "/fetchers/actor/run",
        json={"vision_slug": "space-data-center", "actor_key": "spacex"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["status"] == "ok"
    assert body["run"]["fetcher_kind"] == "actor"
    assert body["run"]["signals_written"] == 1
    assert body["signal_id"] is not None
    assert body["dr_cached"] is False
    assert body["scoring_confidence"] == 0.82
    assert body["matched_actor_key"] == "spacex"
    assert body["primary_capability_key"] == "cheap-launch"
    assert len(writer.rows) == 1


def test_post_actor_404_when_actor_missing() -> None:
    client, _ = _client_with_fakes()
    r = client.post(
        "/fetchers/actor/run",
        json={"vision_slug": "space-data-center", "actor_key": "does-not-exist"},
    )
    assert r.status_code == 404, r.text


def test_post_actor_503_when_actor_reader_unavailable() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.capability_reader = None
    app.state.actor_reader = None
    app.state.signal_writer = _InMemorySignalWriter()
    app.state.agent_client = _FakeAgentClient()
    client = TestClient(app)
    r = client.post(
        "/fetchers/actor/run",
        json={"vision_slug": "space-data-center", "actor_key": "spacex"},
    )
    assert r.status_code == 503
