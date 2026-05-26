"""Read surface for the discovery loop (M50).

EntityDetector needs three queries:
  1. Recent untagged signals for a vision (last N days, actor_id IS
     NULL) — these are the candidates for new-org extraction.
  2. Known actor names (across all visions) — for the fuzzy-diff
     check so we don't propose actors we already track.
  3. Open bot-authored proposals already targeting a candidate name
     — so a second discovery tick doesn't re-propose the same name.

All read-only. Writes flow through ProposalDrafter / asyncpg.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import asyncpg


@dataclass(frozen=True, slots=True)
class RecentSignalRow:
    id: str
    sector_slug: str
    title: str
    summary: str | None
    source_url: str
    published_at: datetime


@dataclass(frozen=True, slots=True)
class KnownActorRow:
    actor_key: str
    name: str
    short_name: str | None


class DiscoveryReader(Protocol):
    """Injectable for tests."""

    async def list_recent_untagged_signals(
        self, *, sector_slug: str, since: datetime
    ) -> list[RecentSignalRow]: ...

    async def list_known_actor_names(self) -> list[KnownActorRow]: ...

    async def bot_proposal_exists_for(
        self,
        *,
        bot_user_id: str,
        sector_slug: str,
        target_kind: str,
        target_ref: str,
    ) -> bool: ...


class PostgresDiscoveryReader:
    """asyncpg-backed reader sharing the crawler's pool."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_recent_untagged_signals(
        self, *, sector_slug: str, since: datetime
    ) -> list[RecentSignalRow]:
        rows = await self._pool.fetch(
            """
            SELECT id, sector_slug, title,
                   COALESCE(summary, '') AS summary,
                   source_url, published_at
            FROM signals
            WHERE sector_slug = $1
              AND actor_id IS NULL
              AND published_at >= $2
            ORDER BY published_at DESC
            LIMIT 500
            """,
            sector_slug,
            since,
        )
        return [
            RecentSignalRow(
                id=r["id"],
                sector_slug=r["sector_slug"],
                title=r["title"],
                summary=r["summary"] or None,
                source_url=r["source_url"],
                published_at=r["published_at"],
            )
            for r in rows
        ]

    async def list_known_actor_names(self) -> list[KnownActorRow]:
        # Pull all actors (global, not per-vision) — fuzzy-match against
        # every known name to catch e.g., SpaceX-mentioned-in-fusion.
        rows = await self._pool.fetch(
            """
            SELECT key AS actor_key, name, short_name
            FROM actors
            ORDER BY name ASC
            """
        )
        return [
            KnownActorRow(
                actor_key=r["actor_key"],
                name=r["name"],
                short_name=r["short_name"],
            )
            for r in rows
        ]

    async def bot_proposal_exists_for(
        self,
        *,
        bot_user_id: str,
        sector_slug: str,
        target_kind: str,
        target_ref: str,
    ) -> bool:
        row = await self._pool.fetchrow(
            """
            SELECT 1
            FROM community_proposals
            WHERE author_id = $1
              AND sector_slug = $2
              AND target_kind = $3
              AND target_ref = $4
              AND status IN ('open', 'review')
            LIMIT 1
            """,
            bot_user_id,
            sector_slug,
            target_kind,
            target_ref,
        )
        return row is not None
