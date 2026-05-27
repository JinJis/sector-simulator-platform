"""Write surface for bot-authored CommunityProposal rows (M50).

Mirrors the transactional shape used by the sector-service tRPC
`communityProposal.create` mutation (one community_proposals row +
N proposal_evidence rows + one audit_logs row), but reachable from
the crawler's asyncpg pool without an HTTP roundtrip into sector-
service. The bot creates a meaningful volume of proposals and we
want this path local + auditable.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from typing import Any, Protocol

import asyncpg


def _new_proposal_id() -> str:
    return f"cp_{secrets.token_hex(12)}"


def _new_evidence_id() -> str:
    return f"pe_{secrets.token_hex(12)}"


def _new_audit_id() -> str:
    return f"al_{secrets.token_hex(12)}"


@dataclass(frozen=True, slots=True)
class EvidenceInput:
    """One piece of evidence backing a bot proposal. Kind is the
    `proposal_evidence.kind` column — for bot drafts we always use
    `"url"` pointing at the underlying signal's `source_url`."""

    kind: str  # "url" | "pdf" | "image" | "text"
    content: str


@dataclass(frozen=True, slots=True)
class ProposalDraft:
    """All fields needed to write one community_proposals row."""

    author_id: str  # bot user id
    sector_slug: str
    target_kind: str  # "add_actor" for M50 v1
    target_ref: str | None
    title: str
    body: str
    proposed_payload: dict[str, Any]
    evidence: tuple[EvidenceInput, ...]
    audit_author_label: str  # e.g., "@feasibility_bot"


@dataclass(frozen=True, slots=True)
class WriteResult:
    proposal_id: str
    evidence_count: int


@dataclass(frozen=True, slots=True)
class DecideResult:
    """Outcome of a bulk decide call: how many proposals transitioned to
    the new terminal status, and how many were skipped because they were
    already terminal (applied / rejected / stale). Mirrors the sector-
    service `communityProposal.bulkDecide` mutation's response so the
    SQLAdmin action and the legacy tRPC procedure are interchangeable."""

    decided_ids: tuple[str, ...]
    skipped_ids: tuple[str, ...]


class ProposalWriter(Protocol):
    async def write(self, draft: ProposalDraft) -> WriteResult: ...

    async def decide(
        self,
        proposal_ids: list[str],
        *,
        status: str,
        reason: str | None,
        decided_by_id: str | None,
        decided_by_label: str,
    ) -> DecideResult: ...


class PostgresProposalWriter:
    """asyncpg implementation. One transaction; rollback-safe."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def write(self, draft: ProposalDraft) -> WriteResult:
        proposal_id = _new_proposal_id()
        audit_id = _new_audit_id()
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                """
                    INSERT INTO community_proposals (
                        id, author_id, sector_slug, target_kind, target_ref,
                        title, body, proposed_payload, status, vote_score
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'open', 0
                    )
                    """,
                proposal_id,
                draft.author_id,
                draft.sector_slug,
                draft.target_kind,
                draft.target_ref,
                draft.title,
                draft.body,
                json.dumps(draft.proposed_payload),
            )
            for i, ev in enumerate(draft.evidence):
                await conn.execute(
                    """
                        INSERT INTO proposal_evidence (
                            id, proposal_id, kind, content, order_index
                        )
                        VALUES ($1, $2, $3, $4, $5)
                        """,
                    _new_evidence_id(),
                    proposal_id,
                    ev.kind,
                    ev.content,
                    i,
                )
            await conn.execute(
                """
                    INSERT INTO audit_logs (
                        id, action, sector_slug, payload, author_label
                    )
                    VALUES ($1, $2, $3, $4::jsonb, $5)
                    """,
                audit_id,
                "community_proposal.bot_create",
                draft.sector_slug,
                json.dumps(
                    {
                        "id": proposal_id,
                        "target_kind": draft.target_kind,
                        "target_ref": draft.target_ref,
                        "evidence_count": len(draft.evidence),
                    }
                ),
                draft.audit_author_label,
            )
        return WriteResult(proposal_id=proposal_id, evidence_count=len(draft.evidence))

    async def decide(
        self,
        proposal_ids: list[str],
        *,
        status: str,
        reason: str | None,
        decided_by_id: str | None,
        decided_by_label: str,
    ) -> DecideResult:
        """Bulk-transition open/review proposals to `applied|rejected`.
        Mirrors `services/sector-service/src/trpc/community-proposal.ts
        :: bulkDecide`: one UPDATE per row that's still open/review,
        skip rows already at a terminal status, and one audit_logs row
        per decision. All in a single transaction so retrying a half-
        failed batch is safe.
        """
        if status not in ("applied", "rejected"):
            raise ValueError(f"decide: status must be applied|rejected, got {status!r}")
        if not proposal_ids:
            return DecideResult(decided_ids=(), skipped_ids=())

        decided: list[str] = []
        skipped: list[str] = []
        async with self._pool.acquire() as conn, conn.transaction():
            rows = await conn.fetch(
                """
                    SELECT id, status, sector_slug, target_kind
                    FROM community_proposals
                    WHERE id = ANY($1::text[])
                    FOR UPDATE
                """,
                list(proposal_ids),
            )
            for row in rows:
                if row["status"] in ("applied", "rejected", "stale"):
                    skipped.append(row["id"])
                    continue
                await conn.execute(
                    """
                        UPDATE community_proposals
                        SET status = $2,
                            decided_at = NOW(),
                            decided_by_id = $3,
                            decision_reason = $4,
                            updated_at = NOW()
                        WHERE id = $1
                    """,
                    row["id"],
                    status,
                    decided_by_id,
                    reason or None,
                )
                await conn.execute(
                    """
                        INSERT INTO audit_logs (
                            id, action, sector_slug, payload, author_label
                        )
                        VALUES ($1, $2, $3, $4::jsonb, $5)
                    """,
                    _new_audit_id(),
                    f"community_proposal.{status}",
                    row["sector_slug"],
                    json.dumps(
                        {
                            "id": row["id"],
                            "target_kind": row["target_kind"],
                            "prev_status": row["status"],
                            "reason": reason or None,
                        }
                    ),
                    decided_by_label,
                )
                decided.append(row["id"])
        return DecideResult(decided_ids=tuple(decided), skipped_ids=tuple(skipped))
