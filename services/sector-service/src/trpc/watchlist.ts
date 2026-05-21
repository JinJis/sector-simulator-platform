/**
 * `watchlist.*` procedures — per-user "관심 종목" list.
 *
 * Every procedure here is auth-required (UNAUTHORIZED when
 * `ctx.user` is missing). The previous mutations on the platform
 * accepted anonymous callers; watchlists explicitly don't because
 * the whole point is per-user state.
 *
 * Schema authoritative on `(user_id, equity_id)` unique — adding an
 * already-watched equity is idempotent (returns the existing row).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const WatchlistItemOut = z.object({
  id: z.string(),
  user_id: z.string(),
  equity_id: z.string(),
  note: z.string().nullable(),
  created_at: z.date(),
});

// Surface enough about the underlying equity that the /watchlist page
// can render without a separate equity lookup per row.
const WatchlistRowOut = WatchlistItemOut.extend({
  equity: z.object({
    id: z.string(),
    sector_slug: z.string(),
    ticker: z.string(),
    exchange: z.string(),
    iso_country: z.string(),
    company_name: z.string(),
    company_name_local: z.string().nullable(),
    currency: z.string().nullable(),
    last_close_local: z.number().nullable(),
    last_close_usd: z.number().nullable(),
    last_close_date: z.date().nullable(),
    market_cap_usd: z.number().nullable(),
  }),
});

const EquityIdInput = z.object({ equity_id: z.string().min(1) });

const AddInput = z.object({
  equity_id: z.string().min(1),
  note: z.string().max(500).optional(),
});

function requireUser(ctx: import("./context.js").Context) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "관심 종목 기능은 로그인이 필요합니다.",
    });
  }
  return ctx.user;
}

export const watchlistRouter = router({
  list: publicProcedure
    .output(z.array(WatchlistRowOut))
    .query(async ({ ctx }) => {
      const user = requireUser(ctx);
      const rows = await ctx.prisma.watchlistItem.findMany({
        where: { user_id: user.id },
        include: {
          equity: {
            select: {
              id: true,
              sector_slug: true,
              ticker: true,
              exchange: true,
              iso_country: true,
              company_name: true,
              company_name_local: true,
              currency: true,
              last_close_local: true,
              last_close_usd: true,
              last_close_date: true,
              market_cap_usd: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
      });
      return rows as z.infer<typeof WatchlistRowOut>[];
    }),

  /**
   * Lightweight check used by the `<WatchButton>` to choose between
   * "★ 관심 등록" and "★ 등록됨". Returns a boolean; never throws on
   * "not watched" since that's a normal state.
   */
  isWatched: publicProcedure
    .input(EquityIdInput)
    .output(z.object({ watched: z.boolean(), id: z.string().nullable() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) return { watched: false, id: null };
      const row = await ctx.prisma.watchlistItem.findUnique({
        where: {
          user_id_equity_id: {
            user_id: ctx.user.id,
            equity_id: input.equity_id,
          },
        },
        select: { id: true },
      });
      return { watched: !!row, id: row?.id ?? null };
    }),

  add: publicProcedure
    .input(AddInput)
    .output(WatchlistItemOut)
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      // Confirm the equity exists so a stale ticker doesn't end up as
      // a dangling row (FK would catch it too, but a clean 404 is
      // friendlier than a generic constraint error).
      const exists = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.equity_id },
        select: { id: true },
      });
      if (!exists) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `equity ${input.equity_id} not found`,
        });
      }
      // Idempotent — upsert returns either the existing or new row.
      const row = await ctx.prisma.watchlistItem.upsert({
        where: {
          user_id_equity_id: {
            user_id: user.id,
            equity_id: input.equity_id,
          },
        },
        create: {
          user_id: user.id,
          equity_id: input.equity_id,
          note: input.note ?? null,
        },
        update:
          input.note !== undefined ? { note: input.note ?? null } : {},
      });
      return row as z.infer<typeof WatchlistItemOut>;
    }),

  remove: publicProcedure
    .input(EquityIdInput)
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      try {
        await ctx.prisma.watchlistItem.delete({
          where: {
            user_id_equity_id: {
              user_id: user.id,
              equity_id: input.equity_id,
            },
          },
        });
      } catch (e) {
        // P2025 = "An operation failed because it depends on one or
        // more records that were required but not found." Idempotent
        // remove — treat as ok.
        if ((e as { code?: string }).code !== "P2025") throw e;
      }
      return { ok: true };
    }),
});
