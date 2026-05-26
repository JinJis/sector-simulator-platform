"""Read-only capability lookup. CapabilityFetcher (M49a) needs the
canonical (name, description, rationale) tuple to build the Deep
Research prompt + the SignalExtractor context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import asyncpg


@dataclass(frozen=True, slots=True)
class CapabilityRecord:
    id: str
    sector_slug: str
    key: str
    name: str
    description: str
    rationale: str


class CapabilityReader(Protocol):
    """Injectable for tests."""

    async def get(
        self, *, sector_slug: str, capability_key: str
    ) -> CapabilityRecord | None: ...


class PostgresCapabilityReader:
    """asyncpg-backed reader sharing the same pool as the crawler's
    main repo."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get(
        self, *, sector_slug: str, capability_key: str
    ) -> CapabilityRecord | None:
        row = await self._pool.fetchrow(
            """
            SELECT id, sector_slug, key, name,
                   COALESCE(description, '') AS description,
                   COALESCE(rationale, '')   AS rationale
            FROM capabilities
            WHERE sector_slug = $1 AND key = $2
            LIMIT 1
            """,
            sector_slug,
            capability_key,
        )
        if row is None:
            return None
        return CapabilityRecord(
            id=row["id"],
            sector_slug=row["sector_slug"],
            key=row["key"],
            name=row["name"],
            description=row["description"],
            rationale=row["rationale"],
        )
