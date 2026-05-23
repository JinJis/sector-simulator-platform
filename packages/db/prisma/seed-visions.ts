/**
 * Seed script — Vision Feasibility Monitor capability/risk/feasibility
 * data for the 3 reference visions (M38).
 *
 * Reads JSON files under `prisma/seed-data/visions/<slug>.json` and
 * upserts:
 *   - Sector.vision_question (so the Hero shows the framing question)
 *   - Capability (one per entry in capabilities[])
 *   - CapabilityScore (writes a fresh row with is_current=true; prior
 *     scores get is_current=false to preserve history)
 *   - CapabilityDependency (DAG edges between capabilities)
 *   - Risk (one per entry in risks[])
 *   - VisionFeasibility (snapshot row; prior snapshots → is_current=false)
 *
 * Idempotent — every Prisma write is upsert / find-then-write so
 * re-running picks up the JSON's latest state without duplicates.
 *
 * Usage: pnpm db:seed:visions
 *
 * Prerequisites:
 *   - migrations applied (capability schema + actor domain)
 *   - sectors seeded (pnpm db:seed)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));

interface ScoreInput {
  technical: number | null;
  economic: number | null;
  regulatory: number | null;
  supply: number | null;
  composite: number | null;
  composite_p10: number | null;
  composite_p90: number | null;
  rationale: string | null;
  as_of_days_ago: number;
}

interface CapabilityInput {
  key: string;
  name: string;
  short_name: string | null;
  description: string;
  rationale: string;
  display_order: number;
  weight: number;
  primary_driver_name: string | null;
  score: ScoreInput;
}

interface DependencyInput {
  source: string;
  target: string;
  rationale: string | null;
}

interface RiskInput {
  key: string;
  category: string;
  name: string;
  description: string;
  severity: string;
  likelihood: string;
  time_horizon: string;
  mitigations: string | null;
  affected_capability_keys: string[];
  display_order: number;
}

interface FeasibilityInput {
  composite: number;
  composite_p10: number | null;
  composite_p90: number | null;
  binding_capability_key: string | null;
  eta_median_years: number | null;
  eta_p10_years: number | null;
  eta_p90_years: number | null;
  delta_90d: number | null;
  rationale: string | null;
  as_of_days_ago: number;
}

interface VisionSeed {
  slug: string;
  vision_question: string;
  feasibility: FeasibilityInput;
  capabilities: CapabilityInput[];
  dependencies: DependencyInput[];
  risks: RiskInput[];
}

const VISION_SLUGS = ["space-data-center", "memory-semi", "sofc"];

function loadSeed(slug: string): VisionSeed {
  const path = join(HERE, "seed-data/visions", `${slug}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as VisionSeed;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function seedVision(seed: VisionSeed): Promise<void> {
  console.log(`[seed-visions] ${seed.slug} — starting`);

  // 1. Sector vision_question — ensure the framing question is set.
  await prisma.sector.update({
    where: { slug: seed.slug },
    data: { vision_question: seed.vision_question },
  });

  // 2. Capabilities + their current score.
  const capIdByKey = new Map<string, string>();
  for (const c of seed.capabilities) {
    const cap = await prisma.capability.upsert({
      where: { sector_slug_key: { sector_slug: seed.slug, key: c.key } },
      create: {
        sector_slug: seed.slug,
        key: c.key,
        name: c.name,
        short_name: c.short_name,
        description: c.description,
        rationale: c.rationale,
        display_order: c.display_order,
        weight: c.weight,
        primary_driver_name: c.primary_driver_name,
      },
      update: {
        name: c.name,
        short_name: c.short_name,
        description: c.description,
        rationale: c.rationale,
        display_order: c.display_order,
        weight: c.weight,
        primary_driver_name: c.primary_driver_name,
      },
    });
    capIdByKey.set(c.key, cap.id);

    // Demote prior current scores then insert the seed score as current.
    await prisma.capabilityScore.updateMany({
      where: { capability_id: cap.id, is_current: true },
      data: { is_current: false },
    });
    await prisma.capabilityScore.create({
      data: {
        capability_id: cap.id,
        technical: c.score.technical,
        economic: c.score.economic,
        regulatory: c.score.regulatory,
        supply: c.score.supply,
        composite: c.score.composite,
        composite_p10: c.score.composite_p10,
        composite_p90: c.score.composite_p90,
        as_of: daysAgo(c.score.as_of_days_ago),
        is_current: true,
        rationale: c.score.rationale,
      },
    });
  }

  // 3. Capability dependencies. Prune any not in the seed first so a
  //    removed-from-JSON dependency disappears on re-run.
  const allCaps = await prisma.capability.findMany({
    where: { sector_slug: seed.slug },
    select: { id: true, key: true },
  });
  const visionCapIds = allCaps.map((c) => c.id);
  await prisma.capabilityDependency.deleteMany({
    where: { source_id: { in: visionCapIds } },
  });
  for (const d of seed.dependencies) {
    const srcId = capIdByKey.get(d.source);
    const tgtId = capIdByKey.get(d.target);
    if (!srcId || !tgtId) {
      console.warn(
        `[seed-visions] ${seed.slug}: skipping dep ${d.source}→${d.target} ` +
          `(missing capability)`,
      );
      continue;
    }
    await prisma.capabilityDependency.create({
      data: { source_id: srcId, target_id: tgtId, rationale: d.rationale },
    });
  }

  // 4. Risks. Same upsert-by-key pattern; affected_capability_keys soft-
  //    validates (dropped keys logged but don't fail).
  const validKeys = new Set(capIdByKey.keys());
  for (const r of seed.risks) {
    const cleanKeys = r.affected_capability_keys.filter((k) => validKeys.has(k));
    if (cleanKeys.length !== r.affected_capability_keys.length) {
      const dropped = r.affected_capability_keys.filter((k) => !validKeys.has(k));
      console.warn(
        `[seed-visions] ${seed.slug}: risk ${r.key} dropped unknown capability keys: ${dropped.join(", ")}`,
      );
    }
    await prisma.risk.upsert({
      where: { sector_slug_key: { sector_slug: seed.slug, key: r.key } },
      create: {
        sector_slug: seed.slug,
        key: r.key,
        category: r.category,
        name: r.name,
        description: r.description,
        severity: r.severity,
        likelihood: r.likelihood,
        time_horizon: r.time_horizon,
        mitigations: r.mitigations,
        affected_capability_keys: cleanKeys,
        display_order: r.display_order,
      },
      update: {
        category: r.category,
        name: r.name,
        description: r.description,
        severity: r.severity,
        likelihood: r.likelihood,
        time_horizon: r.time_horizon,
        mitigations: r.mitigations,
        affected_capability_keys: cleanKeys,
        display_order: r.display_order,
      },
    });
  }

  // 5. Vision feasibility — wipe + reseed time series so the trajectory
  //    sparkline has 26 weekly snapshots. M40's daily cron replaces this
  //    once the scoring engine is online; for now a synthetic curve
  //    converging on the seed's current composite gives the hero a
  //    realistic-looking history.
  await prisma.visionFeasibility.deleteMany({ where: { sector_slug: seed.slug } });
  const f = seed.feasibility;
  const TRAJECTORY_WEEKS = 26;
  const targetComposite = f.composite;
  // Start ~delta_90d below today's score 90 days ago, slope up over the
  // window with a small sinusoidal jitter so it doesn't look linear.
  const baseStart = targetComposite - (f.delta_90d ?? 0) * 2;
  for (let i = TRAJECTORY_WEEKS; i >= 1; i -= 1) {
    const t = (TRAJECTORY_WEEKS - i) / TRAJECTORY_WEEKS; // 0 → 1
    const compositeHistorical =
      baseStart + (targetComposite - baseStart) * t + Math.sin(t * 7) * 1.5;
    const bandWidth = 4 + 4 * t;
    await prisma.visionFeasibility.create({
      data: {
        sector_slug: seed.slug,
        as_of: daysAgo(i * 7 + f.as_of_days_ago),
        is_current: false,
        composite: Number(compositeHistorical.toFixed(1)),
        composite_p10: Number((compositeHistorical - bandWidth).toFixed(1)),
        composite_p90: Number((compositeHistorical + bandWidth).toFixed(1)),
        binding_capability_key: f.binding_capability_key,
        eta_median_years: f.eta_median_years,
        eta_p10_years: f.eta_p10_years,
        eta_p90_years: f.eta_p90_years,
        delta_90d: null,
        rationale: null,
      },
    });
  }
  await prisma.visionFeasibility.create({
    data: {
      sector_slug: seed.slug,
      as_of: daysAgo(f.as_of_days_ago),
      is_current: true,
      composite: f.composite,
      composite_p10: f.composite_p10,
      composite_p90: f.composite_p90,
      binding_capability_key: f.binding_capability_key,
      eta_median_years: f.eta_median_years,
      eta_p10_years: f.eta_p10_years,
      eta_p90_years: f.eta_p90_years,
      delta_90d: f.delta_90d,
      rationale: f.rationale,
    },
  });

  console.log(
    `[seed-visions] ${seed.slug}: ${seed.capabilities.length} capabilities, ` +
      `${seed.dependencies.length} deps, ${seed.risks.length} risks, ` +
      `feasibility composite=${f.composite}`,
  );
}

async function main(): Promise<void> {
  for (const slug of VISION_SLUGS) {
    // Make sure the Sector row exists; seed-equities etc. assume seed.ts
    // ran first.
    const sector = await prisma.sector.findUnique({ where: { slug } });
    if (!sector) {
      console.warn(`[seed-visions] skipping ${slug}: Sector row missing — run pnpm db:seed first`);
      continue;
    }
    const seed = loadSeed(slug);
    await seedVision(seed);
  }
  console.log("[seed-visions] done");
}

main()
  .catch((err) => {
    console.error("[seed-visions] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
