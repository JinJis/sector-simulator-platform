/**
 * Equity quotes mock seed — populates `equity_quotes` with 90 days of
 * deterministic random-walk daily closes per registered `SectorEquity`.
 *
 * Goal: a fresh `docker compose up` produces a working sparkline / M5
 * projection overlay on every equity card without requiring the
 * data-pipeline `refresh_quote_history` job (which depends on yfinance
 * reachability and a real network). Once yfinance ingest replaces these
 * rows, the seed becomes a smoke-test fallback only.
 *
 * Conventions
 * -----------
 * - 90 calendar days walking back from each equity's `last_close_date`.
 *   Day 0 (the most recent row) equals `last_close_local` exactly so the
 *   snapshot card and sparkline endpoint match.
 * - Determinism: PRNG seeded by `hash(ticker || exchange)`. Idempotent
 *   re-runs delete any prior rows whose `source == "mock"` for the
 *   equity, then re-insert the regenerated series.
 * - Math lives in `@platform/db/src/mock-quotes.ts` (unit-tested,
 *   DB-free).
 *
 * Usage:
 *   pnpm db:seed:equity-quotes
 *
 * Runs after `seed-equities.ts` (requires SectorEquity rows to exist).
 */

import { PrismaClient } from "@prisma/client";

import { buildSeries, type EquityAnchor } from "../src/mock-quotes.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const equities = await prisma.sectorEquity.findMany({
    select: {
      id: true,
      ticker: true,
      exchange: true,
      currency: true,
      last_close_local: true,
      last_close_date: true,
    },
    orderBy: { id: "asc" },
  });

  if (equities.length === 0) {
    console.log(
      "[seed-equity-quotes] no SectorEquity rows found — run pnpm db:seed:equities first.",
    );
    return;
  }

  console.log(
    `[seed-equity-quotes] generating mock history for ${equities.length} equities…`,
  );

  let totalRows = 0;
  let skippedNoAnchor = 0;
  for (const eq of equities) {
    const series = buildSeries(eq as EquityAnchor);
    if (series.length === 0) {
      skippedNoAnchor += 1;
      continue;
    }
    await prisma.equityQuote.deleteMany({
      where: { equity_id: eq.id, source: "mock" },
    });
    await prisma.equityQuote.createMany({
      data: series.map((r) => ({
        equity_id: eq.id,
        trade_date: r.trade_date,
        close_local: r.close_local,
        close_usd: r.close_usd,
        volume: r.volume,
        source: "mock",
      })),
      skipDuplicates: true,
    });
    totalRows += series.length;
  }

  console.log(
    `[seed-equity-quotes] wrote ${totalRows} rows across ${equities.length - skippedNoAnchor} equities` +
      (skippedNoAnchor > 0
        ? ` (skipped ${skippedNoAnchor} without anchor close).`
        : "."),
  );
}

main()
  .catch((e) => {
    console.error("[seed-equity-quotes] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
