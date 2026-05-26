"""Read-only actor lookup for ActorFetcher (M49b).

ActorFetcher needs three things for one run:
1. The actor's canonical (name, signal_keywords) — to build the Deep
   Research prompt and feed the SignalExtractor's actor-matching set.
2. Confirmation the actor is bound to this vision (VisionActor row) —
   we refuse to refresh actors that don't belong to the vision.
3. A "primary" Capability to anchor the resulting Signal against —
   `signals.capability_id` is the dedup key (paired with `source_url`),
   so the row needs *some* capability. We pick the actor's top
   CapabilityActor binding by role priority (lead > supplier > customer
   > competitor > regulator), tiebroken by `capabilities.display_order`.

If no CapabilityActor binding exists, `primary_capability` is None and
the fetcher rejects the run — a vision actor that touches zero
capabilities has nothing to score against.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import asyncpg

from data_pipeline.db.capability_reader import CapabilityRecord


@dataclass(frozen=True, slots=True)
class ActorRecord:
    id: str
    key: str
    sector_slug: str
    name: str
    signal_keywords: list[str]
    primary_capability: CapabilityRecord | None


class ActorReader(Protocol):
    """Injectable for tests."""

    async def get(self, *, sector_slug: str, actor_key: str) -> ActorRecord | None: ...


class PostgresActorReader:
    """asyncpg-backed reader sharing the same pool as the crawler's
    main repo."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get(self, *, sector_slug: str, actor_key: str) -> ActorRecord | None:
        actor_row = await self._pool.fetchrow(
            """
            SELECT a.id,
                   a.key,
                   a.name,
                   COALESCE(a.signal_keywords, ARRAY[]::text[]) AS signal_keywords
            FROM actors a
            JOIN vision_actors va
              ON va.actor_id = a.id
            WHERE a.key = $1 AND va.sector_slug = $2
            LIMIT 1
            """,
            actor_key,
            sector_slug,
        )
        if actor_row is None:
            return None

        # Pick the actor's top CapabilityActor binding within this
        # vision. Role priority matches the order in the schema comment.
        cap_row = await self._pool.fetchrow(
            """
            SELECT c.id, c.sector_slug, c.key, c.name,
                   COALESCE(c.description, '') AS description,
                   COALESCE(c.rationale, '')   AS rationale
            FROM capability_actors ca
            JOIN capabilities c ON c.id = ca.capability_id
            WHERE ca.actor_id = $1 AND c.sector_slug = $2
            ORDER BY
              CASE ca.role
                WHEN 'lead'       THEN 1
                WHEN 'supplier'   THEN 2
                WHEN 'customer'   THEN 3
                WHEN 'competitor' THEN 4
                WHEN 'regulator'  THEN 5
                ELSE 6
              END,
              c.display_order ASC
            LIMIT 1
            """,
            actor_row["id"],
            sector_slug,
        )
        primary_capability: CapabilityRecord | None
        if cap_row is None:
            primary_capability = None
        else:
            primary_capability = CapabilityRecord(
                id=cap_row["id"],
                sector_slug=cap_row["sector_slug"],
                key=cap_row["key"],
                name=cap_row["name"],
                description=cap_row["description"],
                rationale=cap_row["rationale"],
            )

        return ActorRecord(
            id=actor_row["id"],
            key=actor_row["key"],
            sector_slug=sector_slug,
            name=actor_row["name"],
            signal_keywords=list(actor_row["signal_keywords"] or []),
            primary_capability=primary_capability,
        )
