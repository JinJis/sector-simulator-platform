"""Test fixtures — never hit the network. Use the FakeSource adapter
+ InMemoryEquityRepository for the entire suite."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _disable_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """`refresh_quotes._throttle` sleeps 200ms by default — fine in prod,
    death-by-a-thousand-cuts in tests with 50 equities. Patch it out
    globally so every test runs fast."""

    async def _no_sleep(_ms: int) -> None:
        return None

    import data_pipeline.jobs.refresh_quotes as job_mod

    monkeypatch.setattr(job_mod, "_throttle", _no_sleep)
