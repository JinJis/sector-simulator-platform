/**
 * Seed script — Actor + VisionActor + CapabilityActor (M45b).
 *
 * Reads `prisma/seed-data/actors.json` (single global file; Actor is
 * a global entity, vision/capability assignments are M2M joins).
 *
 * Upserts:
 *   - Actor by global key
 *   - VisionActor by (actor_id, sector_slug)
 *   - CapabilityActor by (capability_id, actor_id) — capability resolved
 *     by (sector_slug, capability_key)
 *
 * Idempotent. Missing capabilities (e.g. memory-semi cap unseeded) get
 * logged + skipped rather than failing the whole run.
 *
 * Usage: pnpm db:seed:actors
 *
 * Prerequisites:
 *   - migrations applied (capability + actor schema)
 *   - sectors + capabilities seeded (pnpm db:seed && db:seed:visions)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));

interface ActorInput {
  key: string;
  name: string;
  short_name: string | null;
  name_local?: string | null;
  iso_country: string;
  category: string;
  ticker: string | null;
  exchange: string | null;
  blurb: string;
  description: string | null;
  stage: string;
  logo_url?: string | null;
  website?: string | null;
  signal_keywords: string[];
}

interface VisionAssignment {
  actor_key: string;
  relevance: number | null;
  rationale: string | null;
  display_order: number;
}

interface CapabilityAssignment {
  capability_key: string;
  actor_key: string;
  role: string;
  stage?: string | null;
  rationale: string | null;
}

interface ActorsSeed {
  actors: ActorInput[];
  vision_assignments: Record<string, VisionAssignment[]>;
  capability_assignments: Record<string, CapabilityAssignment[]>;
}

function loadSeed(): ActorsSeed {
  const path = join(HERE, "seed-data/actors.json");
  return JSON.parse(readFileSync(path, "utf-8")) as ActorsSeed;
}

async function main(): Promise<void> {
  const seed = loadSeed();

  // 1. Upsert actors (global).
  console.log(`[seed-actors] upserting ${seed.actors.length} actors...`);
  const actorIdByKey = new Map<string, string>();
  for (const a of seed.actors) {
    const row = await prisma.actor.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        name: a.name,
        short_name: a.short_name,
        name_local: a.name_local ?? null,
        iso_country: a.iso_country.toUpperCase(),
        category: a.category,
        ticker: a.ticker,
        exchange: a.exchange,
        blurb: a.blurb,
        description: a.description,
        stage: a.stage,
        logo_url: a.logo_url ?? null,
        website: a.website ?? null,
        signal_keywords: a.signal_keywords,
      },
      update: {
        name: a.name,
        short_name: a.short_name,
        name_local: a.name_local ?? null,
        iso_country: a.iso_country.toUpperCase(),
        category: a.category,
        ticker: a.ticker,
        exchange: a.exchange,
        blurb: a.blurb,
        description: a.description,
        stage: a.stage,
        logo_url: a.logo_url ?? null,
        website: a.website ?? null,
        signal_keywords: a.signal_keywords,
      },
    });
    actorIdByKey.set(a.key, row.id);
  }

  // 2. Vision assignments per sector.
  for (const [sector_slug, assignments] of Object.entries(seed.vision_assignments)) {
    const sector = await prisma.sector.findUnique({
      where: { slug: sector_slug },
      select: { slug: true },
    });
    if (!sector) {
      console.warn(`[seed-actors] sector ${sector_slug} missing — skipping vision assignments`);
      continue;
    }
    // Prune existing VisionActor rows for this sector so removed-from-JSON
    // entries disappear on re-run.
    await prisma.visionActor.deleteMany({ where: { sector_slug } });
    let count = 0;
    for (const va of assignments) {
      const actorId = actorIdByKey.get(va.actor_key);
      if (!actorId) {
        console.warn(
          `[seed-actors] ${sector_slug}: actor ${va.actor_key} missing — skipping vision assignment`,
        );
        continue;
      }
      await prisma.visionActor.create({
        data: {
          actor_id: actorId,
          sector_slug,
          relevance: va.relevance,
          rationale: va.rationale,
          display_order: va.display_order,
        },
      });
      count += 1;
    }
    console.log(`[seed-actors] ${sector_slug}: ${count} vision_actors`);
  }

  // 3. Capability assignments per sector.
  for (const [sector_slug, assignments] of Object.entries(seed.capability_assignments)) {
    const caps = await prisma.capability.findMany({
      where: { sector_slug },
      select: { id: true, key: true },
    });
    if (caps.length === 0) {
      console.warn(
        `[seed-actors] ${sector_slug}: no capabilities seeded — skipping capability assignments (run seed:visions first)`,
      );
      continue;
    }
    const capIdByKey = new Map(caps.map((c) => [c.key, c.id]));
    // Prune existing CapabilityActor rows for capabilities in this sector.
    await prisma.capabilityActor.deleteMany({
      where: { capability: { sector_slug } },
    });
    let count = 0;
    let skipped = 0;
    for (const ca of assignments) {
      const capId = capIdByKey.get(ca.capability_key);
      const actorId = actorIdByKey.get(ca.actor_key);
      if (!capId) {
        console.warn(
          `[seed-actors] ${sector_slug}: capability ${ca.capability_key} missing — skipping ${ca.actor_key} link`,
        );
        skipped += 1;
        continue;
      }
      if (!actorId) {
        console.warn(
          `[seed-actors] ${sector_slug}: actor ${ca.actor_key} missing — skipping cap ${ca.capability_key} link`,
        );
        skipped += 1;
        continue;
      }
      await prisma.capabilityActor.create({
        data: {
          capability_id: capId,
          actor_id: actorId,
          role: ca.role,
          stage: ca.stage ?? null,
          rationale: ca.rationale,
        },
      });
      count += 1;
    }
    console.log(
      `[seed-actors] ${sector_slug}: ${count} capability_actors (${skipped} skipped)`,
    );
  }

  console.log("[seed-actors] done");
}

main()
  .catch((err) => {
    console.error("[seed-actors] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
