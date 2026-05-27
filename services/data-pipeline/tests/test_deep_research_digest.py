"""Offline tests for run_deep_research_digest + the
POST /jobs/deep-research-digest/run endpoint.

Shape mirrors test_risk_fetcher.py — Deep Research backed by
_FakeGenAI, SignalExtractor faked, SignalWriter is an in-memory list,
SignalRepository implements only list_vision_capabilities (the digest
doesn't need the other Protocol methods).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from agent_tools import GroundedResearchClient
from data_pipeline.agents import (
    SignalExtractorRequest,
    SignalExtractorRunResult,
    SignalScoring,
)
from data_pipeline.crawl_run_repo import CrawlRunRow
from data_pipeline.db.signal_writer import SignalUpsert
from data_pipeline.deep_research.digest import (
    DigestError,
    DigestRequest,
    run_deep_research_digest,
)
from data_pipeline.main import create_app
from data_pipeline.signal_repo import (
    ActorHandle,
    CapabilityHandle,
    CurrentCapabilityScore,
)
from fastapi.testclient import TestClient

# --------------------------------------------------------------------------
# Fakes (copied verbatim from test_risk_fetcher.py shape so a future
# refactor can consolidate)
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

    async def list_recent(self, **_: Any) -> list[CrawlRunRow]:
        return list(self.rows.values())


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
class _InMemorySignalRepo:
    """Implements only the SignalRepository methods digest needs."""

    capabilities_by_vision: dict[str, list[CapabilityHandle]] = field(default_factory=dict)
    # Capability id → min-dim score. The fake stamps that number on
    # all 4 dims so the digest's Liebig-min anchor picker sees it as
    # the binding composite. Missing entries return None → digest
    # treats as un-scored (sorts last when ranking).
    scores_by_capability_id: dict[str, float] = field(default_factory=dict)

    async def list_vision_capabilities(self, sector_slug: str) -> list[CapabilityHandle]:
        return self.capabilities_by_vision.get(sector_slug, [])

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]:
        return []

    async def get_current_capability_score(
        self, capability_id: str
    ) -> CurrentCapabilityScore | None:
        if capability_id not in self.scores_by_capability_id:
            return None
        v = self.scores_by_capability_id[capability_id]
        return CurrentCapabilityScore(
            capability_id=capability_id,
            capability_key="",
            technical=v,
            economic=v,
            regulatory=v,
            supply=v,
        )


@dataclass
class _FakeAgentClient:
    next_scoring: SignalScoring = field(
        default_factory=lambda: SignalScoring(
            delta_technical=2.0,
            delta_economic=1.0,
            delta_regulatory=-1.0,
            delta_supply=0.5,
            confidence=0.81,
            is_highlight=True,
            matched_actor_key=None,
            rationale="fake digest score",
        )
    )
    next_cost_usd: float = 0.0012
    raise_for: bool = False
    calls: list[SignalExtractorRequest] = field(default_factory=list)

    async def score_signal(self, req: SignalExtractorRequest) -> SignalExtractorRunResult:
        self.calls.append(req)
        if self.raise_for:
            raise RuntimeError("agent unreachable")
        return SignalExtractorRunResult(
            scoring=self.next_scoring,
            cost_usd=self.next_cost_usd,
            duration_ms=42,
        )


_FAKE_DIGEST_TEXT = (
    "AWS announced a $4B orbital DC capex tranche; SK Hynix flagged "
    "HBM4 supply tightening; FCC opened comment period on orbital "
    "spectrum reallocation."
)


@dataclass
class _FakeUsage:
    prompt_token_count: int = 1200
    candidates_token_count: int = 700
    total_token_count: int = 1900


@dataclass
class _FakeResponse:
    text: str = _FAKE_DIGEST_TEXT
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
    return GroundedResearchClient(genai_client=_FakeGenAI())


def _seed_signal_repo() -> _InMemorySignalRepo:
    repo = _InMemorySignalRepo()
    repo.capabilities_by_vision["space-data-center"] = [
        CapabilityHandle(
            id="cap_radhard_1",
            sector_slug="space-data-center",
            key="rad-hard-compute",
            name="Radiation-hardened compute",
            description="Compute tolerant to LEO radiation.",
            rationale="Without rad-hard silicon, orbital DCs can't run.",
        ),
        CapabilityHandle(
            id="cap_thermal_1",
            sector_slug="space-data-center",
            key="thermal-management",
            name="Orbital thermal management",
            description="Passive + active heat rejection for orbital DC racks.",
            rationale="Heat is the binding limit at scale.",
        ),
    ]
    return repo


# --------------------------------------------------------------------------
# Direct fetcher tests
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_digest_writes_signal_anchored_on_first_capability() -> None:
    runs = _InMemoryRunsRepo()
    sig_repo = _seed_signal_repo()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_deep_research_digest(
        DigestRequest(vision_slug="space-data-center"),
        runs_repo=runs,
        signal_repo=sig_repo,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )

    assert result.run.status == "ok"
    assert result.signal_id is not None
    assert result.run.signals_written == 1
    assert result.run.cost_usd is not None and result.run.cost_usd > 0

    # Anchor = first capability listed.
    assert result.anchor_capability is not None
    assert result.anchor_capability.key == "rad-hard-compute"

    # Extractor sees the anchor context + empty actor_keywords.
    assert len(agent.calls) == 1
    req = agent.calls[0]
    assert req.capability_key == "rad-hard-compute"
    assert req.source_kind == "research_brief"
    assert req.actor_keywords == []

    # Signal: day-bucketed digest pseudo-URL, no actor, highlight=True.
    assert len(writer.rows) == 1
    w = writer.rows[0]
    assert w.actor_id is None
    assert w.capability_id == "cap_radhard_1"
    assert w.source_url.startswith("internal://digest/space-data-center/")
    assert w.delta_technical == 2.0  # confidence 0.81 ≥ 0.5
    assert w.is_highlight is True


@pytest.mark.asyncio
async def test_digest_anchors_on_lowest_liebig_min_capability() -> None:
    """Two scored capabilities — the one with the lower min dim is
    the binding constraint and should win the anchor selection
    regardless of its position in the list."""
    runs = _InMemoryRunsRepo()
    sig_repo = _seed_signal_repo()  # rad-hard-compute first, thermal second
    # Thermal is binding (lower min) — should win even though it's
    # listed second.
    sig_repo.scores_by_capability_id["cap_radhard_1"] = 65.0
    sig_repo.scores_by_capability_id["cap_thermal_1"] = 30.0
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_deep_research_digest(
        DigestRequest(vision_slug="space-data-center"),
        runs_repo=runs,
        signal_repo=sig_repo,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    assert result.anchor_capability is not None
    assert result.anchor_capability.key == "thermal-management"
    # Signal got written to the thermal capability id.
    assert writer.rows[0].capability_id == "cap_thermal_1"
    # Extractor saw the binding capability's context.
    assert agent.calls[0].capability_key == "thermal-management"


@pytest.mark.asyncio
async def test_digest_cold_start_falls_back_to_first_capability() -> None:
    """All capabilities un-scored (cold-start vision) — digest anchors
    on the first listed capability so it doesn't bail out."""
    runs = _InMemoryRunsRepo()
    sig_repo = _seed_signal_repo()  # no scores set
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    result = await run_deep_research_digest(
        DigestRequest(vision_slug="space-data-center"),
        runs_repo=runs,
        signal_repo=sig_repo,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    # rad-hard-compute is first in _seed_signal_repo.
    assert result.anchor_capability is not None
    assert result.anchor_capability.key == "rad-hard-compute"


@pytest.mark.asyncio
async def test_digest_raises_when_vision_has_no_capabilities() -> None:
    runs = _InMemoryRunsRepo()
    sig_repo = _InMemorySignalRepo()  # empty
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient()

    with pytest.raises(DigestError) as excinfo:
        await run_deep_research_digest(
            DigestRequest(vision_slug="space-data-center"),
            runs_repo=runs,
            signal_repo=sig_repo,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
        )
    assert excinfo.value.run.status == "error"
    assert excinfo.value.run.error and "no capabilities" in excinfo.value.run.error
    # DR + extractor were never called.
    assert agent.calls == []
    assert writer.rows == []


@pytest.mark.asyncio
async def test_digest_low_confidence_keeps_deltas_null() -> None:
    runs = _InMemoryRunsRepo()
    sig_repo = _seed_signal_repo()
    writer = _InMemorySignalWriter()
    dr = _build_deep_research()
    agent = _FakeAgentClient(
        next_scoring=SignalScoring(
            delta_technical=3.0,
            delta_economic=1.0,
            delta_regulatory=0.0,
            delta_supply=-1.0,
            confidence=0.35,  # below 0.5 threshold
            is_highlight=False,
            matched_actor_key=None,
            rationale="uncertain",
        )
    )

    result = await run_deep_research_digest(
        DigestRequest(vision_slug="space-data-center"),
        runs_repo=runs,
        signal_repo=sig_repo,
        signal_writer=writer,
        deep_research=dr,
        agent_client=agent,
    )
    assert result.run.status == "ok"
    assert len(writer.rows) == 1
    w = writer.rows[0]
    # Low confidence → deltas dropped to null; the brief is still
    # written so the cockpit can show "DR ran but extractor was unsure".
    assert w.delta_technical is None
    assert w.delta_supply is None
    # Digest always promotes the row regardless of extractor's
    # is_highlight verdict.
    assert w.is_highlight is True


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


def _client_with_fakes() -> tuple[TestClient, _FakeAgentClient, _InMemorySignalWriter]:
    app = create_app()
    app.state.crawl_runs_repo = _InMemoryRunsRepo()
    app.state.deep_research = _build_deep_research()
    app.state.signal_repo = _seed_signal_repo()
    writer = _InMemorySignalWriter()
    app.state.signal_writer = writer
    agent = _FakeAgentClient()
    app.state.agent_client = agent
    # Disabling the rest so the lifespan doesn't try to build real ones.
    app.state.capability_reader = None
    app.state.actor_reader = None
    app.state.risk_reader = None
    app.state.orchestrator_reader = None
    app.state.discovery_reader = None
    app.state.proposal_writer = None
    app.state.bot_user_id = None
    app.state.signal_ingest_fn = None
    app.state.queue_client = _FakeQueueClient(app=app)
    return TestClient(app), agent, writer


def test_post_digest_returns_run_payload() -> None:
    client, agent, writer = _client_with_fakes()
    r = client.post(
        "/jobs/deep-research-digest/run",
        json={"vision_slug": "space-data-center"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["run"]["fetcher_kind"] == "digest"
    run_id = body["run"]["id"]
    final = client.app.state.crawl_runs_repo.rows[run_id]
    assert final.status == "ok"
    assert len(agent.calls) == 1
    assert len(writer.rows) == 1


def test_post_digest_404_when_vision_has_no_capabilities() -> None:
    client, _, _ = _client_with_fakes()
    # Re-wire signal_repo to an empty one.
    client.app.state.signal_repo = _InMemorySignalRepo()
    r = client.post(
        "/jobs/deep-research-digest/run",
        json={"vision_slug": "unknown-vision"},
    )
    assert r.status_code == 200, r.text
    run_id = r.json()["run"]["id"]
    final = client.app.state.crawl_runs_repo.rows[run_id]
    assert final.status == "error"
    assert final.error and "no capabilities" in final.error
