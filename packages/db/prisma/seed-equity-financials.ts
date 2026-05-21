/**
 * Equity financials mock seed — milestone 10.
 *
 * For every `SectorEquity` with a non-null `market_cap_usd`, generate
 * 8 quarters of deterministic mock fundamentals (revenue, cogs,
 * gross_profit, opex, ebitda, net_income, capex). Math lives in
 * `@platform/db/src/mock-financials.ts` (unit-tested, DB-free).
 *
 * The mock is *scale-correct order-of-magnitude* only — for any given
 * name it's likely 10-30% off from reality. M10b will swap this for a
 * real DART (KR) + EDGAR (US) adapter.
 *
 * Idempotent. Re-running deletes the equity's existing
 * `source="mock"` rows then re-inserts the regenerated series.
 *
 * Usage:
 *   pnpm db:seed:equity-financials
 *
 * Runs after `seed-equities.ts` (requires SectorEquity rows to exist).
 */

import { PrismaClient } from "@prisma/client";

import {
  buildFinancials,
  type FinancialAnchor,
} from "../src/mock-financials.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const equities = await prisma.sectorEquity.findMany({
    select: {
      id: true,
      ticker: true,
      exchange: true,
      market_cap_usd: true,
    },
    orderBy: { id: "asc" },
  });

  if (equities.length === 0) {
    console.log(
      "[seed-equity-financials] no SectorEquity rows found — run pnpm db:seed:equities first.",
    );
    return;
  }

  console.log(
    `[seed-equity-financials] generating 8q mock financials for ${equities.length} equities…`,
  );

  let totalRows = 0;
  let skipped = 0;
  for (const eq of equities) {
    const series = buildFinancials(eq as FinancialAnchor);
    if (series.length === 0) {
      skipped += 1;
      continue;
    }
    await prisma.equityFinancial.deleteMany({
      where: { equity_id: eq.id, source: "mock" },
    });
    await prisma.equityFinancial.createMany({
      data: series.map((r) => ({
        equity_id: eq.id,
        fiscal_year: r.fiscal_year,
        fiscal_quarter: r.fiscal_quarter,
        period_end: r.period_end,
        revenue_usd: r.revenue_usd,
        cogs_usd: r.cogs_usd,
        gross_profit_usd: r.gross_profit_usd,
        opex_usd: r.opex_usd,
        ebitda_usd: r.ebitda_usd,
        net_income_usd: r.net_income_usd,
        capex_usd: r.capex_usd,
        source: "mock",
      })),
      skipDuplicates: true,
    });
    totalRows += series.length;
  }

  console.log(
    `[seed-equity-financials] wrote ${totalRows} rows across ${equities.length - skipped} equities` +
      (skipped > 0 ? ` (skipped ${skipped} without market_cap).` : "."),
  );
}

main()
  .catch((e) => {
    console.error("[seed-equity-financials] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
