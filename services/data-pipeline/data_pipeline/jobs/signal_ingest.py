"""Signal ingest job (M39c) — drives adapters + extractor + DB writes.

For each (vision × capability) tuple:
  1. Load keyword set from
     `data_pipeline/signals/keywords/<vision_slug>.json`
  2. Call each registered SignalSource (adapters/arxiv, +newsapi/uspto
     when those ship in M39d/e) with the keywords + `since` cutoff
  3. For each RawSignal returned, call the SignalExtractor agent via
     HTTP (`POST agent-orchestration:8002/signal-extractor/score`)
  4. Upsert into signals with extractor-supplied deltas + actor_id

Failures are per-signal: one bad arXiv hit doesn't kill the whole run.
Cron schedules this once daily (default 18:00 KST = 09:00 UTC).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from data_pipeline.signal_repo import (
    ActorHandle,
    SignalInsert,
    SignalRepository,
)
from data_pipeline.signals.arxiv import ArxivSource
from data_pipeline.signals.base import RawSignal, SignalSource
from data_pipeline.signals.crawl4ai_news import (
    Crawl4aiFinvizSource,
    Crawl4aiNaverSource,
    Crawl4aiYahooSource,
)
from data_pipeline.signals.uspto import UsptoSource

log = logging.getLogger(__name__)

# Per-vision keyword files live alongside the adapters.
_KEYWORDS_DIR = Path(__file__).resolve().parent.parent / "signals" / "keywords"

# Default windows. Daily cron uses 3 days to catch what missed via
# adapter timeouts on the last run.
_DEFAULT_LOOKBACK_DAYS = 3
_DEFAULT_AGENT_URL = "http://localhost:8002"


@dataclass(slots=True)
class IngestStats:
    """Per-run summary returned by `run_signal_ingest` + surfaced on
    the /jobs/signal-ingest/last health endpoint."""

    started_at: datetime
    finished_at: datetime | None = None
    visions_processed: int = 0
    capabilities_processed: int = 0
    raw_signals_fetched: int = 0
    extractor_calls: int = 0
    extractor_failures: int = 0
    signals_written: int = 0
    extractor_total_cost_usd: float = 0.0
    errors: list[str] = field(default_factory=list)


def _load_keywords(sector_slug: str) -> dict[str, list[str]]:
    """Load per-capability keyword set for a vision. Returns {} if the
    file doesn't exist (memory-semi + sofc don't have curated keywords
    yet — the cron just skips them)."""
    path = _KEYWORDS_DIR / f"{sector_slug}.json"
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.warning("signal_ingest: bad keywords file %s: %s", path, e)
        return {}
    caps = raw.get("capabilities", {})
    if not isinstance(caps, dict):
        return {}
    out: dict[str, list[str]] = {}
    for k, v in caps.items():
        if isinstance(v, list) and all(isinstance(s, str) for s in v):
            out[k] = v
    return out


async def _score_signal(
    *,
    agent_url: str,
    raw: RawSignal,
    capability_name: str,
    capability_description: str,
    capability_rationale: str,
    actors: list[ActorHandle],
    client: httpx.AsyncClient,
) -> dict | None:
    """Single extractor HTTP call. Returns the parsed body or None on
    failure (logged, not raised)."""
    payload = {
        "sector_slug": raw.sector_slug,
        "capability_key": raw.capability_key,
        "capability_name": capability_name,
        "capability_description": capability_description,
        "capability_rationale": capability_rationale,
        "signal_title": raw.title,
        "signal_summary": raw.summary,
        "source_kind": raw.source_kind,
        "actor_keywords": [
            {"actor_key": a.key, "aliases": a.aliases} for a in actors
        ],
    }
    try:
        resp = await client.post(
            f"{agent_url}/signal-extractor/score",
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        log.warning(
            "signal_ingest: extractor failed for %s/%s url=%s: %s",
            raw.sector_slug,
            raw.capability_key,
            raw.source_url,
            e,
        )
        return None


async def run_signal_ingest(
    *,
    sector_slugs: list[str],
    repo: SignalRepository,
    sources: list[SignalSource] | None = None,
    agent_url: str | None = None,
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    per_capability_limit: int = 10,
    skip_extractor: bool = False,
    capability_keys: list[str] | None = None,
) -> IngestStats:
    """Drive one ingest pass across all visions × capabilities × sources.

    Args:
        sector_slugs: Visions to ingest. Visions without a keywords file
            are skipped (logged).
        repo: SignalRepository implementation (Postgres in prod).
        sources: SignalSource implementations to call. Defaults to
            ArxivSource() only.
        agent_url: agent-orchestration base URL. Defaults to env
            AGENT_ORCHESTRATION_URL or http://localhost:8002.
        lookback_days: Adapter `since` window.
        per_capability_limit: max_results passed to each adapter.
        skip_extractor: For test/CI — write raw signals without extractor
            scoring (all deltas null).
        capability_keys: M49c — optional whitelist. When provided, only
            these capability keys are ingested within each vision; keys
            outside the keyword file are silently dropped. None = every
            capability with a keyword entry (legacy behavior).

    Returns:
        IngestStats summary.
    """
    capability_filter: set[str] | None = (
        set(capability_keys) if capability_keys is not None else None
    )
    if sources is None:
        # Default lineup for the manual /jobs/signal-ingest sweep:
        # arXiv + USPTO + the three crawl4ai news adapters. NewsAPI was
        # dropped from the default in the grounded-research overhaul —
        # crawl4ai over Yahoo/Naver/Finviz covers the news surface
        # without needing an API key. Each adapter self-skips when its
        # prerequisites are missing (USPTO env, crawl4ai package, etc.).
        sources = [
            ArxivSource(),
            UsptoSource(),
            Crawl4aiYahooSource(),
            Crawl4aiFinvizSource(),
            Crawl4aiNaverSource(),
        ]
    if agent_url is None:
        agent_url = os.environ.get("AGENT_ORCHESTRATION_URL", _DEFAULT_AGENT_URL)

    stats = IngestStats(started_at=datetime.now(UTC))
    since = datetime.now(UTC) - timedelta(days=lookback_days)

    async with httpx.AsyncClient() as client:
        for slug in sector_slugs:
            keywords_by_cap = _load_keywords(slug)
            if not keywords_by_cap:
                log.info("signal_ingest: %s has no keywords file — skipping", slug)
                continue
            capabilities = await repo.list_vision_capabilities(slug)
            actors = await repo.list_vision_actors(slug)
            cap_by_key = {c.key: c for c in capabilities}
            stats.visions_processed += 1

            for cap_key, keywords in keywords_by_cap.items():
                if capability_filter is not None and cap_key not in capability_filter:
                    continue
                cap = cap_by_key.get(cap_key)
                if cap is None:
                    log.info(
                        "signal_ingest: %s/%s — capability not seeded, skipping",
                        slug,
                        cap_key,
                    )
                    continue
                stats.capabilities_processed += 1

                for source in sources:
                    raw_signals = await source.fetch(
                        sector_slug=slug,
                        capability_key=cap_key,
                        keywords=keywords,
                        since=since,
                        max_results=per_capability_limit,
                    )
                    stats.raw_signals_fetched += len(raw_signals)

                    for raw in raw_signals:
                        scoring = None
                        if not skip_extractor:
                            stats.extractor_calls += 1
                            body = await _score_signal(
                                agent_url=agent_url,
                                raw=raw,
                                capability_name=cap.name,
                                capability_description=cap.description,
                                capability_rationale=cap.rationale,
                                actors=actors,
                                client=client,
                            )
                            if body is None:
                                stats.extractor_failures += 1
                                # Still write the raw signal so re-runs
                                # don't infinitely retry — the score
                                # updater (M40) can re-score later.
                                scoring = None
                            else:
                                scoring = body.get("scoring") or {}
                                stats.extractor_total_cost_usd += float(
                                    body.get("cost_usd", 0.0)
                                )

                        # Resolve actor_key → actor_id via the actors
                        # loaded for this vision.
                        actor_id: str | None = None
                        if scoring and scoring.get("matched_actor_key"):
                            for a in actors:
                                if a.key == scoring["matched_actor_key"]:
                                    actor_id = a.id
                                    break

                        await repo.upsert_signal(
                            SignalInsert(
                                sector_slug=raw.sector_slug,
                                capability_id=cap.id,
                                actor_id=actor_id,
                                source_kind=raw.source_kind,
                                source_url=raw.source_url,
                                source_id_ext=raw.source_id_ext,
                                title=raw.title,
                                summary=raw.summary,
                                published_at=raw.published_at,
                                delta_technical=(scoring or {}).get(
                                    "delta_technical"
                                ),
                                delta_economic=(scoring or {}).get("delta_economic"),
                                delta_regulatory=(scoring or {}).get(
                                    "delta_regulatory"
                                ),
                                delta_supply=(scoring or {}).get("delta_supply"),
                                is_highlight=bool(
                                    (scoring or {}).get("is_highlight", False)
                                ),
                            )
                        )
                        stats.signals_written += 1

    stats.finished_at = datetime.now(UTC)
    log.info(
        "signal_ingest: visions=%d caps=%d raw=%d wrote=%d extractor=%d (failed=%d) cost=$%.4f",
        stats.visions_processed,
        stats.capabilities_processed,
        stats.raw_signals_fetched,
        stats.signals_written,
        stats.extractor_calls,
        stats.extractor_failures,
        stats.extractor_total_cost_usd,
    )
    return stats
