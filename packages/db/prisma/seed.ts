/**
 * Seed script — registers the in-code sectors so that `scenarios.sector_slug`
 * FKs resolve.
 *
 * Source of truth for sims is still
 * `services/simulation-service/simulation_service/registry.py`. Until that
 * registry becomes DB-driven (Phase 2 later slice when agent-orchestration
 * writes sectors directly), this seed is hand-maintained — keep it in sync
 * when a new sector is added on the Python side.
 *
 * Idempotent: re-running upserts; safe in any environment.
 *
 * Usage:
 *   pnpm db:seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedSector {
  slug: string;
  name: string;
  description: string;
  source_module: string;
}

const SEED_SECTORS: SeedSector[] = [
  {
    slug: "space-data-center",
    name: "Space Data Center",
    description:
      "Orbital data-center techno-economic feasibility — launch cost, panel/chip efficiency, " +
      "thermal mass, mission life vs ground baseline NPV and break-even year.",
    source_module: "simulation_service.sims.space_data_center",
  },
  {
    slug: "memory-semi",
    name: "Memory Semiconductor",
    description:
      "DRAM/HBM memory maker 10-year revenue·margin·FCF cycle — AI vs commodity demand, " +
      "ASP cycle, HBM premium, market share, cost-down, capex intensity.",
    source_module: "simulation_service.sims.memory_semi",
  },
  {
    slug: "sofc",
    name: "SOFC (Solid Oxide Fuel Cell)",
    description:
      "Stationary SOFC power plant LCOE vs grid — capex, efficiency, stack lifetime/" +
      "replacement, degradation, fuel cost, carbon price.",
    source_module: "simulation_service.sims.sofc",
  },
  {
    slug: "fusion-power",
    name: "Fusion Power (DT tokamak)",
    description:
      "DT 토카막 핵융합 발전소의 40년 LCOE — capex, 자기장 강도, TBR, " +
      "first-wall 수명, 가동률을 조절해 grid baseline 대비 break-even 시점을 확인.",
    source_module: "simulation_service.sims.fusion_power",
  },
];

// M50 — @feasibility_bot user used by the crawler's discovery loop to
// author CommunityProposal rows. is_bot=true + bot_kind="research_agent"
// ensures the UI guardrails (leaderboard/reputation/vote/follow) skip
// this account. password_hash is a non-loggable placeholder — the bot
// authenticates via a service token, not a password login.
const BOT_USER = {
  email: "feasibility-bot@platform.local",
  name: "@feasibility_bot",
  password_hash:
    "$2b$12$DISABLED.bot.account.never.logs.in.password.hash.placeholder",
  is_bot: true,
  bot_kind: "research_agent",
} as const;

async function main(): Promise<void> {
  console.log(`[seed] upserting ${SEED_SECTORS.length} sectors…`);
  for (const sector of SEED_SECTORS) {
    await prisma.sector.upsert({
      where: { slug: sector.slug },
      update: {
        name: sector.name,
        description: sector.description,
        source_module: sector.source_module,
      },
      create: sector,
    });
    console.log(`  ✓ ${sector.slug}`);
  }
  const total = await prisma.sector.count();
  console.log(`[seed] done. sectors in DB: ${total}`);

  console.log("[seed] upserting bot user @feasibility_bot…");
  await prisma.user.upsert({
    where: { email: BOT_USER.email },
    create: {
      email: BOT_USER.email,
      name: BOT_USER.name,
      password_hash: BOT_USER.password_hash,
      is_bot: BOT_USER.is_bot,
      bot_kind: BOT_USER.bot_kind,
    },
    update: {
      // Keep name + bot flags in sync on re-runs; never touch
      // password_hash (some envs may have rotated it).
      name: BOT_USER.name,
      is_bot: BOT_USER.is_bot,
      bot_kind: BOT_USER.bot_kind,
    },
  });
  console.log(`  ✓ ${BOT_USER.email}`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
