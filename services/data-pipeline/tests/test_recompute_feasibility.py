"""Integration test for the M40b recompute_feasibility cron.

No DB, no agent-orchestration, no sim-service. Uses
InMemorySignalRepository + httpx mocks for both upstream services.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from data_pipeline.jobs.recompute_feasibility import (
    _aggregate_capability_composite,
    run_recompute_feasibility,
)
from data_pipeline.signal_repo import (
    CapabilityHandle,
    CurrentCapabilityScore,
    InMemorySignalRepository,
    RecentSignalForScoring,
)


# ---- Local aggregator parity --------------------------------------------


class TestLocalAggregator:
    def test_matches_sim_service_math(self) -> None:
        # tech=20 econ=80 reg=80 sup=80, weights 0.25 each, softening 0.6
        # weighted_mean = 65, lowest = 20
        # composite = 20 + 0.6 × (65-20) = 47.0
        composite, p10, p90 = _aggregate_capability_composite(20, 80, 80, 80)
        assert composite == pytest.approx(47.0, abs=0.01)
        assert p10 is not None and p10 < composite
        assert p90 is not None and p90 > composite

    def test_all_null_returns_none(self) -> None:
        composite, p10, p90 = _aggregate_capability_composite(None, None, None, None)
        assert composite is None
        assert p10 is None
        assert p90 is None

    def test_partial_null(self) -> None:
        composite, p10, p90 = _aggregate_capability_composite(60, 60, None, None)
        assert composite == pytest.approx(60.0, abs=0.01)


# ---- Orchestrator -------------------------------------------------------


def _cap(
    *,
    id: str = "cap_rad_hard",
    key: str = "rad_hard_compute",
) -> CapabilityHandle:
    return CapabilityHandle(
        id=id,
        sector_slug="space-data-center",
        key=key,
        name="Rad-hard compute",
        description="GPUs surviving LEO radiation.",
        rationale="Binding constraint.",
    )


@pytest.mark.asyncio
class TestRunRecomputeFeasibility:
    async def test_updates_score_and_triggers_vision_recompute(self) -> None:
        repo = InMemorySignalRepository(
            capabilities={"space-data-center": [_cap()]},
            current_scores={
                "cap_rad_hard": CurrentCapabilityScore(
                    capability_id="cap_rad_hard",
                    capability_key="rad_hard_compute",
                    technical=56,
                    economic=30,
                    regulatory=48,
                    supply=38,
                )
            },
            recent_signals={
                "cap_rad_hard": [
                    RecentSignalForScoring(
                        title="MI300 rad-test delayed",
                        summary="Q4 slip",
                        source_kind="news",
                        published_at=datetime.now(UTC) - timedelta(days=1),
                        delta_technical=-2,
                        delta_economic=None,
                        delta_regulatory=None,
                        delta_supply=-1,
                        actor_short_name="AMD",
                    )
                ]
            },
        )

        updater_resp = {
            "update": {
                "technical": 54,
                "economic": None,
                "regulatory": None,
                "supply": 37,
                "confidence": 0.85,
                "rationale": "MI300 slip.",
            },
            "cost_usd": 0.02,
            "duration_ms": 1100,
        }
        sim_resp = {
            "composite": 51.2,
            "binding_capability_key": "rad_hard_compute",
            "eta_median_years": 1.8,
        }

        with patch(
            "data_pipeline.jobs.recompute_feasibility.httpx.AsyncClient"
        ) as MockClient:
            inst = MockClient.return_value.__aenter__.return_value

            async def post_router(url, *, json=None, timeout=None):  # noqa: ANN001
                mock_resp = AsyncMock()
                if "capability-score-updater" in url:
                    mock_resp.json = lambda: updater_resp
                else:
                    mock_resp.json = lambda: sim_resp
                mock_resp.raise_for_status = lambda: None
                mock_resp.status_code = 200
                mock_resp.text = ""
                return mock_resp

            inst.post = AsyncMock(side_effect=post_router)

            stats = await run_recompute_feasibility(
                sector_slugs=["space-data-center"],
                repo=repo,
            )

        assert stats.visions_processed == 1
        assert stats.capabilities_processed == 1
        assert stats.score_updater_calls == 1
        assert stats.score_updater_failures == 0
        assert stats.score_writes == 1
        assert stats.feasibility_writes == 1
        assert stats.score_updater_total_cost_usd == pytest.approx(0.02)

        # The new CapabilityScore preserves un-moved dims via the
        # "agent-null = keep current" rule.
        assert len(repo._capability_score_writes) == 1  # noqa: SLF001
        write = repo._capability_score_writes[0]  # noqa: SLF001
        assert write.technical == 54
        assert write.economic == 30  # unchanged (agent returned null)
        assert write.supply == 37
        assert write.composite is not None

    async def test_skips_write_below_confidence_threshold(self) -> None:
        repo = InMemorySignalRepository(
            capabilities={"space-data-center": [_cap()]},
            current_scores={
                "cap_rad_hard": CurrentCapabilityScore(
                    capability_id="cap_rad_hard",
                    capability_key="rad_hard_compute",
                    technical=56, economic=30, regulatory=48, supply=38,
                )
            },
            recent_signals={"cap_rad_hard": []},
        )

        updater_resp = {
            "update": {"confidence": 0.3, "rationale": "no signals — uncertain"},
            "cost_usd": 0.005,
            "duration_ms": 600,
        }

        with patch(
            "data_pipeline.jobs.recompute_feasibility.httpx.AsyncClient"
        ) as MockClient:
            inst = MockClient.return_value.__aenter__.return_value

            async def post_router(url, *, json=None, timeout=None):  # noqa: ANN001
                mock_resp = AsyncMock()
                mock_resp.json = lambda: (
                    updater_resp if "capability-score-updater" in url else {"composite": 0}
                )
                mock_resp.raise_for_status = lambda: None
                mock_resp.status_code = 200
                mock_resp.text = ""
                return mock_resp

            inst.post = AsyncMock(side_effect=post_router)

            stats = await run_recompute_feasibility(
                sector_slugs=["space-data-center"],
                repo=repo,
            )
        assert stats.score_writes == 0
        assert stats.score_writes_skipped_low_confidence == 1
        # No score write but still triggers vision-level recompute.
        assert stats.feasibility_writes == 1

    async def test_score_updater_failure_doesnt_kill_run(self) -> None:
        import httpx

        repo = InMemorySignalRepository(
            capabilities={
                "space-data-center": [_cap(id="c1", key="cap1"), _cap(id="c2", key="cap2")]
            },
            current_scores={},
            recent_signals={},
        )

        with patch(
            "data_pipeline.jobs.recompute_feasibility.httpx.AsyncClient"
        ) as MockClient:
            inst = MockClient.return_value.__aenter__.return_value
            inst.post = AsyncMock(side_effect=httpx.ConnectError("agent down"))

            stats = await run_recompute_feasibility(
                sector_slugs=["space-data-center"],
                repo=repo,
            )
        # Both capability calls failed; sim recompute also failed.
        # But the run completed without raising.
        assert stats.capabilities_processed == 2
        assert stats.score_updater_failures == 2
        assert stats.score_writes == 0
        assert stats.feasibility_writes == 0
        assert len(stats.errors) >= 1
