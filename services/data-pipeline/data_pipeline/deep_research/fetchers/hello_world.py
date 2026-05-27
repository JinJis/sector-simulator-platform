"""HelloWorldFetcher — the M48c smoke fetcher.

Proves the full seam end-to-end: HTTP trigger → CrawlRun row queued →
DeepResearchClient called → CrawlRun row marked complete with a real
cost figure and a non-empty result_summary.

Not for production use — production fetchers (capability / actor /
signal / risk / economics) replace this in M49. Kept on disk so the
admin cockpit always has a manual smoke trigger.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent_tools import GroundedResearchClient

from data_pipeline.crawl_run_repo import CrawlRunRepository, CrawlRunRow


_DEFAULT_PROMPT = (
    "Give a two-sentence current-state summary of the {vision_slug} "
    "vision so the operator can sanity-check that the crawler service "
    "is wired correctly."
)


@dataclass(frozen=True, slots=True)
class HelloWorldRunRequest:
    vision_slug: str
    prompt: str | None = None  # override the default prompt


@dataclass(frozen=True, slots=True)
class HelloWorldRunResult:
    run: CrawlRunRow
    output_text: str
    cached: bool


def _plan(request: HelloWorldRunRequest) -> dict[str, Any]:
    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug
    )
    return {
        "fetcher": "hello_world",
        "prompt": prompt,
        "tier": "fast",
    }


async def enqueue_hello_world(
    request: HelloWorldRunRequest,
    *,
    repo: CrawlRunRepository,
) -> CrawlRunRow:
    """Phase 1 (HTTP trigger): create the CrawlRun(status=queued) row.
    The caller pushes the run.id onto the ARQ queue; the worker
    invokes `run_hello_world(existing_run=…)` to do the work."""
    return await repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="hello_world",
        plan=_plan(request),
    )


async def run_hello_world(
    request: HelloWorldRunRequest,
    *,
    repo: CrawlRunRepository,
    deep_research: GroundedResearchClient,
    existing_run: CrawlRunRow | None = None,
) -> HelloWorldRunResult:
    """Execute the fetcher against either a freshly-created queued
    row (caller passes `existing_run=None`, default) or an existing
    one (worker path — `existing_run` came from the ARQ task).
    Direct/test callers don't need to think about the split."""
    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug
    )
    row = existing_run or await repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="hello_world",
        plan=_plan(request),
    )
    await repo.mark_running(row.id)

    try:
        result = await deep_research.research(
            prompt=prompt,
            surface="hello_world",
            vision_slug=request.vision_slug,
            tier="fast",
        )
    except Exception as exc:
        # Record the failure on the run row and return — callers want
        # a structured response, not an exception. Common shape here
        # is a Gemini auth / quota error; we surface the type + first
        # line of the message so admins can act on it.
        err_text = f"{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else 'unknown error'}"
        await repo.mark_complete(
            row.id,
            status="error",
            result_summary={"error_kind": type(exc).__name__},
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=err_text[:500],
        )
        fresh = await repo.get(row.id)
        assert fresh is not None
        return HelloWorldRunResult(run=fresh, output_text="", cached=False)

    summary = {
        "interaction_id": result.interaction_id,
        "model": result.model,
        "status": result.status,
        "elapsed_seconds": round(result.elapsed_seconds, 3),
        "cached": result.cached,
        "output_preview": result.output_text[:280],
    }

    db_status = "ok" if result.status == "completed" else result.status
    await repo.mark_complete(
        row.id,
        status=db_status,
        result_summary=summary,
        cost_usd=result.cost_usd if result.cost_usd > 0 else None,
        signals_written=0,
        proposals_written=0,
        error=result.error,
    )

    fresh = await repo.get(row.id)
    assert fresh is not None
    return HelloWorldRunResult(
        run=fresh,
        output_text=result.output_text,
        cached=result.cached,
    )
