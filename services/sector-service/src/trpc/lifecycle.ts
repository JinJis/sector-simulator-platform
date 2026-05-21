/**
 * `lifecycle.*` procedures — periodic deprecation/renewal review.
 *
 * Hard rule from CLAUDE.md / user feedback: **never auto**. The
 * procedures here detect *candidates* and accept a user decision per
 * candidate. Every decision writes an `audit_logs` row with the
 * `lifecycle.<category>.<action>` action, so the full review history
 * is durable.
 *
 * Categories detected (M18 first cut):
 *   1. `equity.stale_price`     — `sector_equities` whose most recent
 *                                 `equity_quotes.trade_date` is older
 *                                 than `equity_stale_days` (default 14).
 *   2. `graph_node.orphan`      — `graph_nodes` with zero incoming +
 *                                 outgoing edges in `graph_edges`.
 *   3. `graph_edge.neutral`     — `graph_edges` whose weight has stayed
 *                                 at exactly 1.0 since the seed-bootstrap
 *                                 (origin = "seed", magnitude = "med").
 *   4. `sector.cold`            — sectors with no scenarios saved in
 *                                 the last `sector_cold_days` (default 90).
 *
 * Defers are honored via a `lifecycle.*.defer` audit_log row whose
 * payload carries `deferred_until` ISO timestamp; candidates whose
 * deferral is still active are filtered out here.
 *
 * Actions:
 *   - `keep`               → log only ("reviewed, leave as-is")
 *   - `defer`              → log + carry `deferred_until` so we skip
 *                            for N days
 *   - `approve_deprecate`  → log + soft-delete where applicable. For
 *                            edges, deletes the row. Equities and
 *                            sectors stay (we don't auto-delete first-
 *                            class entities yet).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

// Category strings are stable — the audit_log actions reference them.
const CATEGORIES = [
  "equity.stale_price",
  "graph_node.orphan",
  "graph_edge.neutral",
  "sector.cold",
] as const;
type Category = (typeof CATEGORIES)[number];

const Action = z.enum(["keep", "defer", "approve_deprecate"]);

const Candidate = z.object({
  category: z.enum(CATEGORIES),
  /**
   * Stable identifier for this candidate within its category. For
   * equities/edges/sectors the natural PK; for graph nodes the
   * `(sector_slug, node_key)` composite encoded as `slug/key`.
   */
  ref_id: z.string(),
  sector_slug: z.string().nullable(),
  label: z.string(),
  /** Short human reason — "no quote in 21 days", "no inbound edges", ... */
  reason: z.string(),
  /** Free-form metadata payload — UI renders some chips off this. */
  detail: z.record(z.unknown()).default({}),
});

const CandidatesInput = z
  .object({
    equity_stale_days: z.number().int().positive().max(365).default(14),
    sector_cold_days: z.number().int().positive().max(730).default(90),
  })
  .default({});

const ReviewInput = z.object({
  category: z.enum(CATEGORIES),
  ref_id: z.string().min(1),
  sector_slug: z.string().nullable().optional(),
  action: Action,
  /** Required for defer. ISO datetime. */
  defer_until: z.string().datetime().optional(),
  reason: z.string().max(2000).optional(),
  author_label: z.string().max(120).optional(),
});

interface DeferralLookup {
  category: Category;
  ref_id: string;
  defer_until: Date;
}

async function loadActiveDeferrals(
  ctx: { prisma: import("@platform/db").PrismaClient },
): Promise<Map<string, Date>> {
  // Pull every defer-style lifecycle audit row written in the last N
  // days (long enough to cover the max defer window we issue today).
  // Keyed by `category::ref_id` → latest `defer_until` date.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  const rows = await ctx.prisma.auditLog.findMany({
    where: {
      action: { startsWith: "lifecycle." },
      created_at: { gte: since },
    },
    orderBy: { created_at: "asc" },
    select: { action: true, payload: true, created_at: true },
  });

  const now = Date.now();
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (!r.action.endsWith(".defer")) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const category = String(p.category ?? "");
    const ref_id = String(p.ref_id ?? "");
    const defer = String(p.defer_until ?? "");
    if (!category || !ref_id || !defer) continue;
    const until = new Date(defer);
    if (Number.isNaN(until.getTime())) continue;
    if (until.getTime() <= now) continue; // expired
    out.set(`${category}::${ref_id}`, until);
  }
  return out;
}

export const lifecycleRouter = router({
  candidates: publicProcedure
    .input(CandidatesInput)
    .output(
      z.object({
        generated_at: z.date(),
        candidates: z.array(Candidate),
        counts: z.record(z.number().int()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const deferrals = await loadActiveDeferrals(ctx);
      const candidates: z.infer<typeof Candidate>[] = [];

      // ---- 1. Stale-price equities ----
      const staleThreshold = new Date();
      staleThreshold.setUTCDate(
        staleThreshold.getUTCDate() - input.equity_stale_days,
      );
      const equities = await ctx.prisma.sectorEquity.findMany({
        select: {
          id: true,
          sector_slug: true,
          ticker: true,
          exchange: true,
          company_name: true,
          last_close_date: true,
        },
      });
      const latestQuoteByEquity = new Map<string, Date>();
      const latestRows = await ctx.prisma.equityQuote.groupBy({
        by: ["equity_id"],
        _max: { trade_date: true },
      });
      for (const r of latestRows) {
        if (r._max.trade_date) {
          latestQuoteByEquity.set(r.equity_id, r._max.trade_date);
        }
      }
      for (const eq of equities) {
        const latest = latestQuoteByEquity.get(eq.id) ?? eq.last_close_date;
        const ageDays = latest
          ? Math.floor((Date.now() - latest.getTime()) / 86_400_000)
          : null;
        const isStale = !latest || latest < staleThreshold;
        if (!isStale) continue;
        const key = `equity.stale_price::${eq.id}`;
        if (deferrals.has(key)) continue;
        candidates.push({
          category: "equity.stale_price",
          ref_id: eq.id,
          sector_slug: eq.sector_slug,
          label: `${eq.ticker} · ${eq.company_name}`,
          reason:
            latest === null
              ? "가격 히스토리가 한 번도 적재되지 않음"
              : `최근 가격 ${ageDays}일 전 (${latest.toISOString().slice(0, 10)})`,
          detail: {
            ticker: eq.ticker,
            exchange: eq.exchange,
            latest_quote: latest ? latest.toISOString().slice(0, 10) : null,
            age_days: ageDays,
          },
        });
      }

      // ---- 2. Orphan graph nodes ----
      const nodes = await ctx.prisma.graphNode.findMany({
        select: { sector_slug: true, node_key: true, kind: true, label: true },
      });
      const edgeRows = await ctx.prisma.graphEdge.findMany({
        select: { sector_slug: true, source_key: true, target_key: true },
      });
      const connected = new Set<string>();
      for (const e of edgeRows) {
        connected.add(`${e.sector_slug}::${e.source_key}`);
        connected.add(`${e.sector_slug}::${e.target_key}`);
      }
      for (const n of nodes) {
        const k = `${n.sector_slug}::${n.node_key}`;
        if (connected.has(k)) continue;
        const ref_id = `${n.sector_slug}/${n.node_key}`;
        const key = `graph_node.orphan::${ref_id}`;
        if (deferrals.has(key)) continue;
        candidates.push({
          category: "graph_node.orphan",
          ref_id,
          sector_slug: n.sector_slug,
          label: `${n.label} (${n.kind})`,
          reason: "incoming / outgoing edge 없음 — 모델에 영향 미치지 않음",
          detail: { node_key: n.node_key, kind: n.kind },
        });
      }

      // ---- 3. Neutral seeded edges (never touched) ----
      // Edge is "neutral & untouched" if origin='seed' AND weight==1.0
      // AND magnitude='med'. If a user touched the slider but landed
      // back at 1.0/med, origin would have been bumped to 'edit' by
      // upsertEdge, so this captures only edges that nobody has even
      // glanced at.
      const neutralEdges = await ctx.prisma.graphEdge.findMany({
        where: {
          origin: "seed",
          weight: 1.0,
          magnitude: "med",
        },
        select: {
          id: true,
          sector_slug: true,
          source_key: true,
          target_key: true,
          label: true,
        },
        take: 200, // hard cap so the UI doesn't drown on first run
      });
      for (const e of neutralEdges) {
        const key = `graph_edge.neutral::${e.id}`;
        if (deferrals.has(key)) continue;
        candidates.push({
          category: "graph_edge.neutral",
          ref_id: e.id,
          sector_slug: e.sector_slug,
          label: `${e.source_key} → ${e.target_key}`,
          reason: "weight=1.0, magnitude=med — 시드 이후 변경 없음",
          detail: {
            source_key: e.source_key,
            target_key: e.target_key,
            edge_label: e.label,
          },
        });
      }

      // ---- 4. Cold sectors (no scenario in N days) ----
      const coldThreshold = new Date();
      coldThreshold.setUTCDate(coldThreshold.getUTCDate() - input.sector_cold_days);
      const sectors = await ctx.prisma.sector.findMany({
        select: { slug: true, name: true },
      });
      const latestScenarioBySector = new Map<string, Date>();
      const scenarioRows = await ctx.prisma.scenario.groupBy({
        by: ["sector_slug"],
        _max: { updated_at: true },
      });
      for (const r of scenarioRows) {
        if (r._max.updated_at) {
          latestScenarioBySector.set(r.sector_slug, r._max.updated_at);
        }
      }
      for (const s of sectors) {
        const latest = latestScenarioBySector.get(s.slug);
        if (latest && latest >= coldThreshold) continue;
        const key = `sector.cold::${s.slug}`;
        if (deferrals.has(key)) continue;
        const ageDays = latest
          ? Math.floor((Date.now() - latest.getTime()) / 86_400_000)
          : null;
        candidates.push({
          category: "sector.cold",
          ref_id: s.slug,
          sector_slug: s.slug,
          label: s.name,
          reason: latest
            ? `최근 시나리오 저장 ${ageDays}일 전`
            : "저장된 시나리오가 없음",
          detail: {
            latest_scenario: latest ? latest.toISOString().slice(0, 10) : null,
            age_days: ageDays,
          },
        });
      }

      // Tally counts per category.
      const counts: Record<string, number> = {};
      for (const c of CATEGORIES) counts[c] = 0;
      for (const c of candidates) counts[c.category]! += 1;

      return {
        generated_at: new Date(),
        candidates,
        counts,
      };
    }),

  review: publicProcedure
    .input(ReviewInput)
    .output(
      z.object({
        audit_id: z.string(),
        applied_change: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === "defer" && !input.defer_until) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "defer requires defer_until (ISO datetime)",
        });
      }

      // For approve_deprecate on a graph edge, actually delete the row.
      // Other categories only log — soft-delete of equities / sectors
      // is intentionally not auto-applied (data-pipeline still ingests
      // them; an admin chooses to remove from `seed-equities.ts` later).
      let appliedChange = false;
      if (
        input.action === "approve_deprecate" &&
        input.category === "graph_edge.neutral"
      ) {
        try {
          await ctx.prisma.graphEdge.delete({ where: { id: input.ref_id } });
          appliedChange = true;
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            // already gone — still log
          } else {
            throw e;
          }
        }
      }

      const action = `lifecycle.${input.category}.${input.action}`;
      const audit = await ctx.prisma.auditLog.create({
        data: {
          action,
          sector_slug: input.sector_slug ?? null,
          payload: {
            category: input.category,
            ref_id: input.ref_id,
            action: input.action,
            defer_until: input.defer_until,
            reason: input.reason,
            applied_change: appliedChange,
          },
          author_label: input.author_label ?? "anonymous",
        },
      });

      return { audit_id: audit.id, applied_change: appliedChange };
    }),
});
