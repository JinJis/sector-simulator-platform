/**
 * M46c — Reputation primitives.
 *
 * Two pure functions + one helper for writing the {PointEvent + bump
 * UserReputation} txn. Pure functions are exported for tests; the
 * writer is the canonical seam every reputation-affecting mutation
 * goes through (so PointEvent is never written without the matching
 * UserReputation upsert and vice versa).
 *
 * Tier rules (lifted from Community 3.0 plan §5):
 *   newcomer    0–99
 *   member      100–499
 *   analyst     500–2,999     (admin-queue weight ×2)
 *   senior      3,000–9,999   (can auto-apply trivial proposals)
 *   maintainer  10,000+       (auto-approve non-trivial proposals)
 *
 * Vote weight (from voter rep):
 *   1 + floor(total_points / 1000), capped at 5
 *
 * So a Newcomer votes weight=1, an Analyst at 2,000 votes weight=3,
 * a Maintainer with 12,000 caps at weight=5.
 */

import type { Prisma, PrismaClient } from "@platform/db";

export type Tier =
  | "newcomer"
  | "member"
  | "analyst"
  | "senior"
  | "maintainer";

export const TIER_BANDS: Array<{ min: number; tier: Tier }> = [
  { min: 10_000, tier: "maintainer" },
  { min: 3_000, tier: "senior" },
  { min: 500, tier: "analyst" },
  { min: 100, tier: "member" },
  { min: 0, tier: "newcomer" },
];

const VOTE_WEIGHT_PER_POINTS = 1000;
const VOTE_WEIGHT_CAP = 5;

export function tierFromPoints(total_points: number): Tier {
  const points = Math.max(0, total_points);
  for (const band of TIER_BANDS) {
    if (points >= band.min) return band.tier;
  }
  // Unreachable — last band is 0; defensive default.
  return "newcomer";
}

/**
 * Vote weight scales with voter reputation. Per Stack Overflow's
 * "rep gives trust" pattern: a Newcomer's vote counts 1, an Analyst's
 * counts 3, a Maintainer's counts 5. Higher-rep votes lift a proposal
 * out of the noise floor faster.
 */
export function voteWeightFromPoints(total_points: number): number {
  const base = 1 + Math.floor(Math.max(0, total_points) / VOTE_WEIGHT_PER_POINTS);
  return Math.min(VOTE_WEIGHT_CAP, base);
}

export const POINT_EVENT_KINDS = [
  "prediction_resolved",
  "proposal_vote_received",
  "proposal_applied",
  "reply_upvote",
  "manual_grant",
] as const;
export type PointEventKind = (typeof POINT_EVENT_KINDS)[number];

/**
 * Atomically write a PointEvent + bump UserReputation in one txn.
 * Caller passes an already-open `tx` (so this composes inside a
 * larger mutation, e.g. vote-toggle); we don't open a new
 * transaction here.
 *
 * `amount` is signed — pass negative on revocation (e.g. proposal
 * vote toggle-off). Re-deriving tier on every write is cheap and
 * guarantees the denormalized `tier` column never drifts.
 */
export async function recordPointDelta(
  tx: Prisma.TransactionClient,
  params: {
    user_id: string;
    kind: PointEventKind;
    amount: number;
    refers_to_kind?: string | null;
    refers_to_id?: string | null;
  },
): Promise<{ total_points: number; tier: Tier }> {
  if (params.amount === 0) {
    // No-op write would clutter the ledger. Fetch current state and bail.
    const cur = await tx.userReputation.findUnique({
      where: { user_id: params.user_id },
      select: { total_points: true, tier: true },
    });
    return {
      total_points: cur?.total_points ?? 0,
      tier: (cur?.tier as Tier) ?? "newcomer",
    };
  }

  await tx.pointEvent.create({
    data: {
      user_id: params.user_id,
      kind: params.kind,
      amount: params.amount,
      refers_to_kind: params.refers_to_kind ?? null,
      refers_to_id: params.refers_to_id ?? null,
    },
  });
  // Upsert UserReputation. On insert, total_points = amount; on
  // update, increment by amount (signed). Then recompute tier in a
  // follow-up update so we hit a single row and stay consistent.
  await tx.userReputation.upsert({
    where: { user_id: params.user_id },
    create: {
      user_id: params.user_id,
      total_points: params.amount,
      tier: tierFromPoints(params.amount),
    },
    update: {
      total_points: { increment: params.amount },
    },
  });
  const refreshed = await tx.userReputation.findUnique({
    where: { user_id: params.user_id },
    select: { total_points: true, tier: true },
  });
  const newTotal = refreshed?.total_points ?? params.amount;
  const newTier = tierFromPoints(newTotal);
  if (refreshed?.tier !== newTier) {
    await tx.userReputation.update({
      where: { user_id: params.user_id },
      data: { tier: newTier },
    });
  }
  return { total_points: newTotal, tier: newTier };
}

/**
 * Read the voter's reputation in a tx without writing. Used by the
 * vote-toggle handler to derive the weight at vote time.
 *
 * Falls back to a synthetic { total_points: 0, tier: 'newcomer' }
 * row when the user has no reputation yet — they're still allowed
 * to vote, just at weight=1.
 */
export async function readReputation(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  user_id: string,
): Promise<{ total_points: number; tier: Tier }> {
  const r = await prismaOrTx.userReputation.findUnique({
    where: { user_id },
    select: { total_points: true, tier: true },
  });
  return {
    total_points: r?.total_points ?? 0,
    tier: (r?.tier as Tier) ?? "newcomer",
  };
}
