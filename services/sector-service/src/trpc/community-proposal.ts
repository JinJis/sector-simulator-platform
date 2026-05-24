/**
 * `communityProposal.*` — M46a Community 3.0 proposals.
 *
 * Users propose enrichments to a sector/vision: a new driver, equity,
 * capability, risk, actor, or signal source. Each proposal carries
 * structured `proposed_payload` (the M46e applier validates per-kind +
 * writes the target row) and multi-source evidence (M46d will add the
 * URL/PDF/image fetcher; this slice ships text evidence + URL string
 * passthrough).
 *
 * Auth model in M46a (M46c upgrades it):
 *   - list/get: public
 *   - create/vote: require ctx.user (logged-in)
 *   - admin actions (status transitions, decision_reason): land in M46e
 *
 * Rate limiting: newcomers (M46c will define) are capped at 3 proposals/
 * day. Until M46c lands the cap is enforced as 3 per logged-in user per
 * UTC day — simplest defensible default.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// ============ Schemas ===================================================

// What kinds of element can be proposed. Each is wired in M46e to a
// per-kind applier that validates `proposed_payload` and writes the DB
// row. Keep this list narrow — every new kind is admin surface.
const TargetKind = z.enum([
  "add_driver",
  "add_equity",
  "add_capability",
  "add_risk",
  "add_actor",
  "add_signal_source",
  "edit",
  "other",
]);

const ProposalStatus = z.enum([
  "open",
  "review",
  "applied",
  "rejected",
  "stale",
]);

// Evidence as accepted by `create`. v1 only handles text + URL passthrough
// (the OG fetcher / R2 upload lands in M46d).
const EvidenceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    content: z.string().min(1).max(8000),
  }),
  z.object({
    kind: z.literal("url"),
    content: z.string().url().max(2000),
  }),
]);

const EvidenceOut = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string(),
  fetched_meta: z.unknown().nullable(),
  order_index: z.number().int(),
  created_at: z.date(),
});

const AuthorOut = z.object({
  id: z.string(),
  label: z.string(),
});

const ProposalSummary = z.object({
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

const ProposalDetail = ProposalSummary.extend({
  body: z.string(),
  proposed_payload: z.unknown(),
  evidence: z.array(EvidenceOut),
  decided_at: z.date().nullable(),
  decided_by: AuthorOut.nullable(),
  decision_reason: z.string().nullable(),
});

// ============ Helpers ===================================================

function authorLabel(user: {
  id: string;
  name: string | null;
  email: string;
} | null | undefined): { id: string; label: string } {
  if (!user) return { id: "anonymous", label: "anonymous" };
  return { id: user.id, label: user.name ?? user.email };
}

const DAILY_PROPOSAL_CAP_DEFAULT = 3;

async function enforceRateLimit(ctx: {
  prisma: typeof import("@platform/db").prisma;
}, userId: string, cap = DAILY_PROPOSAL_CAP_DEFAULT): Promise<void> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const todayCount = await ctx.prisma.communityProposal.count({
    where: { author_id: userId, created_at: { gte: since } },
  });
  if (todayCount >= cap) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Daily proposal cap reached (${cap}). Try again tomorrow.`,
    });
  }
}

// ============ Router ====================================================

export const communityProposalRouter = router({
  /**
   * Feed listing. Hot (vote_score desc) or New (created_at desc), with
   * optional sector + status filters. Pagination via `cursor` (last id
   * from prior page).
   *
   * `viewer_voted` is computed in one round-trip via a single IN-query
   * on ProposalVote — avoids N+1 across the feed.
   */
  list: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().optional(),
        status: ProposalStatus.optional(),
        sort: z.enum(["hot", "new"]).default("hot"),
        limit: z.number().int().positive().max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        rows: z.array(ProposalSummary),
        next_cursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: {
        sector_slug?: string;
        status?: string;
      } = {};
      if (input.sector_slug) where.sector_slug = input.sector_slug;
      if (input.status) where.status = input.status;
      // Default feed hides applied/rejected/stale unless caller asks
      // explicitly — most users want to see what's actually under debate.
      if (!input.status) where.status = "open";

      const orderBy =
        input.sort === "hot"
          ? [{ vote_score: "desc" as const }, { created_at: "desc" as const }]
          : [{ created_at: "desc" as const }];

      const rows = await ctx.prisma.communityProposal.findMany({
        where,
        orderBy,
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : {}),
        include: {
          author: { select: { id: true, name: true, email: true } },
          _count: { select: { evidence: true, replies: true } },
        },
      });

      const hasMore = rows.length > input.limit;
      const slice = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? (slice[slice.length - 1]?.id ?? null) : null;

      // viewer_voted: single IN query for the page slice.
      let votedSet = new Set<string>();
      if (ctx.user && slice.length > 0) {
        const votes = await ctx.prisma.proposalVote.findMany({
          where: {
            user_id: ctx.user.id,
            proposal_id: { in: slice.map((r) => r.id) },
          },
          select: { proposal_id: true },
        });
        votedSet = new Set(votes.map((v) => v.proposal_id));
      }

      return {
        rows: slice.map((r) => ({
          id: r.id,
          sector_slug: r.sector_slug,
          target_kind: r.target_kind,
          target_ref: r.target_ref,
          title: r.title,
          status: r.status,
          vote_score: r.vote_score,
          evidence_count: r._count.evidence,
          reply_count: r._count.replies,
          author: authorLabel(r.author),
          viewer_voted: votedSet.has(r.id),
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        next_cursor: nextCursor,
      };
    }),

  /**
   * Single-proposal detail with evidence + decision metadata.
   */
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(ProposalDetail)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.communityProposal.findUnique({
        where: { id: input.id },
        include: {
          author: { select: { id: true, name: true, email: true } },
          decided_by: { select: { id: true, name: true, email: true } },
          evidence: { orderBy: { order_index: "asc" } },
          _count: { select: { evidence: true, replies: true } },
        },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `proposal ${input.id}`,
        });
      }
      let viewerVoted = false;
      if (ctx.user) {
        const v = await ctx.prisma.proposalVote.findUnique({
          where: {
            proposal_id_user_id: {
              proposal_id: row.id,
              user_id: ctx.user.id,
            },
          },
          select: { proposal_id: true },
        });
        viewerVoted = v !== null;
      }
      return {
        id: row.id,
        sector_slug: row.sector_slug,
        target_kind: row.target_kind,
        target_ref: row.target_ref,
        title: row.title,
        status: row.status,
        vote_score: row.vote_score,
        evidence_count: row._count.evidence,
        reply_count: row._count.replies,
        author: authorLabel(row.author),
        viewer_voted: viewerVoted,
        body: row.body,
        proposed_payload: row.proposed_payload,
        evidence: row.evidence.map((e) => ({
          id: e.id,
          kind: e.kind,
          content: e.content,
          fetched_meta: e.fetched_meta,
          order_index: e.order_index,
          created_at: e.created_at,
        })),
        decided_at: row.decided_at,
        decided_by: row.decided_by ? authorLabel(row.decided_by) : null,
        decision_reason: row.decision_reason,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }),

  /**
   * Create a new proposal. Requires a logged-in user; enforces the
   * daily cap. Wraps the proposal + evidence rows in a single
   * transaction so a half-inserted proposal can never surface in
   * `list`.
   */
  create: publicProcedure
    .input(
      z.object({
        sector_slug: z.string().min(1),
        target_kind: TargetKind,
        target_ref: z.string().max(120).nullable().optional(),
        title: z.string().min(5).max(160),
        body: z.string().min(20).max(8000),
        proposed_payload: z.unknown(),
        evidence: z.array(EvidenceInput).max(20).default([]),
      }),
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to propose changes",
        });
      }
      // Verify the sector exists — proposals point at a real row.
      const sector = await ctx.prisma.sector.findUnique({
        where: { slug: input.sector_slug },
        select: { slug: true },
      });
      if (!sector) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `sector ${input.sector_slug}`,
        });
      }

      await enforceRateLimit(ctx, ctx.user.id);

      const created = await ctx.prisma.$transaction(async (tx) => {
        const p = await tx.communityProposal.create({
          data: {
            author_id: ctx.user!.id,
            sector_slug: input.sector_slug,
            target_kind: input.target_kind,
            target_ref: input.target_ref ?? null,
            title: input.title,
            body: input.body,
            // Cast intentional: tRPC unknown → Prisma JSON. The M46e
            // applier validates per-kind before any DB write.
            proposed_payload: (input.proposed_payload ?? {}) as object,
          },
        });
        if (input.evidence.length > 0) {
          await tx.proposalEvidence.createMany({
            data: input.evidence.map((e, i) => ({
              proposal_id: p.id,
              kind: e.kind,
              content: e.content,
              order_index: i,
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            action: "community_proposal.create",
            sector_slug: input.sector_slug,
            payload: {
              id: p.id,
              target_kind: input.target_kind,
              evidence_count: input.evidence.length,
            },
            author_label: ctx.user!.label,
          },
        });
        return p;
      });
      return { id: created.id };
    }),

  /**
   * Toggle vote. Insert if absent, delete if present. Both branches
   * update `vote_score` in the same transaction so feed sorting stays
   * correct.
   *
   * M46c will replace the `weight: 1` literal with the voter's
   * reputation-derived weight.
   */
  vote: publicProcedure
    .input(z.object({ proposal_id: z.string().min(1) }))
    .output(
      z.object({
        voted: z.boolean(),
        vote_score: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in to vote",
        });
      }
      const userId = ctx.user.id;
      const result = await ctx.prisma.$transaction(async (tx) => {
        const existing = await tx.proposalVote.findUnique({
          where: {
            proposal_id_user_id: {
              proposal_id: input.proposal_id,
              user_id: userId,
            },
          },
        });
        if (existing) {
          await tx.proposalVote.delete({
            where: {
              proposal_id_user_id: {
                proposal_id: input.proposal_id,
                user_id: userId,
              },
            },
          });
          const updated = await tx.communityProposal.update({
            where: { id: input.proposal_id },
            data: { vote_score: { decrement: existing.weight } },
            select: { vote_score: true },
          });
          return { voted: false, vote_score: updated.vote_score };
        } else {
          // Confirm the proposal exists before write — avoid a phantom
          // ProposalVote row pointing at a deleted proposal (Cascade
          // would clean it up, but the error message here is nicer).
          const exists = await tx.communityProposal.findUnique({
            where: { id: input.proposal_id },
            select: { id: true },
          });
          if (!exists) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `proposal ${input.proposal_id}`,
            });
          }
          const weight = 1; // M46c upgrades to reputation-weighted
          await tx.proposalVote.create({
            data: {
              proposal_id: input.proposal_id,
              user_id: userId,
              weight,
            },
          });
          const updated = await tx.communityProposal.update({
            where: { id: input.proposal_id },
            data: { vote_score: { increment: weight } },
            select: { vote_score: true },
          });
          return { voted: true, vote_score: updated.vote_score };
        }
      });
      return result;
    }),
});
