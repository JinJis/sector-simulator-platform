/**
 * Zod schemas backing the `communityProposal.*` tRPC procedures
 * (M46a Community 3.0).
 *
 * Lifted out of `community-proposal.ts` so the router file can focus
 * on procedure wiring + Prisma queries + rate-limiting. Types are
 * still inferred via `z.infer<typeof X>` where needed; consumers in
 * `apps/web` read them through tRPC's `AppRouter` inference, so this
 * extraction is internal-only.
 */

import { z } from "zod";

// What kinds of element can be proposed. Each is wired in M46e to a
// per-kind applier that validates `proposed_payload` and writes the DB
// row. Keep this list narrow — every new kind is admin surface.
export const TargetKind = z.enum([
  "add_driver",
  "add_equity",
  "add_capability",
  "add_risk",
  "add_actor",
  "add_signal_source",
  "edit",
  "other",
]);

export const ProposalStatus = z.enum([
  "open",
  "review",
  "applied",
  "rejected",
  "stale",
]);

// Evidence as accepted by `create`. v1 only handles text + URL passthrough
// (the OG fetcher / R2 upload lands in M46d).
export const EvidenceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    content: z.string().min(1).max(8000),
  }),
  z.object({
    kind: z.literal("url"),
    content: z.string().url().max(2000),
  }),
]);

export const EvidenceOut = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string(),
  fetched_meta: z.unknown().nullable(),
  order_index: z.number().int(),
  created_at: z.date(),
});

export const AuthorOut = z.object({
  id: z.string(),
  label: z.string(),
  // M50 — true when the proposal was authored by @feasibility_bot or
  // any future bot account. ProposalCard reads this to render the
  // gradient border + ✨ chip + "How this was drafted" drawer.
  is_bot: z.boolean(),
  bot_kind: z.string().nullable(),
});

export const ProposalSummary = z.object({
  id: z.string(),
  sector_slug: z.string(),
  target_kind: z.string(),
  target_ref: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  vote_score: z.number().int(),
  evidence_count: z.number().int(),
  reply_count: z.number().int(),
  author: AuthorOut,
  /** True when the requesting user has already voted. False for anonymous. */
  viewer_voted: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const ProposalDetail = ProposalSummary.extend({
  body: z.string(),
  proposed_payload: z.unknown(),
  evidence: z.array(EvidenceOut),
  decided_at: z.date().nullable(),
  decided_by: AuthorOut.nullable(),
  decision_reason: z.string().nullable(),
});
