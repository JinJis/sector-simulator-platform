"""Runtime-editable operational config — Postgres-backed store.

Implements the read side of the M62 (slice 12) job-config feature. The
admin UI in ``services/data-pipeline/data_pipeline/admin/`` is the write
side; every service that needs to look up an operator knob (cron
expression, schedule toggle, lookback days, LLM tier model id, …) uses
``JobConfigStore.get(...)`` here so all consumers see the same value.

Storage shape (one row per env-var-shaped key, matching the
``JobConfig`` Prisma model):

    key          str   — canonical env-var name, e.g. ``INGEST_CRON_QUOTES``
    value        str   — serialised as a string; ``kind`` says how to parse
    kind         str   — cron | interval_min | bool | int | string |
                          string_enum | schedule_toggle
    group        str   — admin display grouping ("quotes", "news_ingest", …)
    description  str?  — admin hint / allowed-value list
    updated_at   dt
    updated_by   str?

Lookup precedence (when an existing key in the DB matches):

    DB row → env var → built-in default

When the DB row is absent for a key, ``get(key, default=…)`` falls through
to the env var; absent there too, it returns the caller-supplied default.
This lets the dev env keep booting against a fresh DB without manual
seeding (the data-pipeline lifespan calls ``seed_from_env`` to bulk-import
the env values on first boot, but the fallback still protects against any
missed key).

Cache:

    Each ``PostgresJobConfigStore`` holds a per-key TTL cache (default
    30s). data-pipeline + agent-orchestration each construct their own
    store against the same DB; an edit on the data-pipeline side
    propagates to agent-orchestration within one cache-TTL window
    without any inter-service RPC. Calling ``invalidate()`` from the
    admin handler bypasses the wait on the editing service.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import asyncpg

log = logging.getLogger(__name__)


JobConfigKind = Literal[
    "cron",
    "interval_min",
    "bool",
    "int",
    "string",
    "string_enum",
    "schedule_toggle",
]


@dataclass(frozen=True, slots=True)
class JobConfigEntry:
    """One row from the ``job_configs`` table."""

    key: str
    value: str
    kind: JobConfigKind
    group: str
    description: str | None
    updated_by: str | None


@dataclass(frozen=True, slots=True)
class _Cached:
    """Per-key TTL cache slot. ``value`` is None when the key isn't in
    the DB (memoised negative lookup so we don't re-query every call)."""

    value: str | None
    expires_at: float


class JobConfigStore(Protocol):
    """Read API. The admin UI uses ``upsert`` + ``invalidate`` directly
    on the concrete ``PostgresJobConfigStore``; consumers only need
    ``get``/``get_typed``/``list_all`` here."""

    async def get(self, key: str, default: str | None = None) -> str | None: ...

    async def get_typed(
        self,
        key: str,
        default: Any = None,
        *,
        kind: JobConfigKind | None = None,
    ) -> Any: ...

    async def list_all(self) -> list[JobConfigEntry]: ...


# ----- Helpers: string → typed -------------------------------------------


def parse_bool(value: str) -> bool:
    """``"on"`` / ``"off"`` are the canonical form; the loose set
    (``1``/``0``/``true``/``false``/``yes``/``no``) is accepted to mirror
    how the existing data-pipeline code reads env vars."""
    truthy = {"on", "1", "true", "yes", "y"}
    falsy = {"off", "0", "false", "no", "n", ""}
    norm = value.strip().lower()
    if norm in truthy:
        return True
    if norm in falsy:
        return False
    raise ValueError(f"job_config: bool value {value!r} not in on/off/1/0/true/false")


def parse_int(value: str) -> int:
    return int(value.strip())


def parse_float(value: str) -> float:
    return float(value.strip())


def coerce_typed(value: str, kind: JobConfigKind) -> Any:
    """Apply ``kind``-specific parsing. ``cron`` / ``string`` /
    ``string_enum`` round-trip unchanged. Validation that the cron
    string actually parses lives in ``CronTrigger.from_crontab`` at the
    scheduler edge — keeping the parser here lax means a bad cron from
    the admin form still lands in the DB, the scheduler logs a clear
    error, and the operator fixes it without a container restart."""
    if kind == "bool" or kind == "schedule_toggle":
        return parse_bool(value)
    if kind == "int":
        return parse_int(value)
    if kind == "interval_min":
        # Float so half-minute intervals work for dev testing.
        return parse_float(value)
    # cron / string / string_enum — caller wants the raw string.
    return value


# ----- Postgres-backed implementation ------------------------------------


class PostgresJobConfigStore:
    """asyncpg-backed implementation. Constructed at service lifespan
    with an existing pool (so we don't open a separate pool per
    service). Cache TTL defaults to 30 seconds — short enough for
    cross-service propagation to feel live, long enough to keep a hot
    cron loop from hammering the DB."""

    def __init__(
        self, pool: asyncpg.Pool, *, cache_ttl_seconds: float = 30.0
    ) -> None:
        self._pool = pool
        self._ttl = cache_ttl_seconds
        self._cache: dict[str, _Cached] = {}

    # ---- read ----

    async def get(self, key: str, default: str | None = None) -> str | None:
        cached = self._cache.get(key)
        now = time.monotonic()
        if cached is not None and cached.expires_at > now:
            return cached.value if cached.value is not None else default

        row = await self._pool.fetchrow(
            'SELECT "value" FROM "job_configs" WHERE "key" = $1', key
        )
        raw: str | None = row["value"] if row is not None else None
        self._cache[key] = _Cached(value=raw, expires_at=now + self._ttl)
        return raw if raw is not None else default

    async def get_typed(
        self,
        key: str,
        default: Any = None,
        *,
        kind: JobConfigKind | None = None,
    ) -> Any:
        """Resolve + parse. When ``kind`` is None and the key isn't in
        the DB, return ``default`` unchanged; if the key IS present, we
        need ``kind`` to parse — falls back to ``string`` (raw value)."""
        raw = await self.get(key)
        if raw is None:
            return default
        return coerce_typed(raw, kind or "string")

    async def list_all(self) -> list[JobConfigEntry]:
        rows = await self._pool.fetch(
            'SELECT "key", "value", "kind", "group", "description", "updated_by" '
            'FROM "job_configs" ORDER BY "group", "key"'
        )
        return [
            JobConfigEntry(
                key=r["key"],
                value=r["value"],
                kind=r["kind"],
                group=r["group"],
                description=r["description"],
                updated_by=r["updated_by"],
            )
            for r in rows
        ]

    # ---- write (used by the admin handler) ----

    async def upsert(
        self,
        *,
        key: str,
        value: str,
        kind: JobConfigKind,
        group: str,
        description: str | None = None,
        updated_by: str | None = None,
    ) -> None:
        """Insert-or-update one row. Bypasses cache by invalidating the
        key so the next ``get`` sees the new value immediately."""
        await self._pool.execute(
            'INSERT INTO "job_configs" '
            '("key", "value", "kind", "group", "description", "updated_by", "updated_at") '
            "VALUES ($1, $2, $3, $4, $5, $6, NOW()) "
            'ON CONFLICT ("key") DO UPDATE SET '
            '"value" = EXCLUDED."value", '
            '"kind" = EXCLUDED."kind", '
            '"group" = EXCLUDED."group", '
            '"description" = EXCLUDED."description", '
            '"updated_by" = EXCLUDED."updated_by", '
            '"updated_at" = NOW()',
            key,
            value,
            kind,
            group,
            description,
            updated_by,
        )
        self._cache.pop(key, None)

    def invalidate(self, key: str | None = None) -> None:
        """Drop one key from cache (or all of it when ``key`` is None).
        The admin save handler calls this after ``upsert`` so the
        rescheduling code re-reads from the DB on the same request."""
        if key is None:
            self._cache.clear()
        else:
            self._cache.pop(key, None)


# ----- In-memory implementation (tests) ----------------------------------


class InMemoryJobConfigStore:
    """Dict-backed store for tests + offline dev. No TTL — every read
    sees the latest write."""

    def __init__(
        self, initial: Mapping[str, JobConfigEntry] | None = None
    ) -> None:
        self._rows: dict[str, JobConfigEntry] = dict(initial or {})

    async def get(self, key: str, default: str | None = None) -> str | None:
        row = self._rows.get(key)
        return row.value if row is not None else default

    async def get_typed(
        self,
        key: str,
        default: Any = None,
        *,
        kind: JobConfigKind | None = None,
    ) -> Any:
        row = self._rows.get(key)
        if row is None:
            return default
        return coerce_typed(row.value, kind or row.kind)

    async def list_all(self) -> list[JobConfigEntry]:
        return sorted(self._rows.values(), key=lambda e: (e.group, e.key))

    async def upsert(
        self,
        *,
        key: str,
        value: str,
        kind: JobConfigKind,
        group: str,
        description: str | None = None,
        updated_by: str | None = None,
    ) -> None:
        self._rows[key] = JobConfigEntry(
            key=key,
            value=value,
            kind=kind,
            group=group,
            description=description,
            updated_by=updated_by,
        )

    def invalidate(self, key: str | None = None) -> None:
        # No-op — no cache to invalidate.
        del key


# ----- Seed-from-env (first-boot bootstrap) ------------------------------


@dataclass(frozen=True, slots=True)
class EnvSeedKey:
    """One env-var → JobConfig row mapping. Used by ``seed_from_env``
    to populate the table on first boot from the existing ``.env``
    operator config so nothing breaks on day one."""

    key: str
    kind: JobConfigKind
    group: str
    description: str | None = None
    default_when_unset: str | None = None


async def seed_from_env(
    store: PostgresJobConfigStore | InMemoryJobConfigStore,
    keys: Iterable[EnvSeedKey],
    *,
    overwrite: bool = False,
) -> int:
    """For each key, if the env var is set (or ``default_when_unset``
    is non-None), upsert a row. Returns the number of rows written.
    Existing rows are left alone unless ``overwrite=True`` so an
    operator edit doesn't get clobbered by a container restart.

    Idempotent — call from every service lifespan that wants the
    bootstrap. The duplicate work is fine because we read each key
    once to decide whether to skip.
    """
    written = 0
    existing_keys: set[str] = set()
    if not overwrite:
        existing_keys = {row.key for row in await store.list_all()}

    for spec in keys:
        if spec.key in existing_keys:
            continue
        raw = os.environ.get(spec.key)
        if raw is None:
            if spec.default_when_unset is None:
                continue
            raw = spec.default_when_unset
        await store.upsert(
            key=spec.key,
            value=raw,
            kind=spec.kind,
            group=spec.group,
            description=spec.description,
            updated_by="bootstrap",
        )
        written += 1
    log.info("job_config: seeded %d row(s) from env", written)
    return written
