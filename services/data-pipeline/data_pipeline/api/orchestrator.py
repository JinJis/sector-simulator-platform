"""POST /jobs/orchestrator/tick — manual M49f opportunistic picker.

Distinct from the cron entrypoint in ``data_pipeline.jobs.runners.
run_orchestrator_tick_job`` because the manual path supports a
``pinned_visions`` override and a ``dry_run`` toggle for cockpit
preview. The cron path uses neither.
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI

from data_pipeline.api.deps import (
    require_actor_reader,
    require_agent_client,
    require_capability_reader,
    require_crawl_repo,
    require_deep_research,
    require_orchestrator_reader,
    require_risk_reader,
    require_signal_ingest_fn,
    require_signal_writer,
)
from data_pipeline.api.schemas import (
    OrchestratorCandidateOut,
    OrchestratorTickBody,
    OrchestratorTickOut,
)
from data_pipeline.deep_research.dispatcher import DispatcherClients, dispatch_tick
from data_pipeline.deep_research.orchestrator import pick_for_tick


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["orchestrator"])

    @router.post("/jobs/orchestrator/tick", response_model=OrchestratorTickOut)
    async def orchestrator_tick(
        body: OrchestratorTickBody | None = None,
        dry_run: bool = True,
    ) -> OrchestratorTickOut:
        reader = require_orchestrator_reader(app)
        pinned = set(body.pinned_visions) if body and body.pinned_visions else set()
        pick = await pick_for_tick(reader=reader, pinned_visions=pinned)

        picked_out = [
            OrchestratorCandidateOut(
                vision_slug=c.vision_slug,
                fetcher_kind=c.fetcher_kind,
                key=c.key,
                anchor_composite=c.anchor_composite,
                stale_hours=round(c.stale_hours, 2),
                estimated_cost_usd=round(c.estimated_cost_usd, 4),
                ranking_score=round(c.ranking_score, 2),
            )
            for c in pick.picked
        ]

        if dry_run:
            return OrchestratorTickOut(
                dry_run=True,
                total_candidates=pick.total_candidates,
                over_budget_skipped=pick.over_budget_skipped,
                picked=picked_out,
                per_vision_remaining_usd={
                    k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
                },
                dispatch_summary=None,
            )

        repo = require_crawl_repo(app)
        dr = require_deep_research(app)
        agent = require_agent_client(app)
        cap_reader = require_capability_reader(app)
        actor_reader = require_actor_reader(app)
        risk_reader = require_risk_reader(app)
        writer = require_signal_writer(app)
        signal_ingest_fn = require_signal_ingest_fn(app)
        clients = DispatcherClients(
            runs_repo=repo,
            capability_reader=cap_reader,
            actor_reader=actor_reader,
            risk_reader=risk_reader,
            signal_writer=writer,
            deep_research=dr,
            agent_client=agent,
            signal_ingest_fn=signal_ingest_fn,
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        return OrchestratorTickOut(
            dry_run=False,
            total_candidates=pick.total_candidates,
            over_budget_skipped=pick.over_budget_skipped,
            picked=picked_out,
            per_vision_remaining_usd={
                k: round(v, 4) for k, v in pick.per_vision_remaining_usd.items()
            },
            dispatch_summary=summary.to_summary_dict(),
        )

    return router
