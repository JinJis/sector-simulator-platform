"""Integration test for the M39c signal_ingest job.

No DB, no agent-orchestration, no real arXiv. Uses
InMemorySignalRepository + a FakeSignalSource + httpx mocks against
the extractor endpoint to exercise the full orchestration path.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from data_pipeline.jobs.signal_ingest import _load_keywords, run_signal_ingest
from data_pipeline.signal_repo import (
    ActorHandle,
    CapabilityHandle,
    InMemorySignalRepository,
)
from data_pipeline.signals.base import RawSignal


class FakeSignalSource:
    """Returns a canned RawSignal per call. Honors `since` cutoff so
    timestamp tests pass."""

    source_kind: str = "paper"
    name: str = "fake"

    def __init__(self, *, results: list[RawSignal]) -> None:
        self._results = results
        self.calls: list[dict[str, Any]] = []

    async def fetch(
        self,
        *,
        sector_slug: str,
        capability_key: str,
        keywords: list[str],
        since: datetime,
        max_results: int = 20,
    ) -> list[RawSignal]:
        self.calls.append(
            {
                "sector_slug": sector_slug,
                "capability_key": capability_key,
                "keywords": keywords,
                "since": since,
                "max_results": max_results,
            }
        )
        # Only return entries belonging to this (sector, capability)
        # combination and newer than `since`.
        return [
            r
            for r in self._results
            if r.sector_slug == sector_slug
            and r.capability_key == capability_key
            and r.published_at >= since
        ]


def _raw(
    *,
    sector_slug: str = "space-data-center",
    capability_key: str = "rad_hard_compute",
    source_url: str = "https://arxiv.org/abs/2401.99999",
    title: str = "Rad-hard MI300 demonstration",
    days_ago: int = 1,
) -> RawSignal:
    return RawSignal(
        sector_slug=sector_slug,
        capability_key=capability_key,
        source_kind="paper",
        source_url=source_url,
        source_id_ext="2401.99999",
        title=title,
        summary="Demo of MI300 SEU resilience.",
        published_at=datetime.now(UTC) - timedelta(days=days_ago),
    )


def _cap(
    *,
    id: str = "cap_rad_hard",
    key: str = "rad_hard_compute",
    sector_slug: str = "space-data-center",
) -> CapabilityHandle:
    return CapabilityHandle(
        id=id,
        sector_slug=sector_slug,
        key=key,
        name="Radiation-hard compute",
        description="GPUs that survive LEO radiation.",
        rationale="Binding constraint for orbital DCs.",
    )


# ---- Keyword loader -------------------------------------------------------

class TestLoadKeywords:
    def test_loads_sdc_keywords(self) -> None:
        kw = _load_keywords("space-data-center")
        assert "rad_hard_compute" in kw
        assert len(kw["rad_hard_compute"]) > 0
        # Every capability key should map to a non-empty list.
        for cap_key, terms in kw.items():
            assert isinstance(terms, list)
            assert all(isinstance(t, str) and t for t in terms)

    def test_missing_file_returns_empty(self) -> None:
        kw = _load_keywords("nonexistent-vision")
        assert kw == {}


# ---- Orchestrator ---------------------------------------------------------

@pytest.mark.asyncio
class TestRunSignalIngest:
    async def test_skip_extractor_writes_raw_signals(self) -> None:
        repo = InMemorySignalRepository(
            capabilities={
                "space-data-center": [_cap(id="cap_rad_hard", key="rad_hard_compute")]
            },
            actors={"space-data-center": []},
        )
        source = FakeSignalSource(
            results=[
                _raw(source_url="https://arxiv.org/abs/2401.00001", days_ago=1),
                _raw(source_url="https://arxiv.org/abs/2401.00002", days_ago=2),
            ]
        )
        stats = await run_signal_ingest(
            sector_slugs=["space-data-center"],
            repo=repo,
            sources=[source],
            skip_extractor=True,
        )
        assert stats.visions_processed == 1
        # Only the rad_hard_compute capability is seeded into the
        # InMemory repo above. Other keys in keywords/space-data-center
        # .json are skipped (logged) since they have no matching repo
        # capability row.
        assert stats.capabilities_processed == 1
        assert stats.raw_signals_fetched == 2
        assert stats.signals_written == 2
        assert stats.extractor_calls == 0
        assert stats.extractor_failures == 0
        # Source called once per seeded capability.
        assert len(source.calls) == 1

    async def test_with_extractor_attaches_deltas(self) -> None:
        repo = InMemorySignalRepository(
            capabilities={
                "space-data-center": [_cap(id="cap_rad_hard", key="rad_hard_compute")]
            },
            actors={
                "space-data-center": [
                    ActorHandle(
                        id="act_amd",
                        key="amd",
                        name="AMD",
                        short_name="AMD",
                        aliases=["AMD", "MI300"],
                    )
                ]
            },
        )
        source = FakeSignalSource(results=[_raw(days_ago=1)])

        extractor_response = {
            "scoring": {
                "delta_technical": -2,
                "delta_economic": None,
                "delta_regulatory": None,
                "delta_supply": -1,
                "confidence": 0.9,
                "is_highlight": True,
                "matched_actor_key": "amd",
                "rationale": "MI300 rad-test slip.",
            },
            "cost_usd": 0.001,
            "duration_ms": 240,
        }

        with patch("data_pipeline.jobs.signal_ingest.httpx.AsyncClient") as MockClient:
            mock_resp = AsyncMock()
            mock_resp.json = lambda: extractor_response
            mock_resp.raise_for_status = lambda: None
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_resp
            )

            stats = await run_signal_ingest(
                sector_slugs=["space-data-center"],
                repo=repo,
                sources=[source],
            )

        assert stats.signals_written == 1
        assert stats.extractor_calls == 1
        assert stats.extractor_failures == 0
        assert stats.extractor_total_cost_usd == pytest.approx(0.001)

    async def test_extractor_failure_still_writes_raw(self) -> None:
        """When extractor errors, we still write the raw signal so the
        score updater (M40) can re-score later."""
        repo = InMemorySignalRepository(
            capabilities={
                "space-data-center": [_cap(id="cap_rad_hard", key="rad_hard_compute")]
            },
            actors={"space-data-center": []},
        )
        source = FakeSignalSource(results=[_raw(days_ago=1)])

        with patch("data_pipeline.jobs.signal_ingest.httpx.AsyncClient") as MockClient:
            import httpx

            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=httpx.ConnectError("agent down")
            )
            stats = await run_signal_ingest(
                sector_slugs=["space-data-center"],
                repo=repo,
                sources=[source],
            )
        assert stats.signals_written == 1
        assert stats.extractor_failures == 1
        assert stats.extractor_calls == 1

    async def test_skips_vision_with_no_keywords_file(self) -> None:
        repo = InMemorySignalRepository()
        source = FakeSignalSource(results=[])
        stats = await run_signal_ingest(
            sector_slugs=["nonexistent-vision"],
            repo=repo,
            sources=[source],
            skip_extractor=True,
        )
        assert stats.visions_processed == 0
        assert stats.signals_written == 0
        assert source.calls == []

    async def test_idempotent_on_second_run(self) -> None:
        """Re-running the cron with the same upstream results should not
        duplicate rows. InMemorySignalRepository keys by (source_url,
        capability_id) — same key on PostgresSignalRepository via the
        ON CONFLICT clause."""
        repo = InMemorySignalRepository(
            capabilities={
                "space-data-center": [_cap(id="cap_rad_hard", key="rad_hard_compute")]
            },
            actors={"space-data-center": []},
        )
        source = FakeSignalSource(
            results=[_raw(source_url="https://arxiv.org/abs/2401.00099", days_ago=1)]
        )
        await run_signal_ingest(
            sector_slugs=["space-data-center"],
            repo=repo,
            sources=[source],
            skip_extractor=True,
        )
        await run_signal_ingest(
            sector_slugs=["space-data-center"],
            repo=repo,
            sources=[source],
            skip_extractor=True,
        )
        # Internal in-memory store has exactly one row.
        assert len(repo._signals) == 1  # noqa: SLF001 - test introspection
