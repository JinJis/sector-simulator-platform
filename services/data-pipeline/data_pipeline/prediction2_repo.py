"""M46b — PredictionV2 resolver repository.

Sibling to `prediction_repo.py` but for the new `predictions_v2` table
(band-based predictions with auto-assigned tiers — see
`services/sector-service/src/lib/prediction-tier.ts` for the TS source
of truth).

Surface mirrors the legacy resolver shape:
- `list_due_predictions_v2(cutoff, limit)` — `status='open'` rows whose
  `resolves_at <= cutoff`.
- `latest_close_on_or_after(equity_id, on_date)` — next available
  EquityQuote close on or AFTER `resolves_at` (note: legacy resolver
  uses on-or-BEFORE; v2 uses on-or-AFTER because the band is fixed in
  advance and we want the first observed close after the resolution
  deadline, not the last quote we've seen).
- `write_prediction2_resolution(...)` — atomic txn: write
  `actual_price + score + reward_points + status='resolved' +
  resolved_at`, plus an audit_log row. Idempotent on
  `predictions_v2.status='open'`.

The score+reward formula is replicated here as pure functions so the
job is testable without a DB.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Literal, Protocol

# ----- Scoring (mirrors prediction-tier.ts) -----------------------------

Tier = Literal["easy", "medium", "hard"]

_TIER_MULTIPLIER: dict[Tier, float] = {"easy": 1.0, "medium": 2.5, "hard": 5.0}


def score_prediction_v2(
    *,
    actual: float,
    band_min: float,
    band_max: float,
) -> float:
    """Linear-decay band score in [0, 1]. 1.0 inside the band; 0 at
    distance >= one spread outside. Matches the TS `scorePrediction`."""
    if band_max < band_min:
        return 0.0
    if band_min <= actual <= band_max:
        return 1.0
    spread = band_max - band_min
    if spread <= 0:
        return 0.0
    distance = band_min - actual if actual < band_min else actual - band_max
    if distance >= spread:
        return 0.0
    return max(0.0, 1.0 - distance / spread)


def reward_points_v2(score: float, tier: str) -> int:
    """round(score × tier_mult × 10). Caller passes the persisted tier
    string; we coerce defensively (unknown tier → 0 points)."""
    mult = _TIER_MULTIPLIER.get(tier)  # type: ignore[arg-type]
    if mult is None:
        return 0
    return round(score * mult * 10)


# ----- Repo --------------------------------------------------------------


def _naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class DuePredictionV2:
    """Projection of `predictions_v2` for the resolver path."""

    id: str
    user_id: str
    equity_id: str
    sector_slug: str
    horizon: str
    tier: str
    expected_price_min: float
    expected_price_max: float
    anchor_price: float
    anchor_date: datetime
    resolves_at: datetime


@dataclass(frozen=True)
class ResolutionV2Payload:
    prediction_id: str
    user_id: str
    sector_slug: str | None
    actual_price: float
    score: float
    reward_points: int
    resolved_at: datetime


class PredictionV2ResolverRepository(Protocol):
    async def list_due_predictions_v2(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePredictionV2]: ...

    async def latest_close_on_or_after(
        self, equity_id: str, *, on_date: date
    ) -> float | None: ...

    async def write_prediction2_resolution(
        self, payload: ResolutionV2Payload
    ) -> bool: ...

    async def close(self) -> None: ...


# ----- In-memory (tests) ------------------------------------------------


class InMemoryPredictionV2ResolverRepository:
    """Test backing. Construct with seed `DuePredictionV2` rows + a
    history dict `equity_id → list[(trade_date, close)]`."""

    def __init__(
        self,
        predictions: list[DuePredictionV2] | None = None,
        history: dict[str, list[tuple[date, float]]] | None = None,
    ) -> None:
        self._predictions: dict[str, DuePredictionV2] = {
            p.id: p for p in (predictions or [])
        }
        self._history: dict[str, list[tuple[date, float]]] = history or {}
        self._resolved: set[str] = set()
        # Captured for assertions
        self.results: list[ResolutionV2Payload] = []
        self.audit: list[dict[str, Any]] = []

    async def list_due_predictions_v2(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePredictionV2]:
        due = [
            p
            for p in self._predictions.values()
            if p.id not in self._resolved and p.resolves_at <= cutoff
        ]
        due.sort(key=lambda p: (p.user_id, p.resolves_at, p.id))
        return due[:limit]

    async def latest_close_on_or_after(
        self, equity_id: str, *, on_date: date
    ) -> float | None:
        bars = self._history.get(equity_id) or []
        candidates = [b for b in bars if b[0] >= on_date]
        if not candidates:
            return None
        candidates.sort(key=lambda b: b[0])
        return candidates[0][1]

    async def write_prediction2_resolution(
        self, payload: ResolutionV2Payload
    ) -> bool:
        if payload.prediction_id in self._resolved:
            return False
        self._resolved.add(payload.prediction_id)
        self.results.append(payload)
        self.audit.append(
            {
                "action": "prediction2.resolve",
                "sector_slug": payload.sector_slug,
                "prediction_id": payload.prediction_id,
                "user_id": payload.user_id,
                "score": payload.score,
                "reward_points": payload.reward_points,
                "resolved_at": payload.resolved_at,
            }
        )
        return True

    async def close(self) -> None:
        return None


# ----- Postgres (asyncpg) -----------------------------------------------


_LIST_DUE_SQL = """
SELECT
    p.id,
    p.user_id,
    p.equity_id,
    eq.sector_slug AS sector_slug,
    p.horizon,
    p.tier,
    p.expected_price_min,
    p.expected_price_max,
    p.anchor_price,
    p.anchor_date,
    p.resolves_at
FROM predictions_v2 p
JOIN sector_equities eq ON eq.id = p.equity_id
WHERE p.status = 'open' AND p.resolves_at <= $1
ORDER BY p.user_id ASC, p.resolves_at ASC, p.id ASC
LIMIT $2
"""

_LATEST_CLOSE_SQL = """
SELECT close_local
FROM equity_quotes
WHERE equity_id = $1 AND trade_date >= $2
ORDER BY trade_date ASC
LIMIT 1
"""

# Atomic resolution:
#   1. UPDATE predictions_v2  — gated by status='open' so re-runs no-op
#   2. INSERT audit_logs row  — only when the UPDATE actually flipped
#   3. INSERT point_events row — ledger entry, gated on flipped
#   4. UPSERT user_reputation — increment total_points by reward_points
#      and recompute tier (CASE chain matches the TS tierFromPoints).
# Steps 3+4 only fire when reward_points > 0 — a miss (0p) shouldn't
# emit a no-op event nor recompute the tier.
_WRITE_RESOLUTION_SQL = """
WITH flipped AS (
    UPDATE predictions_v2
       SET status        = 'resolved',
           resolved_at   = $7,
           actual_price  = $2,
           score         = $3,
           reward_points = $4,
           updated_at    = now()
     WHERE id = $1 AND status = 'open'
    RETURNING user_id
),
audited AS (
    INSERT INTO audit_logs (id, action, sector_slug, payload, author_label, created_at)
    SELECT
        substr(md5(random()::text || clock_timestamp()::text), 1, 25),
        'prediction2.resolve',
        $6,
        jsonb_build_object(
          'prediction_id', $1,
          'actual_price', $2,
          'score', $3,
          'reward_points', $4,
          'user_id', $5
        ),
        'cron',
        now()
    WHERE EXISTS (SELECT 1 FROM flipped)
    RETURNING id
),
point_event_row AS (
    INSERT INTO point_events
        (id, user_id, kind, amount, refers_to_kind, refers_to_id, created_at)
    SELECT
        substr(md5(random()::text || clock_timestamp()::text), 1, 25),
        $5,
        'prediction_resolved',
        $4,
        'prediction',
        $1,
        now()
    WHERE EXISTS (SELECT 1 FROM flipped) AND $4 > 0
    RETURNING id
),
rep_upsert AS (
    INSERT INTO user_reputation AS ur
        (user_id, total_points, tier, updated_at)
    SELECT
        $5,
        $4,
        CASE
            WHEN $4 >= 10000 THEN 'maintainer'
            WHEN $4 >= 3000  THEN 'senior'
            WHEN $4 >= 500   THEN 'analyst'
            WHEN $4 >= 100   THEN 'member'
            ELSE                  'newcomer'
        END,
        now()
    WHERE EXISTS (SELECT 1 FROM flipped) AND $4 > 0
    ON CONFLICT (user_id) DO UPDATE
       SET total_points = ur.total_points + EXCLUDED.total_points,
           tier         = CASE
               WHEN ur.total_points + EXCLUDED.total_points >= 10000 THEN 'maintainer'
               WHEN ur.total_points + EXCLUDED.total_points >=  3000 THEN 'senior'
               WHEN ur.total_points + EXCLUDED.total_points >=   500 THEN 'analyst'
               WHEN ur.total_points + EXCLUDED.total_points >=   100 THEN 'member'
               ELSE                                                       'newcomer'
           END,
           updated_at   = now()
    RETURNING user_id
)
SELECT EXISTS (SELECT 1 FROM flipped) AS wrote;
"""


class PostgresPredictionV2ResolverRepository:
    def __init__(self, pool: Any) -> None:  # asyncpg.Pool
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> "PostgresPredictionV2ResolverRepository":
        import asyncpg

        pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=3)
        return cls(pool)

    async def list_due_predictions_v2(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePredictionV2]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_DUE_SQL, _naive_utc(cutoff), limit)
        return [
            DuePredictionV2(
                id=r["id"],
                user_id=r["user_id"],
                equity_id=r["equity_id"],
                sector_slug=r["sector_slug"],
                horizon=r["horizon"],
                tier=r["tier"],
                expected_price_min=float(r["expected_price_min"]),
                expected_price_max=float(r["expected_price_max"]),
                anchor_price=float(r["anchor_price"]),
                anchor_date=r["anchor_date"],
                resolves_at=r["resolves_at"],
            )
            for r in rows
        ]

    async def latest_close_on_or_after(
        self, equity_id: str, *, on_date: date
    ) -> float | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_LATEST_CLOSE_SQL, equity_id, on_date)
        if row is None:
            return None
        return float(row["close_local"])

    async def write_prediction2_resolution(
        self, payload: ResolutionV2Payload
    ) -> bool:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                _WRITE_RESOLUTION_SQL,
                payload.prediction_id,
                payload.actual_price,
                payload.score,
                payload.reward_points,
                payload.user_id,
                payload.sector_slug,
                _naive_utc(payload.resolved_at),
            )
        return bool(row and row["wrote"])

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()


# ----- Factory ----------------------------------------------------------


async def build_resolver_v2_repository(
    database_url: str | None,
) -> PredictionV2ResolverRepository:
    if not database_url:
        raise RuntimeError(
            "data-pipeline prediction-v2 resolver requires DATABASE_URL "
            "(no in-memory fallback — needs predictions_v2 + equity_quotes)."
        )
    return await PostgresPredictionV2ResolverRepository.connect(database_url)


__all__ = [
    "DuePredictionV2",
    "InMemoryPredictionV2ResolverRepository",
    "PostgresPredictionV2ResolverRepository",
    "PredictionV2ResolverRepository",
    "ResolutionV2Payload",
    "build_resolver_v2_repository",
    "reward_points_v2",
    "score_prediction_v2",
]
