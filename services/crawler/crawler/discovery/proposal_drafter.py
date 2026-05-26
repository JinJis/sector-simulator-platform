"""ProposalDrafter (M50).

Given an ExtractedEntity + bot user id, build a ProposalDraft and
write it via PostgresProposalWriter. Idempotent on second run via
`bot_proposal_exists_for(target_kind, target_ref)` — re-detecting
the same name within the open-proposal window is a no-op rather
than a duplicate row.

target_kind = "add_actor" for M50 v1. Capability / risk / source
discovery follow the same writer shape later.
"""

from __future__ import annotations

from dataclasses import dataclass

from crawler.db.discovery_reader import DiscoveryReader
from crawler.db.proposal_writer import (
    EvidenceInput,
    ProposalDraft,
    ProposalWriter,
)
from crawler.discovery.entity_detector import ExtractedEntity


@dataclass(frozen=True, slots=True)
class DraftedProposal:
    proposal_id: str
    target_kind: str
    target_ref: str
    evidence_count: int


@dataclass(frozen=True, slots=True)
class SkippedProposal:
    target_kind: str
    target_ref: str
    reason: str  # "duplicate_open" | "no_evidence"


def _actor_key_from_name(name: str) -> str:
    """Slug for `target_ref` + the proposed Actor.key once approved.
    Keeps the same shape the actor seed uses (snake_case lowercase).
    e.g. 'Starcloud Inc' → 'starcloud_inc'."""
    return (
        "".join(ch.lower() if ch.isalnum() else "_" for ch in name.strip())
        .strip("_")
        .replace("__", "_")
    )


def _build_actor_draft(
    *,
    entity: ExtractedEntity,
    sector_slug: str,
    bot_user_id: str,
    bot_label: str,
) -> ProposalDraft:
    target_ref = _actor_key_from_name(entity.name)
    title = f"Bot proposal: add actor {entity.name}"
    body_lines = [
        f"`@feasibility_bot` detected **{entity.name}** in "
        f"{len(entity.signal_ids)} recent signal"
        f"{'s' if len(entity.signal_ids) != 1 else ''} for this vision, "
        "and found no matching Actor row in the database.",
        "",
        "Supporting signals:",
    ]
    for title_text, url in zip(entity.signal_titles, entity.signal_urls, strict=False):
        body_lines.append(f"- [{title_text}]({url})")
    body_lines.append("")
    body_lines.append(
        "If accepted, an Actor + VisionActor + initial CapabilityActor "
        "rows will be drafted for admin approval via the M46e applier."
    )
    body = "\n".join(body_lines)

    proposed_payload = {
        "actor": {
            "key": target_ref,
            "name": entity.name,
            # Conservative defaults — admin edits before applying.
            "short_name": entity.name.split()[0] if entity.name else target_ref,
            "iso_country": "??",
            "category": "private_startup",
            "stage": "research",
            "blurb": f"Detected by @feasibility_bot from {len(entity.signal_ids)} signals.",
            "signal_keywords": list({entity.name, *entity.name.split()}),
        },
        "vision": {
            "sector_slug": sector_slug,
            "relevance": None,
            "rationale": None,
            "display_order": 100,
        },
        "evidence_signal_ids": list(entity.signal_ids),
    }

    evidence = tuple(EvidenceInput(kind="url", content=url) for url in entity.signal_urls)

    return ProposalDraft(
        author_id=bot_user_id,
        sector_slug=sector_slug,
        target_kind="add_actor",
        target_ref=target_ref,
        title=title,
        body=body,
        proposed_payload=proposed_payload,
        evidence=evidence,
        audit_author_label=bot_label,
    )


async def draft_actor_proposal(
    *,
    entity: ExtractedEntity,
    sector_slug: str,
    bot_user_id: str,
    bot_label: str,
    reader: DiscoveryReader,
    writer: ProposalWriter,
) -> DraftedProposal | SkippedProposal:
    """Write one `add_actor` CommunityProposal for the detected entity,
    or return SkippedProposal when an open/review proposal with the
    same target_ref already exists."""
    target_ref = _actor_key_from_name(entity.name)
    already = await reader.bot_proposal_exists_for(
        bot_user_id=bot_user_id,
        sector_slug=sector_slug,
        target_kind="add_actor",
        target_ref=target_ref,
    )
    if already:
        return SkippedProposal(
            target_kind="add_actor",
            target_ref=target_ref,
            reason="duplicate_open",
        )

    draft = _build_actor_draft(
        entity=entity,
        sector_slug=sector_slug,
        bot_user_id=bot_user_id,
        bot_label=bot_label,
    )
    result = await writer.write(draft)
    return DraftedProposal(
        proposal_id=result.proposal_id,
        target_kind=draft.target_kind,
        target_ref=draft.target_ref or "",
        evidence_count=result.evidence_count,
    )
