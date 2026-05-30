"""Tests for the runtime job-config store + the llm_client resolver
hook that consumes it."""

from __future__ import annotations

import os
from unittest import mock

import pytest

from agent_tools import (
    EnvSeedKey,
    InMemoryJobConfigStore,
    JobConfigEntry,
    available_models,
    coerce_typed,
    parse_bool,
    parse_int,
    seed_from_env,
    set_model_resolver,
)


# ---- coerce_typed -------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("on", True), ("off", False),
        ("1", True), ("0", False),
        ("true", True), ("false", False),
        ("yes", True), ("no", False),
        ("ON", True), ("Off", False),
        ("", False),
    ],
)
def test_parse_bool_canonical_and_loose(value: str, expected: bool) -> None:
    assert parse_bool(value) is expected


def test_parse_bool_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="not in on/off"):
        parse_bool("maybe")


def test_parse_int_strips_whitespace() -> None:
    assert parse_int("  42 ") == 42


def test_coerce_typed_dispatches_on_kind() -> None:
    """cron / string / string_enum round-trip; int/bool/interval_min
    parse to typed values."""
    assert coerce_typed("30 8 * * *", "cron") == "30 8 * * *"
    assert coerce_typed("yfinance", "string") == "yfinance"
    assert coerce_typed("yfinance", "string_enum") == "yfinance"
    assert coerce_typed("7", "int") == 7
    assert coerce_typed("0.5", "interval_min") == 0.5
    assert coerce_typed("on", "bool") is True
    assert coerce_typed("off", "schedule_toggle") is False


# ---- InMemoryJobConfigStore ---------------------------------------------


@pytest.mark.asyncio
async def test_inmemory_get_returns_default_when_absent() -> None:
    store = InMemoryJobConfigStore()
    assert await store.get("MISSING", default="fallback") == "fallback"
    assert await store.get("MISSING") is None


@pytest.mark.asyncio
async def test_inmemory_upsert_then_get_round_trip() -> None:
    store = InMemoryJobConfigStore()
    await store.upsert(
        key="NEWS_INGEST_INTERVAL_MIN",
        value="1",
        kind="interval_min",
        group="news_ingest",
        description="minutes between sweeps",
        updated_by="alice@example.com",
    )
    assert await store.get("NEWS_INGEST_INTERVAL_MIN") == "1"
    assert await store.get_typed("NEWS_INGEST_INTERVAL_MIN", kind="interval_min") == 1.0


@pytest.mark.asyncio
async def test_inmemory_get_typed_uses_row_kind_when_omitted() -> None:
    """When the call site doesn't pin a kind, the store falls back to
    the kind recorded on the row — `parse_bool` for a bool row, etc."""
    store = InMemoryJobConfigStore(
        initial={
            "DIGEST_SCHEDULE": JobConfigEntry(
                key="DIGEST_SCHEDULE",
                value="on",
                kind="schedule_toggle",
                group="digest",
                description=None,
                updated_by=None,
            )
        }
    )
    assert await store.get_typed("DIGEST_SCHEDULE") is True


@pytest.mark.asyncio
async def test_inmemory_list_all_sorts_by_group_then_key() -> None:
    store = InMemoryJobConfigStore()
    await store.upsert(
        key="X_KEY", value="x", kind="string", group="b_group",
    )
    await store.upsert(
        key="A_KEY", value="a", kind="string", group="a_group",
    )
    await store.upsert(
        key="B_KEY", value="b", kind="string", group="a_group",
    )
    rows = await store.list_all()
    assert [r.key for r in rows] == ["A_KEY", "B_KEY", "X_KEY"]


# ---- seed_from_env -------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_from_env_writes_only_when_env_set() -> None:
    store = InMemoryJobConfigStore()
    keys = [
        EnvSeedKey(key="SEEDED_PRESENT", kind="string", group="g"),
        EnvSeedKey(key="SEEDED_ABSENT", kind="string", group="g"),
    ]
    with mock.patch.dict(
        os.environ, {"SEEDED_PRESENT": "hello"}, clear=False,
    ):
        os.environ.pop("SEEDED_ABSENT", None)
        written = await seed_from_env(store, keys)
    assert written == 1
    assert await store.get("SEEDED_PRESENT") == "hello"
    assert await store.get("SEEDED_ABSENT") is None


@pytest.mark.asyncio
async def test_seed_from_env_uses_default_when_env_unset() -> None:
    """`default_when_unset` lets the seed populate sensible defaults
    for the operator's first boot when their .env doesn't override."""
    store = InMemoryJobConfigStore()
    keys = [
        EnvSeedKey(
            key="ONLY_DEFAULT",
            kind="cron",
            group="g",
            default_when_unset="*/5 * * * *",
        ),
    ]
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("ONLY_DEFAULT", None)
        written = await seed_from_env(store, keys)
    assert written == 1
    assert await store.get("ONLY_DEFAULT") == "*/5 * * * *"


@pytest.mark.asyncio
async def test_seed_from_env_preserves_existing_admin_edits() -> None:
    """An admin edit (now in DB) must not be clobbered by a container
    restart re-running the seed."""
    store = InMemoryJobConfigStore()
    await store.upsert(
        key="MANUAL_EDIT",
        value="admin-picked",
        kind="string",
        group="g",
        updated_by="admin@example.com",
    )
    keys = [EnvSeedKey(key="MANUAL_EDIT", kind="string", group="g")]
    with mock.patch.dict(os.environ, {"MANUAL_EDIT": "env-value"}, clear=False):
        written = await seed_from_env(store, keys)
    assert written == 0
    assert await store.get("MANUAL_EDIT") == "admin-picked"


@pytest.mark.asyncio
async def test_seed_from_env_overwrite_forces_reset() -> None:
    """`overwrite=True` is the operator's "reset to env" hatch — used
    by a hypothetical reset button in the admin."""
    store = InMemoryJobConfigStore()
    await store.upsert(
        key="MANUAL_EDIT", value="old", kind="string", group="g",
    )
    keys = [EnvSeedKey(key="MANUAL_EDIT", kind="string", group="g")]
    with mock.patch.dict(os.environ, {"MANUAL_EDIT": "new"}, clear=False):
        written = await seed_from_env(store, keys, overwrite=True)
    assert written == 1
    assert await store.get("MANUAL_EDIT") == "new"


# ---- llm_client resolver hook -------------------------------------------


def test_set_model_resolver_overrides_env() -> None:
    """When a resolver is set, its return value wins over both env and
    built-in default."""
    with mock.patch.dict(
        os.environ, {"LLM_FAST_MODEL": "env-model"}, clear=False,
    ):
        try:
            set_model_resolver(lambda tier: "resolver-model" if tier == "fast" else None)
            models = available_models()
            assert models["fast"] == "resolver-model"
            # Other tiers fall through to env / default unchanged.
            assert models["deep"] == "gemini-3.1-pro-preview"
        finally:
            set_model_resolver(None)


def test_set_model_resolver_returning_none_falls_through_to_env() -> None:
    """A resolver that returns None for a tier MUST fall through to the
    env var (and then default). Lets the resolver be selective without
    knowing every tier's correct value."""
    with mock.patch.dict(
        os.environ, {"LLM_DEEP_MODEL": "env-deep"}, clear=False,
    ):
        try:
            set_model_resolver(lambda _tier: None)
            models = available_models()
            assert models["deep"] == "env-deep"
        finally:
            set_model_resolver(None)


def test_set_model_resolver_none_clears_hook() -> None:
    """Passing None to `set_model_resolver` resets to env-only behavior
    — needed so test isolation works (one test's resolver doesn't leak
    into the next)."""
    set_model_resolver(lambda _tier: "from-resolver")
    set_model_resolver(None)
    with mock.patch.dict(os.environ, {}, clear=False):
        for k in ("LLM_FAST_MODEL", "LLM_BALANCED_MODEL", "LLM_DEEP_MODEL"):
            os.environ.pop(k, None)
        models = available_models()
        assert models["fast"] == "gemini-3.1-flash-lite"  # built-in default
