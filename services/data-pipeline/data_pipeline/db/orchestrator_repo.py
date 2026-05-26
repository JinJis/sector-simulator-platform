"""Read-only orchestrator queries (M49f).

The orchestrator builds candidate lists from `capabilities`, `actors`
(via vision_actors), and `risks` per vision; ranks them with
composition.md §4's formula using:

  - composite capability score (for W_binding — bottom-half caps first)
  - last successful CrawlRun.ended_at for that (vision, fetcher_kind,
    key) (for W_stale)
  - sum of CrawlRun.cost_usd in the last 24h per vision (for the
    daily $/vision budget cap)

All read-only. No writes (the dispatcher invokes the existing
per-fetcher writers).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import asyncpg


@dataclass(frozen=True, slots=True)
class CapabilityCandidate:
    vision_slug: str
    capability_key: str
    composite_score: float | None  # null when no CapabilityScore row yet


@dataclass(frozen=True, slots=True)
class ActorCandidate:
    vision_slug: str
    actor_key: str
    # Top binding capability's composite for the actor's primary
    # CapabilityActor row; null when actor isn't bound to any
    # capability yet (such actors are filtered out by the fetcher).
    anchor_composite_score: float | None


@dataclass(frozen=True, slots=True)
class RiskCandidate:
    vision_slug: str
    risk_key: str
    # Anchor capability composite (first resolvable
    # affected_capability_key in the risk).
    anchor_composite_score: float | None


@dataclass(frozen=True, slots=True)
class CrawlRunStats:
    last_ended_at: datetime | None
    cost_usd_last_24h: float


class OrchestratorReader(Protocol):
    """Injectable for tests."""

    async def list_vision_slugs(self) -> list[str]: ...

    async def list_capability_candidates(
        self, *, vision_slug: str
    ) -> list[CapabilityCandidate]: ...

    async def list_actor_candidates(self, *, vision_slug: str) -> list[ActorCandidate]: ...

    async def list_risk_candidates(self, *, vision_slug: str) -> list[RiskCandidate]: ...

    async def last_run_ended_at(
        self, *, vision_slug: str, fetcher_kind: str, key: str
    ) -> datetime | None: ...

    async def daily_cost_usd_since(self, *, vision_slug: str, since: datetime) -> float: ...


class PostgresOrchestratorReader:
    """asyncpg-backed reader sharing the same pool as the crawler's
    main repo."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_vision_slugs(self) -> list[str]:
        rows = await self._pool.fetch(
            """
            SELECT slug FROM sectors
            WHERE is_vision_eligible = true
            ORDER BY slug ASC
            """
        )
        return [r["slug"] for r in rows]

    async def list_capability_candidates(self, *, vision_slug: str) -> list[CapabilityCandidate]:
        rows = await self._pool.fetch(
            """
            SELECT c.key,
                   (SELECT cs.composite
                    FROM capability_scores cs
                    WHERE cs.capability_id = c.id AND cs.is_current = true
                    LIMIT 1) AS composite
            FROM capabilities c
            WHERE c.sector_slug = $1
            ORDER BY c.display_order ASC
            """,
            vision_slug,
        )
        return [
            CapabilityCandidate(
                vision_slug=vision_slug,
                capability_key=r["key"],
                composite_score=(float(r["composite"]) if r["composite"] is not None else None),
            )
            for r in rows
        ]

    async def list_actor_candidates(self, *, vision_slug: str) -> list[ActorCandidate]:
        # For each actor bound to the vision, take the composite score
        # of the actor's first CapabilityActor binding (role priority
        # mirrors PostgresActorReader: lead > supplier > customer >
        # competitor > regulator, then display_order).
        rows = await self._pool.fetch(
            """
            SELECT a.key,
                   (
                     SELECT cs.composite
                     FROM capability_actors ca
                     JOIN capabilities c ON c.id = ca.capability_id
                     LEFT JOIN capability_scores cs
                       ON cs.capability_id = c.id AND cs.is_current = true
                     WHERE ca.actor_id = a.id AND c.sector_slug = $1
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
                   ) AS composite
            FROM actors a
            JOIN vision_actors va ON va.actor_id = a.id
            WHERE va.sector_slug = $1
            ORDER BY va.relevance DESC NULLS LAST, va.display_order ASC
            """,
            vision_slug,
        )
        return [
            ActorCandidate(
                vision_slug=vision_slug,
                actor_key=r["key"],
                anchor_composite_score=(
                    float(r["composite"]) if r["composite"] is not None else None
                ),
            )
            for r in rows
        ]

    async def list_risk_candidates(self, *, vision_slug: str) -> list[RiskCandidate]:
        rows = await self._pool.fetch(
            """
            SELECT r.key,
                   (
                     SELECT cs.composite
                     FROM capabilities c
                     LEFT JOIN capability_scores cs
                       ON cs.capability_id = c.id AND cs.is_current = true
                     WHERE c.sector_slug = $1
                       AND c.key = ANY(r.affected_capability_keys)
                     ORDER BY
                       array_position(r.affected_capability_keys, c.key) ASC,
                       c.display_order ASC
                     LIMIT 1
                   ) AS composite
            FROM risks r
            WHERE r.sector_slug = $1
            ORDER BY r.display_order ASC
            """,
            vision_slug,
        )
        return [
            RiskCandidate(
                vision_slug=vision_slug,
                risk_key=r["key"],
                anchor_composite_score=(
                    float(r["composite"]) if r["composite"] is not None else None
                ),
            )
            for r in rows
        ]

    async def last_run_ended_at(
        self, *, vision_slug: str, fetcher_kind: str, key: str
    ) -> datetime | None:
        # `key` lives inside the CrawlRun.plan JSONB; the per-fetcher
        # plan shape uses {capability_key|actor_key|risk_key}. Match
        # by checking any of those keys for portability.
        row = await self._pool.fetchrow(
            """
            SELECT ended_at
            FROM crawl_runs
            WHERE vision_slug = $1
              AND fetcher_kind = $2
              AND status = 'ok'
              AND (
                plan->>'capability_key' = $3
                OR plan->>'actor_key'   = $3
                OR plan->>'risk_key'    = $3
              )
              AND ended_at IS NOT NULL
            ORDER BY ended_at DESC
            LIMIT 1
            """,
            vision_slug,
            fetcher_kind,
            key,
        )
        return row["ended_at"] if row is not None else None

    async def daily_cost_usd_since(self, *, vision_slug: str, since: datetime) -> float:
        row = await self._pool.fetchrow(
            """
            SELECT COALESCE(SUM(cost_usd), 0) AS total
            FROM crawl_runs
            WHERE vision_slug = $1
              AND ended_at IS NOT NULL
              AND ended_at >= $2
            """,
            vision_slug,
            since,
        )
        if row is None:
            return 0.0
        total = row["total"]
        return float(total) if total is not None else 0.0
