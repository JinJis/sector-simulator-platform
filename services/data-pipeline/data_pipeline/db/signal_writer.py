"""Narrow Signal upsert for crawler fetchers.

The data-pipeline service already owns the full ingest pipeline (M39:
arXiv / USPTO / NewsAPI keyword sweep). Crawler fetchers emit
*synthesized* signals from Deep Research briefs and per-actor / per-
risk research; the upsert shape is identical, so we just write to the
same `signals` table via a narrow asyncpg surface here.

Idempotency: `(source_url, capability_id)` is the table-level unique
constraint. The crawler uses `internal://crawler/...` pseudo-URLs as
source_url so multiple runs on the same day collapse to one row
(`ON CONFLICT DO UPDATE` refreshes scoring + summary).
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

import asyncpg


@dataclass(frozen=True, slots=True)
class SignalCitation:
    """One source URL retrieved by the grounded_search tool. Persisted
    as part of the Signal row's `citations` JSON array."""

    url: str
    title: str


def _new_signal_id() -> str:
    """Same cuid-shape helper as crawler/repo.py — avoids relying on
    Postgres pgcrypto being enabled (not default on every install)."""
    return f"sg_{secrets.token_hex(12)}"


@dataclass(frozen=True, slots=True)
class SignalUpsert:
    """One signal to upsert. Mirrors `signals` table columns; deltas
    nullable so the fetcher can write the row first and the extractor
    backfill in the same path."""

    sector_slug: str
    capability_id: str
    actor_id: str | None
    source_kind: str
    source_url: str
    source_id_ext: str | None
    title: str
    summary: str | None
    published_at: datetime
    delta_technical: float | None
    delta_economic: float | None
    delta_regulatory: float | None
    delta_supply: float | None
    is_highlight: bool
    # Grounded-search citations (digest fetcher populates these; other
    # adapters leave them empty since their `source_url` IS the
    # primary reference). Persisted as JSONB; empty tuple → NULL.
    citations: tuple[SignalCitation, ...] = field(default_factory=tuple)


class SignalWriter(Protocol):
    async def upsert(self, signal: SignalUpsert) -> str:
        """Return signal id (existing or newly-created)."""
        ...


class PostgresSignalWriter:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def upsert(self, signal: SignalUpsert) -> str:
        citations_json: str | None = (
            json.dumps([{"url": c.url, "title": c.title} for c in signal.citations])
            if signal.citations
            else None
        )
        row = await self._pool.fetchrow(
            """
            INSERT INTO signals (
                id, sector_slug, capability_id, actor_id, source_kind,
                source_url, source_id_ext, title, summary, published_at,
                delta_technical, delta_economic, delta_regulatory, delta_supply,
                is_highlight, citations
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16::jsonb
            )
            ON CONFLICT (source_url, capability_id) DO UPDATE
            SET actor_id        = EXCLUDED.actor_id,
                source_kind     = EXCLUDED.source_kind,
                source_id_ext   = EXCLUDED.source_id_ext,
                title           = EXCLUDED.title,
                summary         = EXCLUDED.summary,
                published_at    = EXCLUDED.published_at,
                delta_technical = EXCLUDED.delta_technical,
                delta_economic  = EXCLUDED.delta_economic,
                delta_regulatory= EXCLUDED.delta_regulatory,
                delta_supply    = EXCLUDED.delta_supply,
                is_highlight    = EXCLUDED.is_highlight,
                -- Citations: only overwrite when the new write has
                -- some (don't clobber a digest's citations with a
                -- subsequent extractor backfill that has none).
                citations       = COALESCE(EXCLUDED.citations, signals.citations)
            RETURNING id
            """,
            _new_signal_id(),
            signal.sector_slug,
            signal.capability_id,
            signal.actor_id,
            signal.source_kind,
            signal.source_url,
            signal.source_id_ext,
            signal.title,
            signal.summary,
            signal.published_at,
            signal.delta_technical,
            signal.delta_economic,
            signal.delta_regulatory,
            signal.delta_supply,
            signal.is_highlight,
            citations_json,
        )
        assert row is not None
        return row["id"]
