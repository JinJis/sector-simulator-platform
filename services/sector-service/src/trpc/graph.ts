/**
 * `graph.*` procedures — CRUD over the causal-graph topology stored in
 * `graph_nodes` + `graph_edges`. The Python `SimGraph` literal is still
 * the *bootstrap* source (one-time seed via `seed-graph.ts`) but
 * thereafter the DB is authoritative — every read on the user app's
 * `/sectors/[slug]/graph` page goes through `graph.get`, and the
 * upcoming graph editor (M7+) writes back through `upsertNode` /
 * `upsertEdge` / `delete*` mutations.
 *
 * Every mutation writes an `audit_logs` row so we can attribute edits
 * once auth lands. Free-form `author_label` defaults to "anonymous"
 * for now.
 *
 * Milestone 9 will wire `weight` into the Python sim at choke points;
 * for milestone 7 the math layer ignores it (still default 1.0 for
 * every seeded edge), so editing it is a no-op on outputs — only the
 * topology + UI shape change.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { simFetch } from "../lib/sim-proxy.js";
import type { Context } from "./context.js";
import { publicProcedure, router } from "./init.js";

const MAGNITUDE_WEIGHT = { low: 0.5, med: 1.0, high: 2.0 } as const;

interface UpstreamNode {
  id: string;
  label: string;
  kind: string;
  group: string;
  unit: string;
  description: string;
}

interface UpstreamEdge {
  source: string;
  target: string;
  label: string;
}

interface UpstreamGraph {
  nodes: UpstreamNode[];
  edges: UpstreamEdge[];
}

interface SeedDriverLink {
  driver: string;
  sign: "+" | "-";
  magnitude: "low" | "med" | "high";
  note?: string;
}

function equityNodeKey(ticker: string, exchange: string): string {
  return `equity_${ticker.replace(/[^A-Za-z0-9]/g, "_")}_${exchange}`.toUpperCase();
}

/**
 * Rebuild a sector's graph from its authoritative sources:
 *   1. The Python `SimGraph` literal (via simulation-service)
 *   2. SectorEquity rows + their `driver_links` JSONB
 *
 * Inlines the logic from `packages/db/prisma/seed-graph.ts` and
 * `seed-graph-equities.ts` so the user can hit "Reset" from the UI
 * without shelling out to a `pnpm db:seed:graph*` command.
 */
async function rebootstrapGraph(
  ctx: Context,
  sector_slug: string,
): Promise<{ nodes: number; edges: number; equity_nodes: number; equity_edges: number; skipped_driver_misses: number }> {
  // 1. Wipe everything first so we don't end up with orphan edges
  // pointing at nodes that no longer exist.
  await ctx.prisma.$transaction([
    ctx.prisma.graphEdge.deleteMany({ where: { sector_slug } }),
    ctx.prisma.graphNode.deleteMany({ where: { sector_slug } }),
  ]);

  // 2. Fetch the Python SimGraph and upsert nodes + edges.
  const upstream = await simFetch<UpstreamGraph>(`/sims/${sector_slug}/graph`, {
    context: `graph.rebootstrap:${sector_slug}`,
  });

  let nodeCount = 0;
  for (const n of upstream.nodes) {
    await ctx.prisma.graphNode.create({
      data: {
        sector_slug,
        node_key: n.id,
        kind: n.kind,
        label: n.label,
        group: n.group,
        unit: n.unit || null,
        description: n.description || null,
      },
    });
    nodeCount += 1;
  }

  let edgeCount = 0;
  for (const e of upstream.edges) {
    await ctx.prisma.graphEdge.create({
      data: {
        sector_slug,
        source_key: e.source,
        target_key: e.target,
        label: e.label || null,
        weight: 1.0,
        magnitude: "med",
        origin: "seed",
      },
    });
    edgeCount += 1;
  }

  // 3. Promote SectorEquity rows to graph nodes + driver-link edges.
  const equities = await ctx.prisma.sectorEquity.findMany({
    where: { sector_slug },
    select: {
      id: true,
      ticker: true,
      exchange: true,
      company_name: true,
      company_name_local: true,
      iso_country: true,
      driver_links: true,
    },
    orderBy: { display_order: "asc" },
  });

  // Pre-fetch driver node keys so we can skip dangling driver_links.
  const driverNodes = await ctx.prisma.graphNode.findMany({
    where: { sector_slug, kind: "driver" },
    select: { node_key: true },
  });
  const driverKeys = new Set(driverNodes.map((n) => n.node_key));

  let equityNodes = 0;
  let equityEdges = 0;
  let skippedDriverMisses = 0;
  for (const eq of equities) {
    const nodeKey = equityNodeKey(eq.ticker, eq.exchange);
    const label = eq.company_name_local
      ? `${eq.ticker} · ${eq.company_name_local}`
      : `${eq.ticker} · ${eq.company_name}`;

    await ctx.prisma.graphNode.create({
      data: {
        sector_slug,
        node_key: nodeKey,
        kind: "equity",
        label,
        group: "Equities",
        unit: null,
        description: `${eq.company_name} (${eq.iso_country})`,
        equity_id: eq.id,
      },
    });
    equityNodes += 1;

    const links = (eq.driver_links ?? []) as unknown as SeedDriverLink[];
    for (const link of links) {
      if (!driverKeys.has(link.driver)) {
        skippedDriverMisses += 1;
        continue;
      }
      const sign = link.sign === "-" ? -1 : 1;
      const weight = sign * MAGNITUDE_WEIGHT[link.magnitude];
      await ctx.prisma.graphEdge.create({
        data: {
          sector_slug,
          source_key: link.driver,
          target_key: nodeKey,
          label: link.note ?? null,
          weight,
          magnitude: link.magnitude,
          origin: "seed",
        },
      });
      equityEdges += 1;
    }
  }

  return {
    nodes: nodeCount,
    edges: edgeCount,
    equity_nodes: equityNodes,
    equity_edges: equityEdges,
    skipped_driver_misses: skippedDriverMisses,
  };
}

// ---------- Schemas ----------

const NodeKind = z.enum(["driver", "intermediate", "output", "equity"]);
const Magnitude = z.enum(["low", "med", "high"]);
const Origin = z.enum(["seed", "edit", "agent"]);

const GraphNodeOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  node_key: z.string(),
  kind: z.string(),
  label: z.string(),
  group: z.string(),
  unit: z.string().nullable(),
  description: z.string().nullable(),
  position_x: z.number().nullable(),
  position_y: z.number().nullable(),
  equity_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const GraphEdgeOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  source_key: z.string(),
  target_key: z.string(),
  label: z.string().nullable(),
  weight: z.number(),
  magnitude: z.string(),
  origin: z.string(),
  author_label: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const GraphResponse = z.object({
  sector_slug: z.string(),
  nodes: z.array(GraphNodeOut),
  edges: z.array(GraphEdgeOut),
});

const SlugInput = z.object({ sector_slug: z.string().min(1) });

const UpsertNodeInput = z.object({
  sector_slug: z.string().min(1),
  node_key: z.string().min(1).max(120),
  kind: NodeKind,
  label: z.string().min(1).max(200),
  group: z.string().max(120).default(""),
  unit: z.string().max(40).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  position_x: z.number().nullable().optional(),
  position_y: z.number().nullable().optional(),
  equity_id: z.string().nullable().optional(),
  author_label: z.string().max(120).optional(),
});

const NodeKeyInput = z.object({
  sector_slug: z.string().min(1),
  node_key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

const UpsertEdgeInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  weight: z.number().finite().min(-10).max(10).default(1.0),
  magnitude: Magnitude.default("med"),
  label: z.string().max(200).nullable().optional(),
  origin: Origin.default("edit"),
  author_label: z.string().max(120).optional(),
});

const EdgeKeyInput = z.object({
  sector_slug: z.string().min(1),
  source_key: z.string().min(1),
  target_key: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

const ResetInput = z.object({
  sector_slug: z.string().min(1),
  author_label: z.string().max(120).optional(),
});

// ---------- Helpers ----------

async function logAudit(
  ctx: Context,
  action: string,
  sector_slug: string,
  payload: unknown,
  author_label?: string,
): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      action,
      sector_slug,
      payload: payload as object,
      author_label: author_label ?? "anonymous",
    },
  });
}

// ---------- Procedures ----------

export const graphRouter = router({
  get: publicProcedure
    .input(SlugInput)
    .output(GraphResponse)
    .query(async ({ ctx, input }) => {
      const [nodes, edges] = await Promise.all([
        ctx.prisma.graphNode.findMany({
          where: { sector_slug: input.sector_slug },
          orderBy: [{ kind: "asc" }, { group: "asc" }, { node_key: "asc" }],
        }),
        ctx.prisma.graphEdge.findMany({
          where: { sector_slug: input.sector_slug },
          orderBy: [{ source_key: "asc" }, { target_key: "asc" }],
        }),
      ]);
      return {
        sector_slug: input.sector_slug,
        nodes: nodes as z.infer<typeof GraphNodeOut>[],
        edges: edges as z.infer<typeof GraphEdgeOut>[],
      };
    }),

  upsertNode: publicProcedure
    .input(UpsertNodeInput)
    .output(GraphNodeOut)
    .mutation(async ({ ctx, input }) => {
      const { author_label, sector_slug, node_key, equity_id, ...common } = input;

      // Guard against orphan equity_id references.
      if (input.kind === "equity" && equity_id) {
        const eq = await ctx.prisma.sectorEquity.findUnique({ where: { id: equity_id } });
        if (!eq) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `equity ${equity_id} does not exist`,
          });
        }
      }

      const row = await ctx.prisma.graphNode.upsert({
        where: { sector_slug_node_key: { sector_slug, node_key } },
        update: {
          ...common,
          equity_id: equity_id ?? null,
        },
        create: {
          sector_slug,
          node_key,
          ...common,
          unit: common.unit ?? null,
          description: common.description ?? null,
          equity_id: equity_id ?? null,
        },
      });
      await logAudit(ctx, "graph.upsertNode", sector_slug, input, author_label);
      return row as z.infer<typeof GraphNodeOut>;
    }),

  deleteNode: publicProcedure
    .input(NodeKeyInput)
    .output(z.object({ sector_slug: z.string(), node_key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Guard: refuse to delete a node that still has inbound or outbound
      // edges — the editor should require the user to clean those up
      // first so we don't silently strand mathematics.
      const referencingEdges = await ctx.prisma.graphEdge.count({
        where: {
          sector_slug: input.sector_slug,
          OR: [{ source_key: input.node_key }, { target_key: input.node_key }],
        },
      });
      if (referencingEdges > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `node ${input.node_key} has ${referencingEdges} attached edges — delete those first`,
        });
      }
      try {
        await ctx.prisma.graphNode.delete({
          where: {
            sector_slug_node_key: {
              sector_slug: input.sector_slug,
              node_key: input.node_key,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `node ${input.node_key} in ${input.sector_slug}`,
          });
        }
        throw e;
      }
      await logAudit(ctx, "graph.deleteNode", input.sector_slug, input, input.author_label);
      return { sector_slug: input.sector_slug, node_key: input.node_key };
    }),

  upsertEdge: publicProcedure
    .input(UpsertEdgeInput)
    .output(GraphEdgeOut)
    .mutation(async ({ ctx, input }) => {
      // Guard: both endpoints must exist as nodes in the same sector.
      const endpoints = await ctx.prisma.graphNode.findMany({
        where: {
          sector_slug: input.sector_slug,
          node_key: { in: [input.source_key, input.target_key] },
        },
        select: { node_key: true },
      });
      const present = new Set(endpoints.map((n) => n.node_key));
      const missing: string[] = [];
      if (!present.has(input.source_key)) missing.push(input.source_key);
      if (!present.has(input.target_key)) missing.push(input.target_key);
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `node(s) not found in ${input.sector_slug}: ${missing.join(", ")}`,
        });
      }

      const { author_label, sector_slug, source_key, target_key, ...common } = input;
      const row = await ctx.prisma.graphEdge.upsert({
        where: {
          sector_slug_source_key_target_key: {
            sector_slug,
            source_key,
            target_key,
          },
        },
        update: {
          weight: common.weight,
          magnitude: common.magnitude,
          label: common.label ?? null,
          origin: common.origin,
          author_label: author_label ?? null,
        },
        create: {
          sector_slug,
          source_key,
          target_key,
          weight: common.weight,
          magnitude: common.magnitude,
          label: common.label ?? null,
          origin: common.origin,
          author_label: author_label ?? null,
        },
      });
      await logAudit(ctx, "graph.upsertEdge", sector_slug, input, author_label);
      return row as z.infer<typeof GraphEdgeOut>;
    }),

  deleteEdge: publicProcedure
    .input(EdgeKeyInput)
    .output(z.object({ sector_slug: z.string(), source_key: z.string(), target_key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.prisma.graphEdge.delete({
          where: {
            sector_slug_source_key_target_key: {
              sector_slug: input.sector_slug,
              source_key: input.source_key,
              target_key: input.target_key,
            },
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `edge ${input.source_key} → ${input.target_key} in ${input.sector_slug}`,
          });
        }
        throw e;
      }
      await logAudit(ctx, "graph.deleteEdge", input.sector_slug, input, input.author_label);
      return {
        sector_slug: input.sector_slug,
        source_key: input.source_key,
        target_key: input.target_key,
      };
    }),

  resetToDefaults: publicProcedure
    .input(ResetInput)
    .output(
      z.object({
        sector_slug: z.string(),
        nodes: z.number(),
        edges: z.number(),
        equity_nodes: z.number(),
        equity_edges: z.number(),
        skipped_driver_misses: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // M13: full reset = wipe + re-bootstrap from authoritative sources.
      // 1. simulation-service GET /sims/{slug}/graph (Python SimGraph
      //    literal) → driver/intermediate/output nodes + neutral edges
      // 2. SectorEquity rows + driver_links JSONB → equity nodes +
      //    driver→equity edges with sign × magnitude weights
      // Single tRPC mutation so the UI can offer a "Reset graph" button.
      const stats = await rebootstrapGraph(ctx, input.sector_slug);
      await logAudit(
        ctx,
        "graph.resetToDefaults",
        input.sector_slug,
        stats,
        input.author_label,
      );
      return {
        sector_slug: input.sector_slug,
        ...stats,
      };
    }),

  /**
   * Convenience wipe — leaves the sector with 0 nodes + edges. The user
   * has to re-run reset (or `pnpm db:seed:graph`) to get back to a
   * populated state. Mostly here for tests + admin operations.
   */
  wipe: publicProcedure
    .input(ResetInput)
    .output(z.object({ sector_slug: z.string(), nodes_deleted: z.number(), edges_deleted: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [edges, nodes] = await ctx.prisma.$transaction([
        ctx.prisma.graphEdge.deleteMany({ where: { sector_slug: input.sector_slug } }),
        ctx.prisma.graphNode.deleteMany({ where: { sector_slug: input.sector_slug } }),
      ]);
      await logAudit(
        ctx,
        "graph.wipe",
        input.sector_slug,
        { nodes_deleted: nodes.count, edges_deleted: edges.count },
        input.author_label,
      );
      return {
        sector_slug: input.sector_slug,
        nodes_deleted: nodes.count,
        edges_deleted: edges.count,
      };
    }),
});
