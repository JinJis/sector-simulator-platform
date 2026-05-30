"""HTTP surface tests — TestClient hits the FastAPI app with both the
fake source and the in-memory repo pre-wired on app.state, so we exercise
the lifespan + endpoint plumbing without touching Postgres or yfinance."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from data_pipeline.adapters.base import Quote
from data_pipeline.adapters.fake import FakeSource
from data_pipeline.main import create_app
from data_pipeline.repo import EquityRecord, InMemoryEquityRepository


def _quote(symbol: str, currency: str, price: float) -> Quote:
    return Quote(
        symbol=symbol,
        last_close_local=price,
        currency=currency,
        last_close_date=datetime.now(UTC),
        market_cap_local=None,
    )


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    app.state.repo = InMemoryEquityRepository(
        [
            EquityRecord(
                id="e1",
                sector_slug="memory-semi",
                ticker="NVDA",
                exchange="NASDAQ",
                iso_country="US",
                currency="USD",
            )
        ]
    )
    app.state.source = FakeSource(
        quotes={"NVDA": _quote("NVDA", "USD", 130.0)},
        fx={"USD": 1.0},
    )
    # Disable the scheduler — the lifespan still runs, we just don't want
    # AsyncIOScheduler firing in the middle of tests.
    import os

    os.environ["INGEST_SCHEDULE"] = "off"

    with TestClient(app) as c:
        yield c


class TestHealth:
    def test_initial_health(self, client: TestClient) -> None:
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        # Slice 13: scheduler is always built at boot — every cron
        # registers, the JobConfig-backed enabled flag decides
        # whether it ticks. Even without DATABASE_URL the no-DB-
        # prereq cron (`refresh_quotes_daily`) still registers.
        assert body["scheduler_armed"] is True
        assert "refresh_quotes_daily" in body["next_runs"]
        # No run has happened yet.
        assert body["last_refresh"] is None


class TestRefreshEndpoints:
    def test_manual_trigger_runs_and_records(self, client: TestClient) -> None:
        r = client.post("/jobs/refresh-quotes")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["updated"] == 1
        assert body["missing"] == 0
        assert body["errors"] == 0

        # The same result should surface from /health and /last.
        h = client.get("/health").json()
        assert h["last_refresh"]["updated"] == 1

        last = client.get("/jobs/refresh-quotes/last").json()
        assert last["updated"] == 1

    def test_last_404_before_any_run(self, client: TestClient) -> None:
        # Fresh client fixture — no run has been triggered.
        r = client.get("/jobs/refresh-quotes/last")
        assert r.status_code == 404


class TestDegradedPaths:
    def test_missing_symbol_returns_200_with_count(self, client: TestClient) -> None:
        # Swap in a source that doesn't know NVDA.
        app: Any = client.app
        app.state.source = FakeSource(missing_symbols={"NVDA"}, fx={"USD": 1.0})
        r = client.post("/jobs/refresh-quotes")
        assert r.status_code == 200
        body = r.json()
        assert body["updated"] == 0
        assert body["missing"] == 1
        assert "e1" in body["failure_reasons"]
