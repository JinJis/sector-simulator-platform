"""Scheduler / endpoint runner wrappers.

Thin glue between the data-pipeline FastAPI app and the underlying
pure-functional job code in sibling modules under ``data_pipeline.jobs``
plus the ``data_pipeline.deep_research`` orchestrator + dispatch path.
Each runner reads its dependencies off ``app.state`` (set up in
``main.lifespan``), invokes the work, records ``last_*`` snapshots for
``/health``, and logs a START / DONE pair so cron output is greppable.

APScheduler is wired to these in ``main.create_app``; the POST handlers
that share a runner (refresh, resolve_predictions_v2, signal_ingest,
recompute_feasibility) call the same function so manual triggers and
crons take the exact same path.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI

from data_pipeline.deep_research.digest import DigestRequest, run_deep_research_digest
from data_pipeline.deep_research.dispatcher import DispatcherClients, dispatch_tick
from data_pipeline.deep_research.orchestrator import pick_for_tick
from data_pipeline.jobs.recompute_feasibility import run_recompute_feasibility
from data_pipeline.jobs.refresh_quotes import RefreshQuotesResult, refresh_quotes
from data_pipeline.jobs.resolve_predictions_v2 import (
    ResolvePredictionsV2Result,
    resolve_due_predictions_v2,
)
from data_pipeline.jobs.signal_ingest import run_signal_ingest
from data_pipeline.signals import (
    ArxivSource,
    Crawl4aiFinvizSource,
    Crawl4aiNaverSource,
    Crawl4aiYahooSource,
    GoogleNewsSource,
    UsptoSource,
)

log = logging.getLogger("data_pipeline")


async def run_refresh_job(*, app: FastAPI) -> RefreshQuotesResult:
    repo = app.state.repo
    source = app.state.source
    throttle = int(app.state.throttle_ms)
    log.info(
        "[cron refresh_quotes] START source=%s throttle_ms=%d",
        type(source).__name__,
        throttle,
    )
    result = await refresh_quotes(source=source, repo=repo, throttle_ms=throttle)
    app.state.last_result = result
    log.info("[cron refresh_quotes] DONE %s", result.model_dump())
    return result


async def run_resolve_predictions_v2_job(
    *, app: FastAPI
) -> ResolvePredictionsV2Result | None:
    """M46b — band-based prediction resolver. Runs hourly so 1D/1W
    bets resolve as soon as the corresponding EquityQuote row lands."""
    repo = app.state.resolver_v2_repo
    if repo is None:
        log.warning("[cron resolve_predictions_v2] repo not configured — skipping")
        return None
    log.info("[cron resolve_predictions_v2] START")
    result = await resolve_due_predictions_v2(repo=repo)
    app.state.last_resolve_v2_result = result
    log.info("[cron resolve_predictions_v2] DONE %s", result.model_dump())
    return result


async def get_active_visions(app: FastAPI) -> list[str]:
    """Resolve the list of active visions dynamically from the repository.
    Falls back to the static startup array on any failure or if empty.
    """
    repo = getattr(app.state, "signal_repo", None)
    if repo is not None:
        try:
            slugs = await repo.list_all_vision_slugs()
            if slugs:
                return slugs
        except Exception as e:
            log.warning("[get_active_visions] Failed to fetch active visions from DB: %s", e)
    return getattr(app.state, "signal_ingest_visions", [])


async def run_signal_ingest_job(*, app: FastAPI):  # noqa: ANN201
    """Manual / full-sweep signal ingest. All 3 M39 sources across every
    vision. POST /jobs/signal-ingest invokes this; the tiered crons
    use `run_news_ingest_5min` + `run_research_ingest_hourly` instead
    so news rotates fast and research stays hourly."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("signal-ingest: repo not configured — skipping")
        return None
    visions = await get_active_visions(app)
    stats = await run_signal_ingest(sector_slugs=visions, repo=repo)
    app.state.last_signal_ingest_result = stats
    return stats


async def run_news_ingest_5min(*, app: FastAPI):  # noqa: ANN201
    """Tier 1 — fast-rotation news sweep. Default: Google News RSS
    (keyword-driven, capability-relevant). Set NEWS_INGEST_USE_CRAWL4AI=1
    to use the original ticker-page crawlers (Yahoo + Naver + Finviz)
    instead — those return investor-noise mostly, but cover Korean
    sources Google News thin-coverage's."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron news_ingest_5min] signal_repo unset — skipping")
        return None
    visions = await get_active_visions(app)

    use_crawl4ai = os.environ.get("NEWS_INGEST_USE_CRAWL4AI", "").lower() in {
        "1", "true", "yes", "on",
    }
    if use_crawl4ai:
        async def db_ticker_provider(sector_slug: str):  # noqa: ANN202
            return await repo.list_vision_tickers(sector_slug)

        sources = [
            Crawl4aiYahooSource(ticker_provider=db_ticker_provider),
            Crawl4aiFinvizSource(ticker_provider=db_ticker_provider),
            Crawl4aiNaverSource(ticker_provider=db_ticker_provider),
        ]
    else:
        sources = [GoogleNewsSource()]
    log.info(
        "[cron news_ingest_5min] START visions=%s sources=%s",
        ",".join(visions) or "<none>",
        ",".join(s.name for s in sources),
    )

    stats = await run_signal_ingest(
        sector_slugs=visions,
        repo=repo,
        sources=sources,
        lookback_days=14,
        per_capability_limit=10,
    )
    app.state.last_signal_ingest_result = stats
    log.info(
        "[cron news_ingest_5min] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


async def run_research_ingest_hourly(*, app: FastAPI):  # noqa: ANN201
    """Tier 2 — hourly research sweep (commit 4/6). arXiv + USPTO
    across every vision. Publication cadence on those sources is
    measured in days, so 1 hour is generous; offset to :07 past keeps
    load away from `:00` where most crons cluster."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron research_ingest_hourly] signal_repo unset — skipping")
        return None
    visions = await get_active_visions(app)
    # USPTO disabled by default (M56-4) — operator auth not configured.
    # Set ENABLE_USPTO=1 to re-arm; otherwise arxiv-only.
    sources = [ArxivSource()]
    if os.environ.get("ENABLE_USPTO", "").lower() in {"1", "true", "yes", "on"}:
        sources.append(UsptoSource())
    lookback_days = int(os.environ.get("RESEARCH_INGEST_LOOKBACK_DAYS", "7"))
    log.info(
        "[cron research_ingest_hourly] START visions=%s sources=%s lookback=%dd",
        ",".join(visions) or "<none>",
        ",".join(s.name for s in sources),
        lookback_days,
    )
    stats = await run_signal_ingest(
        sector_slugs=visions,
        repo=repo,
        sources=sources,
        lookback_days=lookback_days,
        per_capability_limit=10,
    )
    app.state.last_signal_ingest_result = stats
    log.info(
        "[cron research_ingest_hourly] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


async def run_digest_daily_job(*, app: FastAPI):  # noqa: ANN201
    """Daily grounded-research digest sweep — one signal per vision.
    Each call hits the Vertex grounded gemini (DEEP tier) once, so the
    daily cost is roughly $0.30 × N visions. Per-vision errors are
    logged + swallowed so one bad vision doesn't kill the rest."""
    repo = getattr(app.state, "crawl_runs_repo", None)
    sig_repo = getattr(app.state, "signal_repo", None)
    writer = getattr(app.state, "signal_writer", None)
    dr = getattr(app.state, "deep_research", None)
    agent = getattr(app.state, "agent_client", None)
    if any(x is None for x in (repo, sig_repo, writer, dr, agent)):
        log.warning(
            "[cron digest_daily] missing dep(s) — skipping "
            "(crawl_runs=%s signal_repo=%s writer=%s dr=%s agent=%s)",
            *[("on" if x is not None else "off") for x in (repo, sig_repo, writer, dr, agent)],
        )
        return None
    visions = await get_active_visions(app)
    # Pre-filter to visions that actually have capabilities — the digest
    # anchors itself on one capability per vision, and on an empty
    # vision the inner check fails + writes an error crawl_run. Without
    # this pre-filter the cockpit fills with `error: no_capabilities_for_vision`
    # noise on every tick. Manual SQLAdmin triggers bypass this gate.
    eligible: list[str] = []
    skipped: list[str] = []
    for slug in visions:
        caps = await sig_repo.list_vision_capabilities(slug)
        if caps:
            eligible.append(slug)
        else:
            skipped.append(slug)
    if skipped:
        log.info(
            "[cron digest_daily] skipping %d vision(s) with no capabilities: %s",
            len(skipped),
            ",".join(skipped),
        )
    log.info(
        "[cron digest_daily] START visions=%s",
        ",".join(eligible) or "<none>",
    )
    ok = err = 0
    for slug in eligible:
        log.info("[cron digest_daily] vision=%s — calling DR digest", slug)
        try:
            await run_deep_research_digest(
                DigestRequest(vision_slug=slug),
                runs_repo=repo,
                signal_repo=sig_repo,
                signal_writer=writer,
                deep_research=dr,
                agent_client=agent,
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001
            log.error("[cron digest_daily] vision=%s failed: %s", slug, exc)
            err += 1
    log.info(
        "[cron digest_daily] DONE ok=%d err=%d skipped=%d visions=%d",
        ok,
        err,
        len(skipped),
        len(visions),
    )
    return {
        "ok": ok,
        "err": err,
        "skipped_no_capabilities": len(skipped),
        "visions": len(visions),
    }


async def run_recompute_feasibility_job(*, app: FastAPI):  # noqa: ANN201
    """Hourly feasibility recompute (commit 4/6). Calls ScoreUpdater
    agent per capability, then triggers sim-service vision-level
    aggregation. Was daily before the merger — moves to hourly so the
    5-min news + hourly research signals roll into FeasibilityIndex
    within the hour."""
    repo = app.state.signal_repo
    if repo is None:
        log.warning("[cron recompute_feasibility] repo not configured — skipping")
        return None
    visions = await get_active_visions(app)
    log.info(
        "[cron recompute_feasibility] START visions=%s",
        ",".join(visions) or "<none>",
    )
    stats = await run_recompute_feasibility(
        sector_slugs=visions,
        repo=repo,
        job_config=getattr(app.state, "job_config", None),
    )
    app.state.last_feasibility_recompute_result = stats
    log.info(
        "[cron recompute_feasibility] DONE %s",
        getattr(stats, "model_dump", lambda: stats)(),
    )
    return stats


async def run_orchestrator_tick_job(*, app: FastAPI) -> None:
    """Cron entrypoint (M49f) — wraps pick_for_tick + dispatch_tick with
    full client wiring from app.state. Logs + swallows errors so a bad
    tick doesn't kill the scheduler."""
    reader = getattr(app.state, "orchestrator_reader", None)
    if reader is None:
        log.warning("[cron orchestrator_tick] orchestrator_reader unset — skipping tick")
        return
    log.info("[cron orchestrator_tick] START")
    try:
        pick = await pick_for_tick(reader=reader)
        if not pick.picked:
            log.info(
                "[cron orchestrator_tick] DONE picked=0 candidates=%d over_budget=%d",
                pick.total_candidates,
                pick.over_budget_skipped,
            )
            return
        log.info(
            "[cron orchestrator_tick] picked %d/%d (over_budget=%d) — dispatching",
            len(pick.picked),
            pick.total_candidates,
            pick.over_budget_skipped,
        )
        deps = [
            getattr(app.state, "crawl_runs_repo", None),
            getattr(app.state, "deep_research", None),
            getattr(app.state, "agent_client", None),
            getattr(app.state, "capability_reader", None),
            getattr(app.state, "actor_reader", None),
            getattr(app.state, "risk_reader", None),
            getattr(app.state, "signal_writer", None),
            getattr(app.state, "signal_ingest_fn", None),
        ]
        if any(d is None for d in deps):
            log.warning(
                "[cron orchestrator_tick] missing dep(s) — skipping dispatch "
                "(runs=%s dr=%s agent=%s cap=%s actor=%s risk=%s writer=%s ingest_fn=%s)",
                *["on" if d is not None else "off" for d in deps],
            )
            return
        clients = DispatcherClients(
            runs_repo=deps[0],
            capability_reader=deps[3],
            actor_reader=deps[4],
            risk_reader=deps[5],
            signal_writer=deps[6],
            deep_research=deps[1],
            agent_client=deps[2],
            signal_ingest_fn=deps[7],
        )
        summary = await dispatch_tick(pick=pick, clients=clients)
        app.state.last_orchestrator_tick = summary.to_summary_dict()
    except Exception as exc:  # noqa: BLE001
        log.error("[cron orchestrator_tick] tick failed: %s", exc)
