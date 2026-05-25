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

from agent_tools import DeepResearchClient

from crawler.repo import CrawlRunRepository, CrawlRunRow


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


async def run_hello_world(
    request: HelloWorldRunRequest,
    *,
    repo: CrawlRunRepository,
    deep_research: DeepResearchClient,
) -> HelloWorldRunResult:
    prompt = (request.prompt or _DEFAULT_PROMPT).format(
        vision_slug=request.vision_slug
    )
    plan: dict[str, Any] = {
        "fetcher": "hello_world",
        "prompt": prompt,
        "tier": "fast",
    }

    row = await repo.create_queued(
        vision_slug=request.vision_slug,
        fetcher_kind="hello_world",
        plan=plan,
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
        await repo.mark_complete(
            row.id,
            status="error",
            result_summary=None,
            cost_usd=None,
            signals_written=0,
            proposals_written=0,
            error=str(exc),
        )
        raise

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
