"""Offline tests for orchestrator + dispatcher (M49f).

Pure unit tests on the scoring formula + budget-aware picker, plus
dispatcher routing tests using in-memory fakes for every fetcher
dependency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from data_pipeline.deep_research.config import OrchestratorConfig
from data_pipeline.db.actor_reader import ActorRecord
from data_pipeline.db.capability_reader import CapabilityRecord
from data_pipeline.db.orchestrator_repo import (
    ActorCandidate,
    CapabilityCandidate,
    RiskCandidate,
)
from data_pipeline.db.risk_reader import RiskRecord
from data_pipeline.db.signal_writer import SignalUpsert
from data_pipeline.deep_research.dispatcher import DispatcherClients, dispatch_tick
from data_pipeline.main import create_app
from data_pipeline.deep_research.orchestrator import (
    Candidate,
    PickResult,
    pick_for_tick,
    score_candidate,
)
from data_pipeline.crawl_run_repo import CrawlRunRow
from fastapi.testclient import TestClient

# --------------------------------------------------------------------------
# Shared in-memory fakes
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
        return list(self.rows.values())[:limit]


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


# --------------------------------------------------------------------------
# Orchestrator: scoring formula
# --------------------------------------------------------------------------


def test_score_candidate_binding_dominant_for_low_composite() -> None:
    config = OrchestratorConfig()
    weak = score_candidate(
        anchor_composite=10.0,
        stale_hours=0.0,
        estimated_cost_usd=0.05,
        pinned=False,
        config=config,
    )
    strong = score_candidate(
        anchor_composite=90.0,
        stale_hours=0.0,
        estimated_cost_usd=0.05,
        pinned=False,
        config=config,
    )
    # Weak (10 composite) attracts attention; strong (90) does not.
    assert weak > strong


def test_score_candidate_stale_increases_score() -> None:
    config = OrchestratorConfig()
    fresh = score_candidate(
        anchor_composite=50.0,
        stale_hours=1.0,
        estimated_cost_usd=0.05,
        pinned=False,
        config=config,
    )
    stale = score_candidate(
        anchor_composite=50.0,
        stale_hours=48.0,
        estimated_cost_usd=0.05,
        pinned=False,
        config=config,
    )
    assert stale > fresh


def test_score_candidate_pin_boosts_score() -> None:
    config = OrchestratorConfig()
    unpinned = score_candidate(
        anchor_composite=50.0,
        stale_hours=0.0,
        estimated_cost_usd=0.05,
        pinned=False,
        config=config,
    )
    pinned = score_candidate(
        anchor_composite=50.0,
        stale_hours=0.0,
        estimated_cost_usd=0.05,
        pinned=True,
        config=config,
    )
    assert pinned == pytest.approx(unpinned + config.w_priority * 100.0)


def test_score_candidate_cost_dampens() -> None:
    config = OrchestratorConfig()
    cheap = score_candidate(
        anchor_composite=50.0,
        stale_hours=0.0,
        estimated_cost_usd=0.01,
        pinned=False,
        config=config,
    )
    pricey = score_candidate(
        anchor_composite=50.0,
        stale_hours=0.0,
        estimated_cost_usd=0.1,
        pinned=False,
        config=config,
    )
    assert cheap > pricey


# --------------------------------------------------------------------------
# Orchestrator: pick_for_tick — budget cap + top-K
# --------------------------------------------------------------------------


@dataclass
class _FakeOrchestratorReader:
    visions: list[str] = field(default_factory=lambda: ["alpha", "beta"])
    caps_by_vision: dict[str, list[CapabilityCandidate]] = field(default_factory=dict)
    actors_by_vision: dict[str, list[ActorCandidate]] = field(default_factory=dict)
    risks_by_vision: dict[str, list[RiskCandidate]] = field(default_factory=dict)
    last_run_ts: dict[tuple[str, str, str], datetime] = field(default_factory=dict)
    daily_cost: dict[str, float] = field(default_factory=dict)

    async def list_vision_slugs(self) -> list[str]:
        return list(self.visions)

    async def list_capability_candidates(self, *, vision_slug: str) -> list[CapabilityCandidate]:
        return list(self.caps_by_vision.get(vision_slug, []))

    async def list_actor_candidates(self, *, vision_slug: str) -> list[ActorCandidate]:
        return list(self.actors_by_vision.get(vision_slug, []))

    async def list_risk_candidates(self, *, vision_slug: str) -> list[RiskCandidate]:
        return list(self.risks_by_vision.get(vision_slug, []))

    async def last_run_ended_at(
        self, *, vision_slug: str, fetcher_kind: str, key: str
    ) -> datetime | None:
        return self.last_run_ts.get((vision_slug, fetcher_kind, key))

    async def daily_cost_usd_since(self, *, vision_slug: str, since: datetime) -> float:
        return self.daily_cost.get(vision_slug, 0.0)


@pytest.mark.asyncio
async def test_pick_for_tick_returns_top_k_under_budget() -> None:
    reader = _FakeOrchestratorReader(
        visions=["alpha"],
        caps_by_vision={
            "alpha": [
                CapabilityCandidate("alpha", "c1", composite_score=10.0),
                CapabilityCandidate("alpha", "c2", composite_score=90.0),
            ],
        },
    )
    config = OrchestratorConfig(top_k_per_tick=10)
    result = await pick_for_tick(reader=reader, config=config)
    # 2 caps × (capability + signal) = 4 candidates total.
    assert result.total_candidates == 4
    # Top-ranked candidate is the low-composite capability fetcher
    # (signal fetcher costs less but binding term dominates).
    assert result.picked[0].fetcher_kind in ("capability", "signal")
    assert result.picked[0].key == "c1"


@pytest.mark.asyncio
async def test_pick_for_tick_enforces_per_vision_daily_cap() -> None:
    """alpha already burned the full $2 today — nothing for alpha should
    be picked; beta has full budget so its candidates fill the slate."""
    reader = _FakeOrchestratorReader(
        visions=["alpha", "beta"],
        caps_by_vision={
            "alpha": [CapabilityCandidate("alpha", "c1", composite_score=10.0)],
            "beta": [CapabilityCandidate("beta", "c1", composite_score=10.0)],
        },
        daily_cost={"alpha": 2.0, "beta": 0.0},
    )
    config = OrchestratorConfig(top_k_per_tick=10)
    result = await pick_for_tick(reader=reader, config=config)
    picked_visions = {c.vision_slug for c in result.picked}
    assert picked_visions == {"beta"}
    assert result.over_budget_skipped >= 1
    assert result.per_vision_remaining_usd["alpha"] == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_pick_for_tick_top_k_caps_tick_size() -> None:
    reader = _FakeOrchestratorReader(
        visions=["alpha"],
        caps_by_vision={
            "alpha": [
                CapabilityCandidate("alpha", f"c{i}", composite_score=10.0) for i in range(20)
            ],
        },
    )
    config = OrchestratorConfig(top_k_per_tick=3)
    result = await pick_for_tick(reader=reader, config=config)
    assert len(result.picked) == 3
    assert result.total_candidates == 40  # 20 caps × (capability + signal)


@pytest.mark.asyncio
async def test_pick_for_tick_unbound_actor_skipped() -> None:
    reader = _FakeOrchestratorReader(
        visions=["alpha"],
        caps_by_vision={"alpha": []},
        actors_by_vision={
            "alpha": [
                ActorCandidate("alpha", "good", anchor_composite_score=50.0),
                ActorCandidate("alpha", "orphan", anchor_composite_score=None),
            ]
        },
    )
    result = await pick_for_tick(reader=reader)
    keys = {c.key for c in result.picked}
    assert "good" in keys
    assert "orphan" not in keys


@pytest.mark.asyncio
async def test_pick_for_tick_uses_stale_hours_from_last_run() -> None:
    now = datetime.now(UTC)
    reader = _FakeOrchestratorReader(
        visions=["alpha"],
        caps_by_vision={
            "alpha": [
                CapabilityCandidate("alpha", "fresh", composite_score=50.0),
                CapabilityCandidate("alpha", "stale", composite_score=50.0),
            ]
        },
        last_run_ts={
            ("alpha", "capability", "fresh"): now - timedelta(hours=1),
            ("alpha", "capability", "stale"): now - timedelta(hours=72),
        },
    )
    result = await pick_for_tick(reader=reader, now=now)
    # Stale capability ranks above fresh given identical composite.
    cap_picks = [c for c in result.picked if c.fetcher_kind == "capability"]
    assert cap_picks[0].key == "stale"


# --------------------------------------------------------------------------
# Dispatcher routing
# --------------------------------------------------------------------------


@dataclass
class _FakeCapReader:
    records: dict[tuple[str, str], CapabilityRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, capability_key: str) -> CapabilityRecord | None:
        return self.records.get((sector_slug, capability_key))


@dataclass
class _FakeActorReader:
    records: dict[tuple[str, str], ActorRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, actor_key: str) -> ActorRecord | None:
        return self.records.get((sector_slug, actor_key))


@dataclass
class _FakeRiskReader:
    records: dict[tuple[str, str], RiskRecord] = field(default_factory=dict)

    async def get(self, *, sector_slug: str, risk_key: str) -> RiskRecord | None:
        return self.records.get((sector_slug, risk_key))


@dataclass
class _FakeSignalWriter:
    rows: list[SignalUpsert] = field(default_factory=list)
    _seq: int = 0

    async def upsert(self, signal: SignalUpsert) -> str:
        self._seq += 1
        self.rows.append(signal)
        return f"sg_{self._seq}"


@dataclass
class _FakeAgentClient:
    calls: list[Any] = field(default_factory=list)

    async def score_signal(self, req: Any) -> Any:
        from data_pipeline.agents import SignalExtractorRunResult, SignalScoring

        self.calls.append(req)
        return SignalExtractorRunResult(
            scoring=SignalScoring(
                delta_technical=1.0,
                delta_economic=0.0,
                delta_regulatory=0.0,
                delta_supply=0.0,
                confidence=0.7,
                is_highlight=False,
            ),
            cost_usd=0.001,
            duration_ms=10,
        )


@dataclass
class _FakeSignalIngestFn:
    """Stand-in for the in-process closure crawler/main.py binds around
    run_signal_ingest. Records every (vision, caps, lookback, limit)
    call + returns canned IngestStats."""

    calls: list[tuple[str, list[str], int, int]] = field(default_factory=list)

    async def __call__(
        self,
        vision_slug: str,
        capability_keys: list[str],
        lookback_days: int,
        per_capability_limit: int,
    ):  # noqa: ANN201
        from data_pipeline.jobs.signal_ingest import IngestStats

        self.calls.append((vision_slug, capability_keys, lookback_days, per_capability_limit))
        return IngestStats(
            started_at=datetime(2026, 5, 26, 0, 0, 0, tzinfo=UTC),
            finished_at=datetime(2026, 5, 26, 0, 0, 1, tzinfo=UTC),
            visions_processed=1,
            capabilities_processed=1,
            raw_signals_fetched=2,
            extractor_calls=2,
            extractor_failures=0,
            signals_written=2,
            extractor_total_cost_usd=0.002,
            errors=[],
        )


@dataclass
class _FakeInteraction:
    id: str = "int_disp_1"
    status: str = "completed"
    output_text: str = "Body."
    error: str | None = None
    usage_metadata: Any = None


@dataclass
class _FakeInteractions:
    def create(self, **kwargs: Any) -> _FakeInteraction:
        return _FakeInteraction()

    def get(self, id: str) -> _FakeInteraction:  # noqa: A002
        return _FakeInteraction(id=id)


@dataclass
class _FakeGenAI:
    interactions: _FakeInteractions = field(default_factory=_FakeInteractions)


def _build_clients() -> DispatcherClients:
    from agent_tools import DeepResearchClient

    cap = CapabilityRecord(
        id="cap_1",
        sector_slug="alpha",
        key="c1",
        name="Cap one",
        description="",
        rationale="",
    )
    actor = ActorRecord(
        id="act_1",
        key="a1",
        sector_slug="alpha",
        name="Actor one",
        signal_keywords=["a1"],
        primary_capability=cap,
    )
    risk = RiskRecord(
        id="rsk_1",
        key="r1",
        sector_slug="alpha",
        name="Risk one",
        description="",
        category="political",
        severity="medium",
        likelihood="medium",
        time_horizon="1y",
        mitigations=None,
        affected_capability_keys=["c1"],
        source_url=None,
        source_kind=None,
        source_title=None,
        primary_capability=cap,
    )
    return DispatcherClients(
        runs_repo=_InMemoryRunsRepo(),
        capability_reader=_FakeCapReader(records={("alpha", "c1"): cap}),
        actor_reader=_FakeActorReader(records={("alpha", "a1"): actor}),
        risk_reader=_FakeRiskReader(records={("alpha", "r1"): risk}),
        signal_writer=_FakeSignalWriter(),
        deep_research=DeepResearchClient(genai_client=_FakeGenAI(), poll_interval_seconds=0.0),
        agent_client=_FakeAgentClient(),
        signal_ingest_fn=_FakeSignalIngestFn(),
    )


@pytest.mark.asyncio
async def test_dispatcher_routes_each_fetcher_kind() -> None:
    clients = _build_clients()
    cands = [
        Candidate(
            vision_slug="alpha",
            fetcher_kind="capability",
            key="c1",
            anchor_composite=10.0,
            stale_hours=72.0,
            estimated_cost_usd=0.05,
            ranking_score=100.0,
        ),
        Candidate(
            vision_slug="alpha",
            fetcher_kind="actor",
            key="a1",
            anchor_composite=50.0,
            stale_hours=24.0,
            estimated_cost_usd=0.05,
            ranking_score=70.0,
        ),
        Candidate(
            vision_slug="alpha",
            fetcher_kind="risk",
            key="r1",
            anchor_composite=50.0,
            stale_hours=24.0,
            estimated_cost_usd=0.05,
            ranking_score=70.0,
        ),
        Candidate(
            vision_slug="alpha",
            fetcher_kind="signal",
            key="c1",
            anchor_composite=10.0,
            stale_hours=12.0,
            estimated_cost_usd=0.01,
            ranking_score=50.0,
        ),
    ]
    pick = PickResult(
        picked=cands,
        total_candidates=4,
        over_budget_skipped=0,
        per_vision_remaining_usd={"alpha": 2.0},
    )
    summary = await dispatch_tick(pick=pick, clients=clients)
    assert summary.dispatched == 4
    assert summary.ok_count == 4
    assert summary.error_count == 0
    # signal fetcher writes 2 signals; capability + actor + risk each write 1.
    assert summary.total_signals_written == 5


@pytest.mark.asyncio
async def test_dispatcher_isolates_errors() -> None:
    """A missing capability/actor/risk per fetcher raises a *FetcherError
    which dispatcher catches — other candidates still run."""
    clients = _build_clients()
    cands = [
        Candidate(
            vision_slug="alpha",
            fetcher_kind="capability",
            key="missing-cap",  # not in fake reader
            anchor_composite=0.0,
            stale_hours=999.0,
            estimated_cost_usd=0.05,
            ranking_score=999.0,
        ),
        Candidate(
            vision_slug="alpha",
            fetcher_kind="actor",
            key="a1",
            anchor_composite=50.0,
            stale_hours=0.0,
            estimated_cost_usd=0.05,
            ranking_score=10.0,
        ),
    ]
    pick = PickResult(picked=cands, total_candidates=2, over_budget_skipped=0)
    summary = await dispatch_tick(pick=pick, clients=clients)
    assert summary.dispatched == 2
    assert summary.error_count == 1
    assert summary.ok_count == 1


# --------------------------------------------------------------------------
# FastAPI surface — dry-run only (full run exercised by dispatcher unit tests)
# --------------------------------------------------------------------------


def test_post_orchestrator_tick_dry_run() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.orchestrator_reader = _FakeOrchestratorReader(
        visions=["alpha"],
        caps_by_vision={"alpha": [CapabilityCandidate("alpha", "c1", composite_score=15.0)]},
    )
    client = TestClient(app)
    r = client.post("/jobs/orchestrator/tick?dry_run=true", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert body["total_candidates"] == 2  # capability + signal
    assert len(body["picked"]) <= 8
    assert body["dispatch_summary"] is None


def test_post_orchestrator_tick_503_when_reader_unset() -> None:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.orchestrator_reader = None
    client = TestClient(app)
    r = client.post("/jobs/orchestrator/tick?dry_run=true", json={})
    assert r.status_code == 503
