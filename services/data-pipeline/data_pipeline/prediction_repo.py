"""Prediction-resolver repository (M33b).

Sibling to `repo.py` (EquityRepository) — keeps the new prediction
write path isolated from the equity refresh path. Same Protocol + InMemory
+ Postgres impls so tests can substitute the in-memory backing.

Surface:
- `list_due_predictions(cutoff, limit)` — unresolved predictions with
  `target_date <= cutoff`, in chronological order so resolution preserves
  streak semantics.
- `latest_close_on_or_before(equity_id, on_date)` — pulls from
  `equity_quotes`. None when no data has landed yet (skip + retry next run).
- `write_prediction_resolution(...)` — atomic txn: insert PredictionResult,
  flip `predictions.resolved`, increment UserScore, append audit_log.
  Idempotent — re-running on an already-resolved prediction is a no-op.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Protocol


def _naive_utc(dt: datetime) -> datetime:
    """asyncpg → Postgres TIMESTAMP (no TZ) refuses tz-aware datetimes.
    Mirrors the helper in `repo.py`."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class DuePrediction:
    """Minimal projection of `predictions` for the resolver path."""

    id: str
    user_id: str
    equity_id: str
    horizon: str
    predicted_pct: float
    anchor_close: float
    target_date: datetime
    sector_slug: str


@dataclass(frozen=True)
class ResolutionPayload:
    """Inputs to `write_prediction_resolution`. Kept as a dataclass so the
    Postgres impl's signature stays manageable as the txn grows."""

    prediction_id: str
    user_id: str
    sector_slug: str | None
    actual_close: float
    actual_pct: float
    abs_error: float
    score: float
    hit: bool
    resolved_at: datetime


class PredictionResolverRepository(Protocol):
    async def list_due_predictions(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePrediction]: ...

    async def latest_close_on_or_before(
        self, equity_id: str, *, on_date: date
    ) -> float | None: ...

    async def write_prediction_resolution(
        self, payload: ResolutionPayload
    ) -> bool:
        """Returns True if a NEW resolution was written, False if the
        prediction was already resolved (idempotent no-op)."""
        ...

    async def close(self) -> None: ...


# ---- In-memory --------------------------------------------------------


@dataclass
class _ScoreState:
    """Fields we mutate on the in-memory UserScore. Mirrors the schema."""

    total_points: float = 0.0
    predictions_resolved: int = 0
    hits: int = 0
    hit_rate_pct: float = 0.0
    current_streak: int = 0
    best_streak: int = 0


class InMemoryPredictionResolverRepository:
    """Test backing. Construct with a list of seed DuePrediction rows +
    a dict of equity_id → list of (trade_date, close_local) bars."""

    def __init__(
        self,
        predictions: list[DuePrediction] | None = None,
        history: dict[str, list[tuple[date, float]]] | None = None,
    ) -> None:
        self._predictions: dict[str, DuePrediction] = {
            p.id: p for p in (predictions or [])
        }
        self._history: dict[str, list[tuple[date, float]]] = history or {}
        # Track resolved prediction IDs so re-runs are no-ops.
        self._resolved: set[str] = set()
        # Captured for assertions.
        self.results: list[ResolutionPayload] = []
        self.audit: list[dict[str, Any]] = []
        self.scores: dict[str, _ScoreState] = {}

    async def list_due_predictions(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePrediction]:
        due = [
            p
            for p in self._predictions.values()
            if p.id not in self._resolved and p.target_date <= cutoff
        ]
        due.sort(key=lambda p: (p.user_id, p.target_date, p.id))
        return due[:limit]

    async def latest_close_on_or_before(
        self, equity_id: str, *, on_date: date
    ) -> float | None:
        bars = self._history.get(equity_id) or []
        candidates = [b for b in bars if b[0] <= on_date]
        if not candidates:
            return None
        candidates.sort(key=lambda b: b[0], reverse=True)
        return candidates[0][1]

    async def write_prediction_resolution(
        self, payload: ResolutionPayload
    ) -> bool:
        if payload.prediction_id in self._resolved:
            return False
        self._resolved.add(payload.prediction_id)
        self.results.append(payload)

        state = self.scores.setdefault(payload.user_id, _ScoreState())
        state.total_points += payload.score
        state.predictions_resolved += 1
        if payload.hit:
            state.hits += 1
            state.current_streak += 1
            state.best_streak = max(state.best_streak, state.current_streak)
        else:
            state.current_streak = 0
        state.hit_rate_pct = (
            state.hits * 100.0 / state.predictions_resolved
            if state.predictions_resolved
            else 0.0
        )

        self.audit.append(
            {
                "action": "prediction.resolve",
                "sector_slug": payload.sector_slug,
                "prediction_id": payload.prediction_id,
                "user_id": payload.user_id,
                "score": payload.score,
                "hit": payload.hit,
                "resolved_at": payload.resolved_at,
            }
        )
        return True

    async def close(self) -> None:
        return None


# ---- Postgres (asyncpg) -----------------------------------------------


_LIST_DUE_SQL = """
SELECT
    p.id,
    p.user_id,
    p.equity_id,
    p.horizon,
    p.predicted_pct,
    p.anchor_close,
    p.target_date,
    eq.sector_slug AS sector_slug
FROM predictions p
JOIN sector_equities eq ON eq.id = p.equity_id
WHERE p.resolved = false AND p.target_date <= $1
ORDER BY p.user_id ASC, p.target_date ASC, p.id ASC
LIMIT $2
"""

_LATEST_CLOSE_SQL = """
SELECT close_local
FROM equity_quotes
WHERE equity_id = $1 AND trade_date <= $2
ORDER BY trade_date DESC
LIMIT 1
"""

# Resolution txn. Uses a single CTE chain so the whole write is one
# round-trip. Each step is idempotent on its own:
#   1. INSERT prediction_results — ON CONFLICT (prediction_id) DO NOTHING
#   2. UPDATE predictions.resolved=true — gated by `WHERE resolved=false`
#   3. UPSERT user_scores — only if step (2) actually flipped a row
#
# The `flipped` CTE returns the user_id IFF the UPDATE actually touched
# a row; the user_score upsert is wrapped in `WHERE EXISTS` so a re-run
# on an already-resolved prediction doesn't double-credit.
_WRITE_RESOLUTION_SQL = """
WITH inserted AS (
    INSERT INTO prediction_results
        (id, prediction_id, actual_close, actual_pct, abs_error, score, resolved_at)
    VALUES (
        substr(md5(random()::text || clock_timestamp()::text), 1, 25),
        $1, $2, $3, $4, $5, $6
    )
    ON CONFLICT (prediction_id) DO NOTHING
    RETURNING id
),
flipped AS (
    UPDATE predictions
       SET resolved = true
     WHERE id = $1 AND resolved = false
    RETURNING user_id
),
score_upsert AS (
    INSERT INTO user_scores AS us
        (user_id, total_points, predictions_made, predictions_resolved,
         hits, hit_rate_pct, current_streak, best_streak, updated_at)
    SELECT
        $7,                           -- user_id
        $5,                           -- total_points (= score)
        0,                            -- predictions_made (handled at create)
        1,                            -- predictions_resolved
        CASE WHEN $8 THEN 1 ELSE 0 END,                -- hits
        CASE WHEN $8 THEN 100.0 ELSE 0.0 END,          -- hit_rate_pct
        CASE WHEN $8 THEN 1 ELSE 0 END,                -- current_streak
        CASE WHEN $8 THEN 1 ELSE 0 END,                -- best_streak
        now()
    WHERE EXISTS (SELECT 1 FROM flipped)
    ON CONFLICT (user_id) DO UPDATE
       SET total_points         = us.total_points + EXCLUDED.total_points,
           predictions_resolved = us.predictions_resolved + 1,
           hits                 = us.hits + CASE WHEN $8 THEN 1 ELSE 0 END,
           hit_rate_pct         = (us.hits + CASE WHEN $8 THEN 1 ELSE 0 END) * 100.0
                                  / (us.predictions_resolved + 1),
           current_streak       = CASE WHEN $8 THEN us.current_streak + 1 ELSE 0 END,
           best_streak          = GREATEST(
                                    us.best_streak,
                                    CASE WHEN $8 THEN us.current_streak + 1 ELSE us.best_streak END
                                  ),
           updated_at           = now()
    RETURNING us.user_id
),
audited AS (
    INSERT INTO audit_logs (id, action, sector_slug, payload, author_label, created_at)
    SELECT
        substr(md5(random()::text || clock_timestamp()::text), 1, 25),
        'prediction.resolve',
        $9,
        jsonb_build_object(
          'prediction_id', $1,
          'score', $5,
          'hit', $8,
          'actual_pct', $3,
          'abs_error', $4
        ),
        'cron',
        now()
    WHERE EXISTS (SELECT 1 FROM flipped)
    RETURNING id
)
SELECT EXISTS (SELECT 1 FROM flipped) AS wrote;
"""


class PostgresPredictionResolverRepository:
    def __init__(self, pool: Any) -> None:  # asyncpg.Pool
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> PostgresPredictionResolverRepository:
        import asyncpg

        pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=3)
        return cls(pool)

    async def list_due_predictions(
        self, cutoff: datetime, *, limit: int = 500
    ) -> list[DuePrediction]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(_LIST_DUE_SQL, _naive_utc(cutoff), limit)
        return [
            DuePrediction(
                id=r["id"],
                user_id=r["user_id"],
                equity_id=r["equity_id"],
                horizon=r["horizon"],
                predicted_pct=float(r["predicted_pct"]),
                anchor_close=float(r["anchor_close"]),
                target_date=r["target_date"],
                sector_slug=r["sector_slug"],
            )
            for r in rows
        ]

    async def latest_close_on_or_before(
        self, equity_id: str, *, on_date: date
    ) -> float | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_LATEST_CLOSE_SQL, equity_id, on_date)
        if row is None:
            return None
        return float(row["close_local"])

    async def write_prediction_resolution(
        self, payload: ResolutionPayload
    ) -> bool:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    _WRITE_RESOLUTION_SQL,
                    payload.prediction_id,           # $1
                    payload.actual_close,            # $2
                    payload.actual_pct,              # $3
                    payload.abs_error,               # $4
                    payload.score,                   # $5
                    _naive_utc(payload.resolved_at), # $6
                    payload.user_id,                 # $7
                    payload.hit,                     # $8
                    payload.sector_slug,             # $9
                )
        return bool(row and row["wrote"])

    async def close(self) -> None:
        await self._pool.close()


# ---- Factory ----------------------------------------------------------


async def build_resolver_repository(
    database_url: str | None,
) -> PredictionResolverRepository:
    if not database_url:
        raise RuntimeError(
            "data-pipeline prediction resolver requires DATABASE_URL "
            "(no in-memory fallback — needs the predictions + equity_quotes tables)."
        )
    return await PostgresPredictionResolverRepository.connect(database_url)
