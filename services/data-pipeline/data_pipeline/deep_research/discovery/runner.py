"""Discovery runner (M50).

Per-vision orchestration: detect_new_actors → draft_actor_proposal
for each candidate that isn't already an open proposal. Returns a
DiscoverySummary the admin cockpit + cron logs read.

Idempotent on second run — the per-candidate `bot_proposal_exists_for`
check inside ProposalDrafter keeps duplicates out.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from data_pipeline.db.discovery_reader import DiscoveryReader
from data_pipeline.db.proposal_writer import ProposalWriter
from data_pipeline.deep_research.discovery.entity_detector import detect_new_actors
from data_pipeline.deep_research.discovery.proposal_drafter import (
    DraftedProposal,
    SkippedProposal,
    draft_actor_proposal,
)

log = logging.getLogger("crawler.discovery")


@dataclass(slots=True)
class DiscoverySummary:
    started_at: datetime
    finished_at: datetime | None = None
    visions: list[str] = field(default_factory=list)
    candidates_detected: int = 0
    proposals_written: int = 0
    proposals_skipped: int = 0
    written: list[DraftedProposal] = field(default_factory=list)
    skipped: list[SkippedProposal] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "visions": self.visions,
            "candidates_detected": self.candidates_detected,
            "proposals_written": self.proposals_written,
            "proposals_skipped": self.proposals_skipped,
            "written": [
                {
                    "proposal_id": w.proposal_id,
                    "target_kind": w.target_kind,
                    "target_ref": w.target_ref,
                    "evidence_count": w.evidence_count,
                }
                for w in self.written
            ],
            "skipped": [
                {
                    "target_kind": s.target_kind,
                    "target_ref": s.target_ref,
                    "reason": s.reason,
                }
                for s in self.skipped
            ],
        }


async def run_discovery(
    *,
    sector_slugs: list[str],
    reader: DiscoveryReader,
    writer: ProposalWriter,
    bot_user_id: str,
    bot_label: str = "@feasibility_bot",
    min_signal_count: int = 2,
    lookback_days: int = 7,
    fuzzy_threshold: float = 0.92,
    now: datetime | None = None,
) -> DiscoverySummary:
    started = now or datetime.now(UTC)
    summary = DiscoverySummary(started_at=started, visions=list(sector_slugs))

    for slug in sector_slugs:
        candidates = await detect_new_actors(
            sector_slug=slug,
            reader=reader,
            min_signal_count=min_signal_count,
            lookback_days=lookback_days,
            fuzzy_threshold=fuzzy_threshold,
            now=started,
        )
        summary.candidates_detected += len(candidates)
        for cand in candidates:
            outcome = await draft_actor_proposal(
                entity=cand,
                sector_slug=slug,
                bot_user_id=bot_user_id,
                bot_label=bot_label,
                reader=reader,
                writer=writer,
            )
            if isinstance(outcome, DraftedProposal):
                summary.written.append(outcome)
                summary.proposals_written += 1
            else:
                summary.skipped.append(outcome)
                summary.proposals_skipped += 1

    summary.finished_at = datetime.now(UTC)
    log.info(
        "discovery: visions=%d candidates=%d written=%d skipped=%d",
        len(sector_slugs),
        summary.candidates_detected,
        summary.proposals_written,
        summary.proposals_skipped,
    )
    return summary
