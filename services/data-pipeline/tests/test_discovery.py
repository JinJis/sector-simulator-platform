"""Offline tests for EntityDetector + ProposalDrafter + runner (M50).

All deps faked. Verify criterion from current.md M50:
  seed a "Starcloud Inc." fixture set (4 mock signals, no existing
  Actor row matching) → run discovery loop → exactly one
  CommunityProposal row appears with `author_id = bot`,
  `target_kind = "add_actor"`, payload populated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from data_pipeline.db.discovery_reader import KnownActorRow, RecentSignalRow
from data_pipeline.db.proposal_writer import ProposalDraft, WriteResult
from data_pipeline.deep_research.discovery.entity_detector import (
    detect_new_actors,
    jaro_winkler,
)
from data_pipeline.deep_research.discovery.proposal_drafter import (
    DraftedProposal,
    SkippedProposal,
    draft_actor_proposal,
)
from data_pipeline.deep_research.discovery.runner import run_discovery

# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------


@dataclass
class _FakeReader:
    signals: list[RecentSignalRow] = field(default_factory=list)
    known: list[KnownActorRow] = field(default_factory=list)
    existing_proposals: set[tuple[str, str, str, str]] = field(default_factory=set)

    async def list_recent_untagged_signals(
        self, *, sector_slug: str, since: datetime
    ) -> list[RecentSignalRow]:
        return [s for s in self.signals if s.sector_slug == sector_slug and s.published_at >= since]

    async def list_known_actor_names(self) -> list[KnownActorRow]:
        return list(self.known)

    async def bot_proposal_exists_for(
        self,
        *,
        bot_user_id: str,
        sector_slug: str,
        target_kind: str,
        target_ref: str,
    ) -> bool:
        return (
            bot_user_id,
            sector_slug,
            target_kind,
            target_ref,
        ) in self.existing_proposals


@dataclass
class _FakeWriter:
    written: list[ProposalDraft] = field(default_factory=list)
    _seq: int = 0

    async def write(self, draft: ProposalDraft) -> WriteResult:
        self._seq += 1
        self.written.append(draft)
        return WriteResult(
            proposal_id=f"cp_test_{self._seq}",
            evidence_count=len(draft.evidence),
        )


def _signal(
    *,
    sid: str,
    title: str,
    summary: str | None = None,
    days_ago: int = 1,
    sector: str = "space-data-center",
) -> RecentSignalRow:
    return RecentSignalRow(
        id=sid,
        sector_slug=sector,
        title=title,
        summary=summary,
        source_url=f"https://example.com/{sid}",
        published_at=datetime.now(UTC) - timedelta(days=days_ago),
    )


# --------------------------------------------------------------------------
# Jaro-Winkler sanity
# --------------------------------------------------------------------------


def test_jaro_winkler_known_pairs() -> None:
    assert jaro_winkler("MARTHA", "MARHTA") > 0.96
    assert jaro_winkler("DWAYNE", "DUANE") > 0.83
    assert jaro_winkler("Starcloud", "Starcloud Inc") > 0.92
    assert jaro_winkler("totally", "unrelated") < 0.7


# --------------------------------------------------------------------------
# EntityDetector
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detector_finds_starcloud_with_two_signals() -> None:
    reader = _FakeReader(
        signals=[
            _signal(
                sid="s1",
                title="Starcloud Inc raises $48M Series B for orbital DC",
            ),
            _signal(
                sid="s2",
                title="Lunar payload mission update from Starcloud Inc",
            ),
        ],
        known=[
            KnownActorRow(actor_key="spacex", name="SpaceX", short_name="SpaceX"),
        ],
    )
    cands = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    assert len(cands) == 1
    assert cands[0].name == "Starcloud Inc"
    assert set(cands[0].signal_ids) == {"s1", "s2"}


@pytest.mark.asyncio
async def test_detector_skips_when_below_min_signal_count() -> None:
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc raises $48M"),
        ],
        known=[],
    )
    cands = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    assert cands == []


@pytest.mark.asyncio
async def test_detector_skips_when_fuzzy_matches_known() -> None:
    """`Starcloud` already exists → 'Starcloud Inc' should be filtered."""
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc Series B"),
            _signal(sid="s2", title="Starcloud Inc lunar demo"),
        ],
        known=[
            KnownActorRow(actor_key="starcloud", name="Starcloud", short_name=None),
        ],
    )
    cands = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    assert cands == []


@pytest.mark.asyncio
async def test_detector_skips_blocklisted_heads() -> None:
    """'The Inc' shouldn't be returned even with two signals."""
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="The Inc announced something"),
            _signal(sid="s2", title="The Inc launched again"),
        ],
        known=[],
    )
    cands = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    assert cands == []


# --------------------------------------------------------------------------
# ProposalDrafter
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drafter_writes_actor_proposal_with_evidence() -> None:
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc raises $48M"),
            _signal(sid="s2", title="Starcloud Inc lunar payload"),
        ],
    )
    writer = _FakeWriter()
    [cand] = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    result = await draft_actor_proposal(
        entity=cand,
        sector_slug="space-data-center",
        bot_user_id="bot_test",
        bot_label="@feasibility_bot",
        reader=reader,
        writer=writer,
    )
    assert isinstance(result, DraftedProposal)
    assert result.target_kind == "add_actor"
    assert result.target_ref.startswith("starcloud")
    assert result.evidence_count == 2

    [draft] = writer.written
    assert draft.author_id == "bot_test"
    assert draft.sector_slug == "space-data-center"
    assert draft.target_kind == "add_actor"
    assert "Starcloud Inc" in draft.title
    assert "Starcloud Inc" in draft.body
    payload = draft.proposed_payload
    assert payload["actor"]["name"] == "Starcloud Inc"
    assert "s1" in payload["evidence_signal_ids"]
    assert all(ev.kind == "url" for ev in draft.evidence)


@pytest.mark.asyncio
async def test_drafter_skips_duplicate_open_proposal() -> None:
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc raises $48M"),
            _signal(sid="s2", title="Starcloud Inc lunar payload"),
        ],
    )
    # Pre-register the same target_ref as an open bot proposal.
    reader.existing_proposals.add(("bot_test", "space-data-center", "add_actor", "starcloud_inc"))
    writer = _FakeWriter()
    [cand] = await detect_new_actors(sector_slug="space-data-center", reader=reader)
    result = await draft_actor_proposal(
        entity=cand,
        sector_slug="space-data-center",
        bot_user_id="bot_test",
        bot_label="@feasibility_bot",
        reader=reader,
        writer=writer,
    )
    assert isinstance(result, SkippedProposal)
    assert result.reason == "duplicate_open"
    assert writer.written == []


# --------------------------------------------------------------------------
# Verify criterion — full discovery loop
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_discovery_verify_criterion_starcloud_fixture() -> None:
    """The exact verify case from current.md M50: 4 mock signals about
    Starcloud Inc, no existing Actor → exactly one CommunityProposal
    with author=bot, target_kind='add_actor', payload populated."""
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc closes Series B funding"),
            _signal(sid="s2", title="Starcloud Inc unveils lunar payload roadmap"),
            _signal(sid="s3", title="Aerospace Today profiles Starcloud Inc"),
            _signal(sid="s4", title="Starcloud Inc files FCC spectrum request"),
        ],
        known=[
            KnownActorRow(actor_key="spacex", name="SpaceX", short_name=None),
            KnownActorRow(actor_key="nasa", name="NASA", short_name=None),
        ],
    )
    writer = _FakeWriter()
    summary = await run_discovery(
        sector_slugs=["space-data-center"],
        reader=reader,
        writer=writer,
        bot_user_id="bot_test",
    )
    assert summary.candidates_detected == 1
    assert summary.proposals_written == 1
    assert summary.proposals_skipped == 0
    [drafted] = summary.written
    assert drafted.target_kind == "add_actor"
    [draft] = writer.written
    assert draft.author_id == "bot_test"
    assert draft.audit_author_label == "@feasibility_bot"
    assert len(draft.evidence) == 4


@pytest.mark.asyncio
async def test_discovery_idempotent_on_second_run() -> None:
    reader = _FakeReader(
        signals=[
            _signal(sid="s1", title="Starcloud Inc Series B"),
            _signal(sid="s2", title="Starcloud Inc lunar demo"),
        ],
    )
    writer = _FakeWriter()
    # First run writes one proposal; mark it as pending in the reader.
    s1 = await run_discovery(
        sector_slugs=["space-data-center"],
        reader=reader,
        writer=writer,
        bot_user_id="bot_test",
    )
    assert s1.proposals_written == 1
    reader.existing_proposals.add(("bot_test", "space-data-center", "add_actor", "starcloud_inc"))
    # Second run sees the same candidate but it's now in
    # existing_proposals → skipped instead of duplicated.
    s2 = await run_discovery(
        sector_slugs=["space-data-center"],
        reader=reader,
        writer=writer,
        bot_user_id="bot_test",
    )
    assert s2.proposals_written == 0
    assert s2.proposals_skipped == 1
