"""Dispatcher (M49f).

Given a list of picked Candidates + the shared per-fetcher clients,
invoke the right `run_*_fetcher` function for each candidate. Per-
candidate errors are caught + recorded — one bad call doesn't kill
the rest of the tick. The CrawlRun row each fetcher writes is the
source of truth for what actually happened; this returns a
TickSummary for the admin cockpit + cron logs.

Held separate from `orchestrator.py` so the picker stays pure (easy
to unit-test) and the dispatcher owns all the wiring.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from agent_tools import DeepResearchClient

from data_pipeline.agents import AgentClient
from data_pipeline.deep_research.data_pipeline import DataPipelineClient
from data_pipeline.db.actor_reader import ActorReader
from data_pipeline.db.capability_reader import CapabilityReader
from data_pipeline.db.risk_reader import RiskReader
from data_pipeline.db.signal_writer import SignalWriter
from data_pipeline.deep_research.fetchers.actor import ActorFetchRequest, run_actor_fetcher
from data_pipeline.deep_research.fetchers.capability import (
    CapabilityFetchRequest,
    run_capability_fetcher,
)
from data_pipeline.deep_research.fetchers.risk import RiskFetchRequest, run_risk_fetcher
from data_pipeline.deep_research.fetchers.signal import SignalFetchRequest, run_signal_fetcher
from data_pipeline.deep_research.orchestrator import Candidate, PickResult
from data_pipeline.crawl_run_repo import CrawlRunRepository

log = logging.getLogger("crawler.dispatcher")


@dataclass(slots=True)
class DispatchOutcome:
    candidate: Candidate
    run_id: str | None
    status: str  # ok | error | skipped
    signals_written: int
    cost_usd: float
    error: str | None


@dataclass(slots=True)
class TickSummary:
    started_at: datetime
    finished_at: datetime | None = None
    total_candidates: int = 0
    over_budget_skipped: int = 0
    dispatched: int = 0
    ok_count: int = 0
    error_count: int = 0
    total_signals_written: int = 0
    total_cost_usd: float = 0.0
    outcomes: list[DispatchOutcome] = field(default_factory=list)

    def to_summary_dict(self) -> dict[str, Any]:
        return {
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "total_candidates": self.total_candidates,
            "over_budget_skipped": self.over_budget_skipped,
            "dispatched": self.dispatched,
            "ok_count": self.ok_count,
            "error_count": self.error_count,
            "total_signals_written": self.total_signals_written,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "outcomes": [
                {
                    "vision_slug": o.candidate.vision_slug,
                    "fetcher_kind": o.candidate.fetcher_kind,
                    "key": o.candidate.key,
                    "run_id": o.run_id,
                    "status": o.status,
                    "signals_written": o.signals_written,
                    "cost_usd": round(o.cost_usd, 4),
                    "ranking_score": round(o.candidate.ranking_score, 2),
                    "error": o.error,
                }
                for o in self.outcomes
            ],
        }


# --------------------------------------------------------------------------
# Wired clients bundle — passes through what each fetcher needs.
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DispatcherClients:
    runs_repo: CrawlRunRepository
    capability_reader: CapabilityReader
    actor_reader: ActorReader
    risk_reader: RiskReader
    signal_writer: SignalWriter
    deep_research: DeepResearchClient
    agent_client: AgentClient
    data_pipeline: DataPipelineClient


# --------------------------------------------------------------------------
# Per-candidate dispatch
# --------------------------------------------------------------------------


async def _dispatch_one(cand: Candidate, *, clients: DispatcherClients) -> DispatchOutcome:
    try:
        if cand.fetcher_kind == "capability":
            out = await run_capability_fetcher(
                CapabilityFetchRequest(
                    vision_slug=cand.vision_slug,
                    capability_key=cand.key,
                ),
                runs_repo=clients.runs_repo,
                capability_reader=clients.capability_reader,
                signal_writer=clients.signal_writer,
                deep_research=clients.deep_research,
                agent_client=clients.agent_client,
            )
            return DispatchOutcome(
                candidate=cand,
                run_id=out.run.id,
                status=out.run.status,
                signals_written=out.run.signals_written,
                cost_usd=float(out.run.cost_usd) if out.run.cost_usd else 0.0,
                error=out.run.error,
            )
        if cand.fetcher_kind == "actor":
            out = await run_actor_fetcher(
                ActorFetchRequest(
                    vision_slug=cand.vision_slug,
                    actor_key=cand.key,
                ),
                runs_repo=clients.runs_repo,
                actor_reader=clients.actor_reader,
                signal_writer=clients.signal_writer,
                deep_research=clients.deep_research,
                agent_client=clients.agent_client,
            )
            return DispatchOutcome(
                candidate=cand,
                run_id=out.run.id,
                status=out.run.status,
                signals_written=out.run.signals_written,
                cost_usd=float(out.run.cost_usd) if out.run.cost_usd else 0.0,
                error=out.run.error,
            )
        if cand.fetcher_kind == "risk":
            out = await run_risk_fetcher(
                RiskFetchRequest(
                    vision_slug=cand.vision_slug,
                    risk_key=cand.key,
                ),
                runs_repo=clients.runs_repo,
                risk_reader=clients.risk_reader,
                signal_writer=clients.signal_writer,
                deep_research=clients.deep_research,
                agent_client=clients.agent_client,
            )
            return DispatchOutcome(
                candidate=cand,
                run_id=out.run.id,
                status=out.run.status,
                signals_written=out.run.signals_written,
                cost_usd=float(out.run.cost_usd) if out.run.cost_usd else 0.0,
                error=out.run.error,
            )
        if cand.fetcher_kind == "signal":
            out = await run_signal_fetcher(
                SignalFetchRequest(
                    vision_slug=cand.vision_slug,
                    capability_key=cand.key,
                ),
                runs_repo=clients.runs_repo,
                capability_reader=clients.capability_reader,
                data_pipeline=clients.data_pipeline,
            )
            return DispatchOutcome(
                candidate=cand,
                run_id=out.run.id,
                status=out.run.status,
                signals_written=out.run.signals_written,
                cost_usd=float(out.run.cost_usd) if out.run.cost_usd else 0.0,
                error=out.run.error,
            )
        return DispatchOutcome(
            candidate=cand,
            run_id=None,
            status="skipped",
            signals_written=0,
            cost_usd=0.0,
            error=f"unknown fetcher_kind: {cand.fetcher_kind}",
        )
    except Exception as exc:  # noqa: BLE001
        # The per-fetcher Error subclasses surface as exceptions in the
        # 404 paths (unknown capability/actor/risk). We absorb them
        # here so the rest of the tick continues.
        log.warning(
            "dispatcher: candidate failed vision=%s fetcher=%s key=%s err=%s",
            cand.vision_slug,
            cand.fetcher_kind,
            cand.key,
            exc,
        )
        return DispatchOutcome(
            candidate=cand,
            run_id=None,
            status="error",
            signals_written=0,
            cost_usd=0.0,
            error=f"{type(exc).__name__}: {exc}",
        )


async def dispatch_tick(
    *,
    pick: PickResult,
    clients: DispatcherClients,
) -> TickSummary:
    summary = TickSummary(
        started_at=datetime.now(UTC),
        total_candidates=pick.total_candidates,
        over_budget_skipped=pick.over_budget_skipped,
    )
    for cand in pick.picked:
        outcome = await _dispatch_one(cand, clients=clients)
        summary.outcomes.append(outcome)
        summary.dispatched += 1
        if outcome.status == "ok":
            summary.ok_count += 1
            summary.total_signals_written += outcome.signals_written
            summary.total_cost_usd += outcome.cost_usd
        else:
            summary.error_count += 1
    summary.finished_at = datetime.now(UTC)
    log.info(
        "dispatcher: tick complete dispatched=%d ok=%d err=%d signals=%d cost=$%.4f",
        summary.dispatched,
        summary.ok_count,
        summary.error_count,
        summary.total_signals_written,
        summary.total_cost_usd,
    )
    return summary
