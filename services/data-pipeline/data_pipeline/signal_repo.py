"""Repository for the signals table — asyncpg-backed inserts/queries.

Decoupled from the equity repo because (a) the signals domain is
post-pivot and we don't want legacy schema dragged in, (b) the call
shape is simpler (single-table writes, no FX/bulk logic).

Used by data_pipeline.jobs.signal_ingest.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

# VisionTickers lives in data_pipeline.signals.tickers so the crawl4ai
# news adapters (which need it for URL construction) and this repo
# (which produces it from the actors table) reference the same shape.
from data_pipeline.signals.tickers import VisionTickers


@dataclass(frozen=True, slots=True)
class CapabilityHandle:
    """Info the cron needs to address a capability — id (for FK) + slug
    + key (for adapter args) + name/description/rationale (for extractor
    prompt context). Loaded once at ingest start."""

    id: str
    sector_slug: str
    key: str
    name: str
    description: str
    rationale: str


@dataclass(frozen=True, slots=True)
class ActorHandle:
    """Actor lookup row for extractor's actor_key → actor_id resolution
    + signal_keywords for the keyword-set context the extractor agent
    receives."""

    id: str
    key: str
    name: str
    short_name: str | None
    aliases: list[str]


@dataclass(frozen=True, slots=True)
class SignalInsert:
    """One row to write to signals. Maps the RawSignal + extractor
    output into the DB shape. delta_* + is_highlight + actor_id are
    populated post-extractor; on initial write all are nullable."""

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


@dataclass(frozen=True, slots=True)
class CurrentCapabilityScore:
    """Current 4-dim score for one capability — read by recompute_
    feasibility before calling the ScoreUpdater agent."""

    capability_id: str
    capability_key: str
    technical: float | None
    economic: float | None
    regulatory: float | None
    supply: float | None


@dataclass(frozen=True, slots=True)
class RecentSignalForScoring:
    """Signal in scoring window — fed to ScoreUpdater agent."""

    title: str
    summary: str | None
    source_kind: str
    published_at: datetime
    delta_technical: float | None
    delta_economic: float | None
    delta_regulatory: float | None
    delta_supply: float | None
    actor_short_name: str | None


@dataclass(frozen=True, slots=True)
class CapabilityScoreWrite:
    """New CapabilityScore row to insert (after demoting prior current)."""

    capability_id: str
    technical: float | None
    economic: float | None
    regulatory: float | None
    supply: float | None
    composite: float | None
    composite_p10: float | None
    composite_p90: float | None
    rationale: str | None


class SignalRepository(Protocol):
    """Surface the ingest + recompute jobs need. Production = Postgres;
    tests use InMemorySignalRepository so they don't need a live DB."""

    async def list_vision_capabilities(
        self, sector_slug: str
    ) -> list[CapabilityHandle]: ...

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]: ...

    async def list_vision_tickers(
        self, sector_slug: str
    ) -> VisionTickers: ...

    async def upsert_signal(self, signal: SignalInsert) -> str: ...

    # M40b — recompute support
    async def get_current_capability_score(
        self, capability_id: str
    ) -> CurrentCapabilityScore | None: ...

    async def list_recent_signals_for_capability(
        self, capability_id: str, *, since: datetime, limit: int = 50
    ) -> list[RecentSignalForScoring]: ...

    async def write_capability_score(self, score: CapabilityScoreWrite) -> str: ...

    async def close(self) -> None: ...


class InMemorySignalRepository:
    """Test-only in-memory store."""

    def __init__(
        self,
        *,
        capabilities: dict[str, list[CapabilityHandle]] | None = None,
        actors: dict[str, list[ActorHandle]] | None = None,
        current_scores: dict[str, CurrentCapabilityScore] | None = None,
        recent_signals: dict[str, list[RecentSignalForScoring]] | None = None,
    ) -> None:
        self._capabilities = capabilities or {}
        self._actors = actors or {}
        self._signals: dict[tuple[str, str], str] = {}
        self._next_id = 1
        self._current_scores = current_scores or {}
        self._recent_signals_by_cap = recent_signals or {}
        self._capability_score_writes: list[CapabilityScoreWrite] = []

    async def list_vision_capabilities(
        self, sector_slug: str
    ) -> list[CapabilityHandle]:
        return self._capabilities.get(sector_slug, [])

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]:
        return self._actors.get(sector_slug, [])

    async def list_vision_tickers(self, sector_slug: str) -> VisionTickers:
        # InMemory shim — tests that exercise the crawl4ai source
        # inject a ticker provider directly, so this is rarely hit.
        # Return empty tuples by default; tests can preset
        # `self._tickers[sector_slug] = VisionTickers(...)` to
        # override.
        return getattr(self, "_tickers", {}).get(
            sector_slug, VisionTickers(us=(), kr=())
        )

    async def upsert_signal(self, signal: SignalInsert) -> str:
        key = (signal.source_url, signal.capability_id)
        existing = self._signals.get(key)
        if existing is not None:
            return existing
        sid = f"sig_{self._next_id}"
        self._next_id += 1
        self._signals[key] = sid
        return sid

    async def get_current_capability_score(
        self, capability_id: str
    ) -> CurrentCapabilityScore | None:
        return self._current_scores.get(capability_id)

    async def list_recent_signals_for_capability(
        self, capability_id: str, *, since: datetime, limit: int = 50
    ) -> list[RecentSignalForScoring]:
        return [
            s
            for s in self._recent_signals_by_cap.get(capability_id, [])
            if s.published_at >= since
        ][:limit]

    async def write_capability_score(self, score: CapabilityScoreWrite) -> str:
        self._capability_score_writes.append(score)
        sid = f"cs_{len(self._capability_score_writes)}"
        # Update current_scores in place so subsequent reads see the latest.
        self._current_scores[score.capability_id] = CurrentCapabilityScore(
            capability_id=score.capability_id,
            capability_key=self._current_scores.get(
                score.capability_id,
                CurrentCapabilityScore(score.capability_id, "", None, None, None, None),
            ).capability_key,
            technical=score.technical,
            economic=score.economic,
            regulatory=score.regulatory,
            supply=score.supply,
        )
        return sid

    async def close(self) -> None:
        pass


_LIST_CAPS_SQL = """
SELECT id, sector_slug, key, name, description, rationale
FROM capabilities
WHERE sector_slug = $1
ORDER BY display_order ASC
"""

_LIST_ACTORS_SQL = """
SELECT a.id, a.key, a.name, a.short_name, a.signal_keywords
FROM actors a
JOIN vision_actors va ON va.actor_id = a.id
WHERE va.sector_slug = $1
ORDER BY va.relevance DESC NULLS LAST, va.display_order ASC
LIMIT 25
"""

# Ticker list for the crawl4ai news adapters. Pulls every actor in
# the vision that has a ticker; the source code partitions US vs KR
# by iso_country (most reliable signal — exchange field is sparse).
_LIST_VISION_TICKERS_SQL = """
SELECT a.ticker, a.iso_country
FROM actors a
JOIN vision_actors va ON va.actor_id = a.id
WHERE va.sector_slug = $1 AND a.ticker IS NOT NULL AND a.ticker <> ''
ORDER BY va.relevance DESC NULLS LAST, va.display_order ASC
LIMIT 50
"""

_GET_CURRENT_CAP_SCORE_SQL = """
SELECT c.key AS capability_key,
       cs.technical, cs.economic, cs.regulatory, cs.supply
FROM capabilities c
LEFT JOIN capability_scores cs
  ON cs.capability_id = c.id AND cs.is_current = TRUE
WHERE c.id = $1
"""

_LIST_RECENT_SIGNALS_FOR_CAP_SQL = """
SELECT s.title, s.summary, s.source_kind, s.published_at,
       s.delta_technical, s.delta_economic, s.delta_regulatory, s.delta_supply,
       a.short_name AS actor_short_name
FROM signals s
LEFT JOIN actors a ON a.id = s.actor_id
WHERE s.capability_id = $1 AND s.published_at >= $2
ORDER BY s.published_at DESC
LIMIT $3
"""

_WRITE_CAP_SCORE_SQL = """
WITH demote AS (
  UPDATE capability_scores
  SET is_current = FALSE
  WHERE capability_id = $1 AND is_current = TRUE
)
INSERT INTO capability_scores (
  id, capability_id,
  technical, economic, regulatory, supply,
  composite, composite_p10, composite_p90,
  as_of, is_current, rationale, created_at
)
VALUES (
  gen_random_uuid()::text, $1,
  $2, $3, $4, $5,
  $6, $7, $8,
  NOW(), TRUE, $9, NOW()
)
RETURNING id
"""

_UPSERT_SIGNAL_SQL = """
INSERT INTO signals (
  id, sector_slug, capability_id, actor_id, source_kind, source_url,
  source_id_ext, title, summary, published_at,
  delta_technical, delta_economic, delta_regulatory, delta_supply,
  is_highlight, ingested_at
)
VALUES (
  gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, $11, $12, $13, $14, NOW()
)
ON CONFLICT (source_url, capability_id) DO UPDATE SET
  actor_id = COALESCE(EXCLUDED.actor_id, signals.actor_id),
  delta_technical = COALESCE(EXCLUDED.delta_technical, signals.delta_technical),
  delta_economic = COALESCE(EXCLUDED.delta_economic, signals.delta_economic),
  delta_regulatory = COALESCE(EXCLUDED.delta_regulatory, signals.delta_regulatory),
  delta_supply = COALESCE(EXCLUDED.delta_supply, signals.delta_supply),
  is_highlight = signals.is_highlight OR EXCLUDED.is_highlight,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary
RETURNING id
"""


class PostgresSignalRepository:
    """asyncpg implementation. `cuid` would be ideal for the new id but
    asyncpg can't run JS cuid; we use gen_random_uuid()::text — Prisma
    accepts any unique string as cuid in raw SQL paths."""

    def __init__(self, pool: Any) -> None:  # asyncpg.Pool
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> PostgresSignalRepository:
        import asyncpg

        pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5)
        return cls(pool)

    async def list_vision_capabilities(
        self, sector_slug: str
    ) -> list[CapabilityHandle]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_CAPS_SQL, sector_slug)
        return [
            CapabilityHandle(
                id=r["id"],
                sector_slug=r["sector_slug"],
                key=r["key"],
                name=r["name"],
                description=r["description"],
                rationale=r["rationale"],
            )
            for r in rows
        ]

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_ACTORS_SQL, sector_slug)
        return [
            ActorHandle(
                id=r["id"],
                key=r["key"],
                name=r["name"],
                short_name=r["short_name"],
                aliases=list(r["signal_keywords"] or []),
            )
            for r in rows
        ]

    async def list_vision_tickers(self, sector_slug: str) -> VisionTickers:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_VISION_TICKERS_SQL, sector_slug)
        us: list[str] = []
        kr: list[str] = []
        for r in rows:
            raw = (r["ticker"] or "").strip()
            if not raw:
                continue
            country = (r["iso_country"] or "").upper()
            if country == "KR":
                # Naver URLs take the bare 6-digit code — strip any
                # exchange suffix Yahoo/yfinance leaves behind
                # (".KS"/".KQ").
                bare = raw.split(".", 1)[0]
                if bare:
                    kr.append(bare)
            else:
                us.append(raw)
        return VisionTickers(us=tuple(us), kr=tuple(kr))

    async def upsert_signal(self, signal: SignalInsert) -> str:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                _UPSERT_SIGNAL_SQL,
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
            )
        assert row is not None
        return row["id"]

    async def get_current_capability_score(
        self, capability_id: str
    ) -> CurrentCapabilityScore | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_GET_CURRENT_CAP_SCORE_SQL, capability_id)
        if row is None:
            return None
        return CurrentCapabilityScore(
            capability_id=capability_id,
            capability_key=row["capability_key"],
            technical=row["technical"],
            economic=row["economic"],
            regulatory=row["regulatory"],
            supply=row["supply"],
        )

    async def list_recent_signals_for_capability(
        self, capability_id: str, *, since: datetime, limit: int = 50
    ) -> list[RecentSignalForScoring]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                _LIST_RECENT_SIGNALS_FOR_CAP_SQL,
                capability_id,
                since.replace(tzinfo=None) if since.tzinfo else since,
                limit,
            )
        return [
            RecentSignalForScoring(
                title=r["title"],
                summary=r["summary"],
                source_kind=r["source_kind"],
                published_at=r["published_at"],
                delta_technical=r["delta_technical"],
                delta_economic=r["delta_economic"],
                delta_regulatory=r["delta_regulatory"],
                delta_supply=r["delta_supply"],
                actor_short_name=r["actor_short_name"],
            )
            for r in rows
        ]

    async def write_capability_score(self, score: CapabilityScoreWrite) -> str:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    _WRITE_CAP_SCORE_SQL,
                    score.capability_id,
                    score.technical,
                    score.economic,
                    score.regulatory,
                    score.supply,
                    score.composite,
                    score.composite_p10,
                    score.composite_p90,
                    score.rationale,
                )
        assert row is not None
        return row["id"]

    async def close(self) -> None:
        await self._pool.close()
