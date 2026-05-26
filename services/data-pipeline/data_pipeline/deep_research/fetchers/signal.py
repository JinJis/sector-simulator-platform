"""SignalFetcher (M49c).

The crawler orchestrator picks one (vision × capability) per tick
(binding × stale × pinned − cost ranking from composition.md §4) and
asks data-pipeline to run the M39 ingest scoped to that scope. This
fetcher is the thin orchestration wrapper:

  1. Create a CrawlRun row (status=queued → running).
  2. Verify the capability exists for the vision (so we fail fast on
     typos instead of paying for an unmanned ingest call).
  3. Call `data_pipeline.scoped_signal_ingest({sector, [capability]})`
     over HTTP. data-pipeline does the heavy lifting — adapters fetch,
     SignalExtractor scores, repo upserts. The Signal rows land
     directly in the same `signals` table the M40 ScoreUpdater reads.
  4. Mark the CrawlRun ok / error with the returned IngestStats
     (signals_written + extractor cost rolled onto cost_usd).

One run = one CrawlRun row. Idempotency is owned by data-pipeline
(its repo uses ON CONFLICT (source_url, capability_id) DO UPDATE).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from data_pipeline.deep_research.data_pipeline import (
    DataPipelineClient,
    ScopedIngestRequest,
    ScopedIngestResult,
)
from data_pipeline.db.capability_reader import CapabilityReader, CapabilityRecord
from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow


@dataclass(frozen=True, slots=True)
class SignalFetchRequest:
    vision_slug: str
    capability_key: str
    # Forwarded to data-pipeline; defaults match the daily cron.
    lookback_days: int = 3
    per_capability_limit: int = 10


@dataclass(frozen=True, slots=True)
class SignalFetchResult:
    run: CrawlRunRow
    capability: CapabilityRecord | None
    ingest: ScopedIngestResult | None


class SignalFetcherError(Exception):
    """Raised when the fetcher refuses to even attempt the run (e.g.
    unknown capability). The crawler endpoint maps this to a 404."""

    def __init__(self, message: str, *, run: CrawlRunRow) -> None:
        super().__init__(message)
        self.run = run


async def run_signal_fetcher(
    request: SignalFetchRequest,
    *,
    runs_repo: CrawlRunRepository,
    capability_reader: CapabilityReader,
    data_pipeline: DataPipelineClient,
) -> SignalFetchResult:
    plan: dict[str, Any] = {
        "fetcher": "signal",
        "vision_slug": request.vision_slug,
        "capability_key": request.capability_key,
        "lookback_days": request.lookback_days,
        "per_capability_limit": request.per_capability_limit,
    }
    run = await runs_repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="signal",
        plan=plan,
    )
    await runs_repo.mark_running(run.id)

    # 1. Validate the capability — saves a wasted ingest call when the
    # admin typed a wrong key into the cockpit.
    capability = await capability_reader.get(
        sector_slug=request.vision_slug, capability_key=request.capability_key
    )
    if capability is None:
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": "capability_not_found",
                "vision_slug": request.vision_slug,
                "capability_key": request.capability_key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=(f"no capability {request.capability_key!r} for vision {request.vision_slug!r}"),
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        raise SignalFetcherError(
            f"capability not found: {request.vision_slug}/{request.capability_key}",
            run=fresh,
        )

    # 2. Delegate to data-pipeline. Any HTTP / parse failure becomes an
    # `error` CrawlRun — we never re-raise on the orchestrator path,
    # callers want a structured response.
    try:
        ingest = await data_pipeline.scoped_signal_ingest(
            ScopedIngestRequest(
                sector_slug=request.vision_slug,
                capability_keys=[request.capability_key],
                lookback_days=request.lookback_days,
                per_capability_limit=request.per_capability_limit,
            )
        )
    except Exception as exc:  # noqa: BLE001
        err_text = (
            f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else 'unknown error'}"
        )
        await runs_repo.mark_complete(
            run.id,
            status="error",
            result_summary={
                "error_kind": type(exc).__name__,
                "capability_id": capability.id,
                "capability_key": capability.key,
            },
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await runs_repo.get(run.id)
        assert fresh is not None
        return SignalFetchResult(run=fresh, capability=capability, ingest=None)

    # 3. Success — bookkeep the CrawlRun. data-pipeline's IngestStats
    # already aggregates extractor cost + signals_written; we just
    # transcribe them onto the row so the admin cockpit reads one shape
    # across capability / actor / signal fetchers.
    cost = ingest.extractor_total_cost_usd if ingest.extractor_total_cost_usd > 0 else None
    summary = _summarize(ingest=ingest, capability=capability)
    await runs_repo.mark_complete(
        run.id,
        status="ok",
        result_summary=summary,
        cost_usd=cost,
        signals_written=ingest.signals_written,
        proposals_written=0,
        error=None,
    )
    fresh = await runs_repo.get(run.id)
    assert fresh is not None
    return SignalFetchResult(run=fresh, capability=capability, ingest=ingest)


def _summarize(*, ingest: ScopedIngestResult, capability: CapabilityRecord) -> dict[str, Any]:
    return {
        "capability_id": capability.id,
        "capability_key": capability.key,
        "capability_name": capability.name,
        "started_at": ingest.started_at,
        "finished_at": ingest.finished_at,
        "raw_signals_fetched": ingest.raw_signals_fetched,
        "extractor_calls": ingest.extractor_calls,
        "extractor_failures": ingest.extractor_failures,
        "signals_written": ingest.signals_written,
        "extractor_total_cost_usd": ingest.extractor_total_cost_usd,
        "errors": ingest.errors,
    }
