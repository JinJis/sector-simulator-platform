/**
 * Equity nodes inside the causal graph — milestone 8.
 *
 * For every `SectorEquity` row this script:
 *
 *   1. Creates a `GraphNode(kind="equity")` keyed
 *      `equity_<TICKER>_<EXCHANGE>` with the equity's company name as
 *      label and `Equities` as the group.
 *   2. For every entry in the equity's `driver_links` JSONB, upserts a
 *      `GraphEdge` from that driver's node → the equity node. Weight is
 *      derived from `sign + magnitude` so the M9 graph-traversal impact
 *      reproduces the M1 impliedImpact score exactly:
 *
 *        magnitude_weight = {low: 0.5, med: 1.0, high: 2.0}
 *        weight = sign * magnitude_weight  // sign ∈ {+1, -1}
 *
 *      negative weight = inverse relationship; same |magnitude_weight|
 *      values as the editorial M1 formula in `equities-table.tsx`.
 *
 * Idempotent: re-runs upsert on the unique constraint
 * `(sector_slug, source_key, target_key)`. Edges that exist but no
 * longer appear in `driver_links` are *not* deleted — preserving any
 * future user-edited graph topology.
 *
 * Usage:
 *   pnpm db:seed:graph-equities          # all sectors
 *   pnpm db:seed:graph-equities <slug>   # one sector
 *
 * Runs after `seed-graph.ts` — the driver/intermediate/output nodes
 * must exist so the equity edges have valid source endpoints.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAGNITUDE_WEIGHT = { low: 0.5, med: 1.0, high: 2.0 } as const;

interface DriverLink {
  driver: string;
  sign: "+" | "-";
  magnitude: "low" | "med" | "high";
  note?: string;
}

function equityNodeKey(ticker: string, exchange: string): string {
  // Normalize: uppercase, replace any non-alphanumerics with `_` so
  // weird tickers like `BRK.B` stay safe in URLs / SQL identifiers.
  return `equity_${ticker.replace(/[^A-Za-z0-9]/g, "_")}_${exchange}`.toUpperCase();
}

function magnitudeFromLink(link: DriverLink): "low" | "med" | "high" {
  return link.magnitude;
}

function weightFromLink(link: DriverLink): number {
  const sign = link.sign === "-" ? -1 : 1;
  return sign * MAGNITUDE_WEIGHT[link.magnitude];
}

interface Stats {
  nodes_upserted: number;
  edges_upserted: number;
  edges_skipped_missing_driver: number;
}

async function seedSector(slug: string): Promise<Stats> {
  const stats: Stats = {
    nodes_upserted: 0,
    edges_upserted: 0,
    edges_skipped_missing_driver: 0,
  };

  const equities = await prisma.sectorEquity.findMany({
    where: { sector_slug: slug },
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
  if (equities.length === 0) {
    return stats;
  }

  // Pre-fetch existing driver-kind nodes for this sector so we can
  // reject edges whose source doesn't exist (typo in driver_links).
  const driverNodes = await prisma.graphNode.findMany({
    where: { sector_slug: slug, kind: "driver" },
    select: { node_key: true },
  });
  const driverKeys = new Set(driverNodes.map((n) => n.node_key));

  for (const eq of equities) {
    const nodeKey = equityNodeKey(eq.ticker, eq.exchange);
    const label = eq.company_name_local
      ? `${eq.ticker} · ${eq.company_name_local}`
      : `${eq.ticker} · ${eq.company_name}`;

    await prisma.graphNode.upsert({
      where: {
        sector_slug_node_key: { sector_slug: slug, node_key: nodeKey },
      },
      update: {
        kind: "equity",
        label,
        group: "Equities",
        unit: null,
        description: `${eq.company_name} (${eq.iso_country})`,
        equity_id: eq.id,
      },
      create: {
        sector_slug: slug,
        node_key: nodeKey,
        kind: "equity",
        label,
        group: "Equities",
        unit: null,
        description: `${eq.company_name} (${eq.iso_country})`,
        equity_id: eq.id,
      },
    });
    stats.nodes_upserted += 1;

    const links = (eq.driver_links ?? []) as unknown as DriverLink[];
    for (const link of links) {
      if (!driverKeys.has(link.driver)) {
        // The driver_links was hand-authored against driver names from
        // the Python sim — a typo or rename can drop the source here.
        // Log and skip rather than create an orphan edge.
        stats.edges_skipped_missing_driver += 1;
        continue;
      }
      const w = weightFromLink(link);
      const m = magnitudeFromLink(link);
      await prisma.graphEdge.upsert({
        where: {
          sector_slug_source_key_target_key: {
            sector_slug: slug,
            source_key: link.driver,
            target_key: nodeKey,
          },
        },
        update: {
          weight: w,
          magnitude: m,
          label: link.note ?? null,
        },
        create: {
          sector_slug: slug,
          source_key: link.driver,
          target_key: nodeKey,
          weight: w,
          magnitude: m,
          label: link.note ?? null,
          origin: "seed",
        },
      });
      stats.edges_upserted += 1;
    }
  }
  return stats;
}

async function main(): Promise<void> {
  const targetSlug = process.argv[2];
  const sectors = targetSlug
    ? [{ slug: targetSlug }]
    : await prisma.sector.findMany({ select: { slug: true }, orderBy: { slug: "asc" } });

  if (sectors.length === 0) {
    console.log("[seed-graph-equities] no sectors found — run pnpm db:seed first.");
    return;
  }

  console.log(
    `[seed-graph-equities] wiring equity nodes into graph for ${sectors.length} sector(s)…`,
  );
  let totalNodes = 0;
  let totalEdges = 0;
  let totalSkipped = 0;
  for (const s of sectors) {
    try {
      const stats = await seedSector(s.slug);
      totalNodes += stats.nodes_upserted;
      totalEdges += stats.edges_upserted;
      totalSkipped += stats.edges_skipped_missing_driver;
      console.log(
        `  ✓ ${s.slug}: ${stats.nodes_upserted} equity nodes, ${stats.edges_upserted} edges` +
          (stats.edges_skipped_missing_driver > 0
            ? ` (${stats.edges_skipped_missing_driver} skipped — missing driver)`
            : ""),
      );
    } catch (e) {
      console.error(`  ✗ ${s.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(
    `[seed-graph-equities] done. ${totalNodes} nodes, ${totalEdges} edges across ${sectors.length} sector(s)` +
      (totalSkipped > 0 ? ` (${totalSkipped} dropped edges).` : "."),
  );
}

main()
  .catch((e) => {
    console.error("[seed-graph-equities] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
