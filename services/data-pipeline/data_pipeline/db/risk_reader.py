"""Read-only risk lookup for RiskFetcher (M49d).

RiskFetcher needs three things per run:
1. The risk's canonical (name, description, severity, likelihood,
   category, mitigations) — for the Deep Research prompt context.
2. The optional source attribution fields (source_url/kind/title)
   from MP4 — surfaced on the resulting CrawlRun summary so the
   admin cockpit can show what the curated source was.
3. A primary `Capability` to anchor the resulting Signal against —
   `signals.capability_id` is part of the dedup key. We pick the
   first capability in `affected_capability_keys` that actually
   exists in the `capabilities` table for the vision. If none
   resolve, the fetcher rejects the run (a risk that touches zero
   tracked capabilities has nothing to score against).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import asyncpg

from data_pipeline.db.capability_reader import CapabilityRecord


@dataclass(frozen=True, slots=True)
class RiskRecord:
    id: str
    key: str
    sector_slug: str
    name: str
    description: str
    category: str
    severity: str
    likelihood: str
    time_horizon: str
    mitigations: str | None
    affected_capability_keys: list[str]
    source_url: str | None
    source_kind: str | None
    source_title: str | None
    primary_capability: CapabilityRecord | None


class RiskReader(Protocol):
    """Injectable for tests."""

    async def get(self, *, sector_slug: str, risk_key: str) -> RiskRecord | None: ...


class PostgresRiskReader:
    """asyncpg-backed reader sharing the same pool as the crawler's
    main repo."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get(self, *, sector_slug: str, risk_key: str) -> RiskRecord | None:
        risk_row = await self._pool.fetchrow(
            """
            SELECT id, key, name, description, category, severity, likelihood,
                   time_horizon, mitigations,
                   COALESCE(affected_capability_keys, ARRAY[]::text[])
                     AS affected_capability_keys,
                   source_url, source_kind, source_title
            FROM risks
            WHERE sector_slug = $1 AND key = $2
            LIMIT 1
            """,
            sector_slug,
            risk_key,
        )
        if risk_row is None:
            return None

        affected_keys = list(risk_row["affected_capability_keys"] or [])
        # Pick the first affected_capability_keys[] entry that actually
        # exists. The risks table stores capability keys as a Postgres
        # text[] without a FK, so a stale key list won't trip a JOIN —
        # we just have to validate here.
        primary_capability: CapabilityRecord | None = None
        if affected_keys:
            cap_row = await self._pool.fetchrow(
                """
                SELECT id, sector_slug, key, name,
                       COALESCE(description, '') AS description,
                       COALESCE(rationale, '')   AS rationale
                FROM capabilities
                WHERE sector_slug = $1 AND key = ANY($2::text[])
                ORDER BY array_position($2::text[], key) ASC,
                         display_order ASC
                LIMIT 1
                """,
                sector_slug,
                affected_keys,
            )
            if cap_row is not None:
                primary_capability = CapabilityRecord(
                    id=cap_row["id"],
                    sector_slug=cap_row["sector_slug"],
                    key=cap_row["key"],
                    name=cap_row["name"],
                    description=cap_row["description"],
                    rationale=cap_row["rationale"],
                )

        return RiskRecord(
            id=risk_row["id"],
            key=risk_row["key"],
            sector_slug=sector_slug,
            name=risk_row["name"],
            description=risk_row["description"],
            category=risk_row["category"],
            severity=risk_row["severity"],
            likelihood=risk_row["likelihood"],
            time_horizon=risk_row["time_horizon"],
            mitigations=risk_row["mitigations"],
            affected_capability_keys=affected_keys,
            source_url=risk_row["source_url"],
            source_kind=risk_row["source_kind"],
            source_title=risk_row["source_title"],
            primary_capability=primary_capability,
        )
