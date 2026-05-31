"""Integration test for the marketing_digest job.

No DB, no agent-orchestration. Uses InMemorySignalRepository + an httpx
mock for the marketing-content agent. Verifies the snapshot the job
assembles is source-grounded (binding constraint, notable signal +
domain, lead actor, CTA url) and that the generated copy flows into stats.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from data_pipeline.jobs.marketing_digest import (
    _dominant_delta,
    run_marketing_digest,
)
from data_pipeline.signal_repo import (
    ActorHandle,
    CapabilityHandle,
    CurrentCapabilityScore,
    InMemorySignalRepository,
    RecentSignalForScoring,
)


def _cap(*, id: str, key: str, name: str) -> CapabilityHandle:
    return CapabilityHandle(
        id=id,
        sector_slug="space-data-center",
        key=key,
        name=name,
        description=f"{name} desc.",
        rationale="rationale.",
    )


def _seed_repo() -> InMemorySignalRepository:
    return InMemorySignalRepository(
        capabilities={
            "space-data-center": [
                _cap(id="cap_rad", key="rad_hard", name="Radiation-hard compute"),
                _cap(id="cap_launch", key="launch", name="Launch cost"),
            ]
        },
        actors={
            "space-data-center": [
                ActorHandle(
                    id="act_amd",
                    key="amd",
                    name="Advanced Micro Devices",
                    short_name="AMD",
                    aliases=["AMD"],
                )
            ]
        },
        current_scores={
            # rad-hard is the bottleneck (lowest composite).
            "cap_rad": CurrentCapabilityScore(
                capability_id="cap_rad",
                capability_key="rad_hard",
                technical=40, economic=40, regulatory=40, supply=40,
            ),
            "cap_launch": CurrentCapabilityScore(
                capability_id="cap_launch",
                capability_key="launch",
                technical=72, economic=72, regulatory=72, supply=72,
            ),
        },
        recent_signals={
            "cap_rad": [
                RecentSignalForScoring(
                    title="AMD MI300 passes rad-test",
                    summary="Milestone at NASA Pegasus.",
                    source_kind="news",
                    published_at=datetime.now(UTC) - timedelta(days=1),
                    delta_technical=4,
                    delta_economic=None,
                    delta_regulatory=None,
                    delta_supply=1,
                    actor_short_name="AMD",
                    source_url="https://www.reuters.com/tech/amd-mi300",
                )
            ],
            "cap_launch": [],
        },
    )


def test_dominant_delta_picks_largest_magnitude() -> None:
    s = RecentSignalForScoring(
        title="x", summary=None, source_kind="news",
        published_at=datetime.now(UTC),
        delta_technical=2, delta_economic=-5, delta_regulatory=None,
        delta_supply=1, actor_short_name=None,
    )
    assert _dominant_delta(s) == -5


@pytest.mark.asyncio
async def test_assembles_snapshot_and_collects_posts() -> None:
    repo = _seed_repo()
    captured: dict = {}
    agent_resp = {
        "post_set": {
            "headline_insight": "Rad-hard compute gates orbital DCs.",
            "angle": "bottleneck reveal",
            "posts": [],
            "source_refs": ["reuters.com"],
        },
        "cost_usd": 0.018,
        "duration_ms": 2200,
    }

    with patch(
        "data_pipeline.jobs.marketing_digest.httpx.AsyncClient"
    ) as MockClient:
        inst = MockClient.return_value.__aenter__.return_value

        async def post_router(url, *, json=None, timeout=None):  # noqa: ANN001
            captured["url"] = url
            captured["snapshot"] = json
            mock_resp = AsyncMock()
            mock_resp.json = lambda: agent_resp
            mock_resp.raise_for_status = lambda: None
            mock_resp.status_code = 200
            return mock_resp

        inst.post = AsyncMock(side_effect=post_router)

        stats = await run_marketing_digest(
            sector_slugs=["space-data-center"],
            repo=repo,
            web_base_url="https://app.example.com",
        )

    assert stats.visions_processed == 1
    assert stats.post_sets_generated == 1
    assert stats.agent_failures == 0
    assert stats.total_cost_usd == pytest.approx(0.018)

    snap = captured["snapshot"]
    # Binding constraint = the lowest-composite capability (rad-hard=40).
    assert snap["binding_capability_name"] == "Radiation-hard compute"
    assert snap["binding_constraint_score"] == pytest.approx(40.0, abs=0.01)
    # Notable signal selected across capabilities, with source domain.
    assert snap["notable_signal"]["title"] == "AMD MI300 passes rad-test"
    assert snap["notable_signal"]["source_domain"] == "www.reuters.com"
    assert snap["notable_signal"]["dominant_delta"] == 4
    # Lead actor + product-led CTA url.
    assert snap["lead_actor_name"] == "AMD"
    assert snap["vision_url"] == "https://app.example.com/visions/space-data-center"
    # Binding capability flagged in the capabilities list.
    binding = [c for c in snap["capabilities"] if c["is_binding"]]
    assert len(binding) == 1 and binding[0]["name"] == "Radiation-hard compute"

    # Generated copy flows into stats for operator review.
    assert stats.results[0]["headline_insight"] == "Rad-hard compute gates orbital DCs."


@pytest.mark.asyncio
async def test_skips_vision_with_no_capabilities() -> None:
    repo = InMemorySignalRepository(capabilities={"empty-vision": []})
    stats = await run_marketing_digest(sector_slugs=["empty-vision"], repo=repo)
    assert stats.visions_processed == 0
    assert stats.visions_skipped_no_capabilities == 1
    assert stats.post_sets_generated == 0


@pytest.mark.asyncio
async def test_agent_failure_isolated() -> None:
    repo = _seed_repo()
    with patch(
        "data_pipeline.jobs.marketing_digest.httpx.AsyncClient"
    ) as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        import httpx

        async def boom(url, *, json=None, timeout=None):  # noqa: ANN001
            raise httpx.ConnectError("agent down")

        inst.post = AsyncMock(side_effect=boom)
        stats = await run_marketing_digest(
            sector_slugs=["space-data-center"], repo=repo
        )
    assert stats.visions_processed == 1
    assert stats.agent_failures == 1
    assert stats.post_sets_generated == 0
