"""Repo helper unit tests — specifically the tz-stripping that keeps
asyncpg happy with Postgres TIMESTAMP columns (Prisma's DateTime
default — see the longer note in repo.py)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from data_pipeline.repo import _naive_utc


class TestNaiveUtcHelper:
    def test_strips_tzinfo_from_aware(self) -> None:
        aware = datetime(2026, 5, 21, 3, 14, 53, tzinfo=UTC)
        naive = _naive_utc(aware)
        assert naive.tzinfo is None
        assert naive == datetime(2026, 5, 21, 3, 14, 53)

    def test_converts_non_utc_to_utc_naive(self) -> None:
        # KST = UTC+9 — 12:14:53 KST = 03:14:53 UTC.
        kst = timezone(timedelta(hours=9))
        aware = datetime(2026, 5, 21, 12, 14, 53, tzinfo=kst)
        naive = _naive_utc(aware)
        assert naive.tzinfo is None
        assert naive == datetime(2026, 5, 21, 3, 14, 53)

    def test_passes_naive_through_unchanged(self) -> None:
        naive_in = datetime(2026, 5, 21, 3, 14, 53)
        assert _naive_utc(naive_in) is naive_in
