"""Repository for the signals table — asyncpg-backed inserts/queries.

Decoupled from the equity repo because (a) the signals domain is
post-pivot and we don't want legacy schema dragged in, (b) the call
shape is simpler (single-table writes, no FX/bulk logic).

Used by data_pipeline.jobs.signal_ingest.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol


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


class SignalRepository(Protocol):
    """Surface the ingest job needs. Production = Postgres; tests use
    InMemorySignalRepository so they don't need a live DB."""

    async def list_vision_capabilities(
        self, sector_slug: str
    ) -> list[CapabilityHandle]: ...

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]: ...

    async def upsert_signal(self, signal: SignalInsert) -> str:
        """Idempotent on (source_url, capability_id). Returns the
        signal id (new or existing)."""
        ...

    async def close(self) -> None: ...


class InMemorySignalRepository:
    """Test-only in-memory store. Tracks upserts by (source_url,
    capability_id) so re-runs are idempotent."""

    def __init__(
        self,
        *,
        capabilities: dict[str, list[CapabilityHandle]] | None = None,
        actors: dict[str, list[ActorHandle]] | None = None,
    ) -> None:
        self._capabilities = capabilities or {}
        self._actors = actors or {}
        self._signals: dict[tuple[str, str], str] = {}  # (source_url, cap_id) → id
        self._next_id = 1

    async def list_vision_capabilities(
        self, sector_slug: str
    ) -> list[CapabilityHandle]:
        return self._capabilities.get(sector_slug, [])

    async def list_vision_actors(self, sector_slug: str) -> list[ActorHandle]:
        return self._actors.get(sector_slug, [])

    async def upsert_signal(self, signal: SignalInsert) -> str:
        key = (signal.source_url, signal.capability_id)
        existing = self._signals.get(key)
        if existing is not None:
            return existing
        sid = f"sig_{self._next_id}"
        self._next_id += 1
        self._signals[key] = sid
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

    async def close(self) -> None:
        await self._pool.close()
