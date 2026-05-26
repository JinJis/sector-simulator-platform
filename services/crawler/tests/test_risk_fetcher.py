"""Offline tests for RiskFetcher + the /fetchers/risk/run endpoint.
Same shape as test_actor_fetcher.py — all dependencies (repo,
RiskReader, SignalWriter, DeepResearchClient, SignalExtractor agent)
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
from data_pipeline.db.capability_reader import CapabilityRecord
from data_pipeline.db.risk_reader import RiskRecord
from data_pipeline.db.signal_writer import SignalUpsert
from data_pipeline.deep_research.fetchers.risk import (
    RiskFetcherError,
    RiskFetchRequest,
    run_risk_fetcher,
)
from crawler.main import create_app
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
class _InMemoryRiskReader:
    records: dict[tuple[str, str], RiskRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, risk_key: str) -> RiskRecord | None:
        return self.records.get((sector_slug, risk_key))


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
            delta_technical=0.0,
            delta_economic=-1.0,
            delta_regulatory=-3.0,
            delta_supply=0.0,
            confidence=0.78,
            is_highlight=True,
            matched_actor_key=None,
            rationale="fake",
        )
    )
    next_cost_usd: float = 0.0008
    raise_for: bool = False
    calls: list[SignalExtractorRequest] = field(default_factory=list)

    async def score_signal(self, req: SignalExtractorRequest) -> SignalExtractorRunResult:
        self.calls.append(req)
        if self.raise_for:
            raise RuntimeError("agent unreachable")
        return SignalExtractorRunResult(
            scoring=self.next_scoring,
            cost_usd=self.next_cost_usd,
            duration_ms=33,
        )


@dataclass
class _FakeInteraction:
    id: str = "int_risk_1"
    status: str = "completed"
    output_text: str = (
        "Lloyd's bulletin signals capacity constraint for orbital DCs; "
        "secondary carriers re-rate premiums in Q3."
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


def _insurance_risk(*, primary_cap: bool = True) -> RiskRecord:
    cap = (
        CapabilityRecord(
            id="cap_insurance_1",
            sector_slug="space-data-center",
            key="insurance_availability",
            name="Insurance availability",
            description=(
                "Commercial space insurance underwriters writing > $2B/y "
                "per orbital asset."
            ),
            rationale=(
                "Capital deployment at orbital-DC scale requires market "
                "depth that doesn't yet exist."
            ),
        )
        if primary_cap
        else None
    )
    return RiskRecord(
        id="risk_insurance_thinness_1",
        key="insurance_thinness",
        sector_slug="space-data-center",
        name="Insurance market thinness",
        description="No commercial carrier writing > $2B/y per orbital asset.",
        category="financial",
        severity="medium",
        likelihood="high",
        time_horizon="1y",
        mitigations="Sovereign backstop programs; coinsurance pools.",
        affected_capability_keys=["insurance_availability"],
        source_url="https://www.lloyds.com/news-and-insights/news",
        source_kind="analyst_report",
        source_title="Lloyd's market bulletin",
        primary_capability=cap,
    )


def _seed_risk_reader() -> _InMemoryRiskReader:
    reader = _InMemoryRiskReader()
    risk = _insurance_risk()
    reader.records[(risk.sector_slug, risk.key)] = risk
    return reader


# --------------------------------------------------------------------------
# Direct fetcher tests
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_risk_fetcher_writes_signal_anchored_on_primary_capability() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_risk_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_risk_fetcher(
        RiskFetchRequest(vision_slug="space-data-center", risk_key="insurance_thinness"),
        runs_repo=runs,
        risk_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )

    assert result.run.status == "ok"
    assert result.signal_id is not None
    assert result.run.signals_written == 1
    assert result.run.cost_usd is not None and result.run.cost_usd > 0

    # Extractor was called with the anchor capability's context and
    # zero actor_keywords (risks aren't actors).
    assert len(agent.calls) == 1
    req = agent.calls[0]
    assert req.capability_key == "insurance_availability"
    assert req.source_kind == "research_brief"
    assert req.actor_keywords == []

    # Signal carries no actor + the day-bucketed risk pseudo-URL.
    assert len(writer.rows) == 1
    w = writer.rows[0]
    assert w.actor_id is None
    assert w.capability_id == "cap_insurance_1"
    assert w.source_url.startswith("internal://crawler/risk/space-data-center/insurance_thinness/")
    assert w.delta_regulatory == -3.0  # confidence 0.78 ≥ 0.5
    assert w.is_highlight is True


@pytest.mark.asyncio
async def test_risk_fetcher_low_confidence_keeps_deltas_null() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_risk_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(
        next_scoring=SignalScoring(
            delta_technical=5.0,
            delta_economic=5.0,
            delta_regulatory=5.0,
            delta_supply=5.0,
            confidence=0.3,
            rationale="weak signal",
        )
    )

    result = await run_risk_fetcher(
        RiskFetchRequest(vision_slug="space-data-center", risk_key="insurance_thinness"),
        runs_repo=runs,
        risk_reader=reader,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    w = writer.rows[0]
    assert w.delta_technical is None
    assert w.delta_regulatory is None
    assert w.actor_id is None


@pytest.mark.asyncio
async def test_risk_fetcher_unknown_risk_raises_with_run() -> None:
    runs = _InMemoryRunsRepo()
    reader = _InMemoryRiskReader()  # empty
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(RiskFetcherError) as excinfo:
        await run_risk_fetcher(
            RiskFetchRequest(vision_slug="space-data-center", risk_key="missing"),
            runs_repo=runs,
            risk_reader=reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no risk" in excinfo.value.run.error
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_risk_fetcher_no_resolvable_capability_raises_with_run() -> None:
    """Risk exists but its affected_capability_keys[] resolved to zero
    capabilities — RiskFetcher refuses."""
    runs = _InMemoryRunsRepo()
    reader = _InMemoryRiskReader()
    risk = _insurance_risk(primary_cap=False)
    reader.records[(risk.sector_slug, risk.key)] = risk
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(RiskFetcherError) as excinfo:
        await run_risk_fetcher(
            RiskFetchRequest(vision_slug="space-data-center", risk_key="insurance_thinness"),
            runs_repo=runs,
            risk_reader=reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert (
        excinfo.value.run.error and "no resolvable affected capability" in excinfo.value.run.error
    )
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_risk_fetcher_extractor_failure_marks_run_error() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_risk_reader()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(raise_for=True)

    result = await run_risk_fetcher(
        RiskFetchRequest(vision_slug="space-data-center", risk_key="insurance_thinness"),
        runs_repo=runs,
        risk_reader=reader,
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
async def test_risk_fetcher_dr_failure_skips_extractor_call() -> None:
    runs = _InMemoryRunsRepo()
    reader = _seed_risk_reader()
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

    result = await run_risk_fetcher(
        RiskFetchRequest(vision_slug="space-data-center", risk_key="insurance_thinness"),
        runs_repo=runs,
        risk_reader=reader,
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
    app.state.repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.capability_reader = None
    app.state.actor_reader = None
    app.state.risk_reader = _seed_risk_reader()
    writer = _InMemorySignalWriter()
    app.state.signal_writer = writer
    app.state.agent_client = _FakeAgentClient()
    app.state.data_pipeline_client = None
    return TestClient(app), writer


def test_post_risk_returns_run_payload() -> None:
    client, writer = _client_with_fakes()
    r = client.post(
        "/fetchers/risk/run",
        json={
            "vision_slug": "space-data-center",
            "risk_key": "insurance_thinness",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["status"] == "ok"
    assert body["run"]["fetcher_kind"] == "risk"
    assert body["run"]["signals_written"] == 1
    assert body["signal_id"] is not None
    assert body["dr_cached"] is False
    assert body["scoring_confidence"] == 0.78
    assert body["primary_capability_key"] == "insurance_availability"
    assert body["risk_severity"] == "medium"
    assert body["risk_likelihood"] == "high"
    assert len(writer.rows) == 1


def test_post_risk_404_when_risk_missing() -> None:
    client, _ = _client_with_fakes()
    r = client.post(
        "/fetchers/risk/run",
        json={
            "vision_slug": "space-data-center",
            "risk_key": "does-not-exist",
        },
    )
    assert r.status_code == 404, r.text


def test_post_risk_503_when_risk_reader_unavailable() -> None:
    app = create_app()
    app.state.repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.capability_reader = None
    app.state.actor_reader = None
    app.state.risk_reader = None
    app.state.signal_writer = _InMemorySignalWriter()
    app.state.agent_client = _FakeAgentClient()
    app.state.data_pipeline_client = None
    client = TestClient(app)
    r = client.post(
        "/fetchers/risk/run",
        json={
            "vision_slug": "space-data-center",
            "risk_key": "insurance_thinness",
        },
    )
    assert r.status_code == 503
