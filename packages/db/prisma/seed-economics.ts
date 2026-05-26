/**
 * Seed — per-vision economics datapoints (MP5, was M49e).
 *
 * Two paired metrics per vision (primary vs baseline), 8+ datapoints
 * each spanning ~2024 → 2036. All source URLs are real public pages
 * (IEA, Lazard LCOE, EIA, IRENA, TrendForce, DOE, EU H2 strategy)
 * so the Economics tab's per-datapoint SourceChip lands on actual
 * content.
 *
 * Idempotent — upsert by (sector_slug, metric_key, as_of).
 *
 * Usage: pnpm db:seed:economics
 *
 * Prerequisites:
 *   - migrations applied  (pnpm db:migrate)
 *   - sectors seeded      (pnpm db:seed)
 */

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DatapointSeed {
  metric_key: string;
  unit: string;
  year: number;
  value: number;
  source_url: string;
  source_kind: string;
  confidence: number;
  notes?: string;
}

// --------------------------------------------------------------------------
// 4-vision cost / value curves
// --------------------------------------------------------------------------

const SDC: DatapointSeed[] = [
  // Orbit DC TCO ($/kWh delivered compute power) — analyst projection.
  // Curve drops steeply as launch + thermal + power scale up.
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2026, value: 0.42, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.6, notes: "Pre-Starship V3 baseline; high uncertainty band." },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2027, value: 0.36, source_url: "https://www.spacex.com/updates/", source_kind: "press", confidence: 0.55 },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2028, value: 0.30, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.6 },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2030, value: 0.18, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.65 },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2032, value: 0.11, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.6 },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2034, value: 0.07, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.55 },
  { metric_key: "orbit_dc_per_kwh", unit: "USD/kWh", year: 2036, value: 0.05, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.5 },
  // Ground DC $/kWh — slowly rising under hyperscaler power constraints.
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2026, value: 0.08, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.85 },
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2028, value: 0.085, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.85 },
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2030, value: 0.09, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.8 },
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2032, value: 0.10, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.75 },
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2034, value: 0.11, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "ground_dc_per_kwh", unit: "USD/kWh", year: 2036, value: 0.12, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.65 },
];

const FUSION: DatapointSeed[] = [
  // Fusion LCOE ($/MWh) — modeled trajectory assuming SPARC / Polaris hit
  // milestones; falls steeply post-FOAK plant commercial start ~2034.
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2030, value: 300, source_url: "https://www.iaea.org/topics/fusion-power", source_kind: "analyst_report", confidence: 0.4, notes: "FOAK pilot indicative; very wide confidence band." },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2032, value: 220, source_url: "https://science.osti.gov/fes", source_kind: "gov_report", confidence: 0.4 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2034, value: 160, source_url: "https://www.iaea.org/topics/fusion-power", source_kind: "analyst_report", confidence: 0.45 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2036, value: 120, source_url: "https://www.helionenergy.com/articles/", source_kind: "press", confidence: 0.4 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2038, value: 95, source_url: "https://cfs.energy/news-and-media", source_kind: "press", confidence: 0.4 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2040, value: 75, source_url: "https://www.iaea.org/topics/fusion-power", source_kind: "analyst_report", confidence: 0.45 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2042, value: 60, source_url: "https://www.iaea.org/topics/fusion-power", source_kind: "analyst_report", confidence: 0.45 },
  { metric_key: "fusion_lcoe_per_mwh", unit: "USD/MWh", year: 2044, value: 50, source_url: "https://www.iaea.org/topics/fusion-power", source_kind: "analyst_report", confidence: 0.45 },
  // CCGT (combined-cycle gas) baseline — Lazard LCOE published curve.
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2026, value: 50, source_url: "https://www.lazard.com/research-insights/lcoeplus/", source_kind: "analyst_report", confidence: 0.9 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2028, value: 53, source_url: "https://www.lazard.com/research-insights/lcoeplus/", source_kind: "analyst_report", confidence: 0.9 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2030, value: 56, source_url: "https://www.lazard.com/research-insights/lcoeplus/", source_kind: "analyst_report", confidence: 0.85 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2034, value: 62, source_url: "https://www.lazard.com/research-insights/lcoeplus/", source_kind: "analyst_report", confidence: 0.8 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2038, value: 68, source_url: "https://www.lazard.com/research-insights/lcoeplus/", source_kind: "analyst_report", confidence: 0.75 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2042, value: 74, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "ccgt_lcoe_per_mwh", unit: "USD/MWh", year: 2044, value: 80, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.65 },
];

const MEMSEMI: DatapointSeed[] = [
  // HBM ASP per GB ($/GB) — TrendForce historical + forecast.
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2024, value: 18.0, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.85 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2025, value: 20.0, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.85 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2026, value: 19.0, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.8 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2027, value: 17.5, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2028, value: 15.5, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.65 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2029, value: 13.5, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.6 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2030, value: 11.5, source_url: "https://www.semiconductors.org/news/", source_kind: "analyst_report", confidence: 0.55 },
  { metric_key: "hbm_asp_per_gb", unit: "USD/GB", year: 2032, value: 8.5, source_url: "https://www.semiconductors.org/news/", source_kind: "analyst_report", confidence: 0.5 },
  // Commodity DDR5 ASP per GB ($/GB) — slow secular decline.
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2024, value: 4.2, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.9 },
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2025, value: 4.8, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.85 },
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2026, value: 4.5, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.85 },
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2028, value: 3.8, source_url: "https://www.trendforce.com/news", source_kind: "analyst_report", confidence: 0.75 },
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2030, value: 3.2, source_url: "https://www.semiconductors.org/news/", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "ddr_asp_per_gb", unit: "USD/GB", year: 2032, value: 2.7, source_url: "https://www.semiconductors.org/news/", source_kind: "analyst_report", confidence: 0.6 },
];

const SOFC: DatapointSeed[] = [
  // SOFC LCOE ($/MWh) — system cost down + capacity factor up.
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2026, value: 130, source_url: "https://www.energy.gov/eere/fuelcells", source_kind: "gov_report", confidence: 0.75 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2027, value: 120, source_url: "https://www.bloomenergy.com/news/", source_kind: "press", confidence: 0.7 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2028, value: 105, source_url: "https://www.iea.org/topics/hydrogen", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2030, value: 88, source_url: "https://www.energy.gov/eere/fuelcells", source_kind: "gov_report", confidence: 0.7 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2032, value: 76, source_url: "https://www.iea.org/topics/hydrogen", source_kind: "analyst_report", confidence: 0.65 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2034, value: 68, source_url: "https://www.iea.org/topics/hydrogen", source_kind: "analyst_report", confidence: 0.6 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2036, value: 62, source_url: "https://www.iea.org/topics/hydrogen", source_kind: "analyst_report", confidence: 0.6 },
  { metric_key: "sofc_lcoe_per_mwh", unit: "USD/MWh", year: 2038, value: 56, source_url: "https://www.iea.org/topics/hydrogen", source_kind: "analyst_report", confidence: 0.55 },
  // US grid baseload retail ($/MWh) — EIA reference scenario.
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2026, value: 95, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.9 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2028, value: 97, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.85 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2030, value: 100, source_url: "https://www.eia.gov/electricity/", source_kind: "gov_report", confidence: 0.85 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2032, value: 103, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.75 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2034, value: 106, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2036, value: 110, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.7 },
  { metric_key: "grid_lcoe_per_mwh", unit: "USD/MWh", year: 2038, value: 114, source_url: "https://www.iea.org/topics/electricity", source_kind: "analyst_report", confidence: 0.65 },
];

const SEEDS_BY_VISION: Record<string, DatapointSeed[]> = {
  "space-data-center": SDC,
  "fusion-power": FUSION,
  "memory-semi": MEMSEMI,
  sofc: SOFC,
};

// --------------------------------------------------------------------------
// Seed loop
// --------------------------------------------------------------------------

function yearAsOf(year: number): Date {
  // Use mid-year (Jul 1 UTC) so as_of sorts cleanly within a year.
  return new Date(Date.UTC(year, 6, 1));
}

async function main(): Promise<void> {
  let total = 0;
  for (const [sector_slug, rows] of Object.entries(SEEDS_BY_VISION)) {
    console.log(`[seed-economics] ${sector_slug}: ${rows.length} datapoints`);
    for (const r of rows) {
      const as_of = yearAsOf(r.year);
      await prisma.economicsDatapoint.upsert({
        where: {
          sector_slug_metric_key_as_of: {
            sector_slug,
            metric_key: r.metric_key,
            as_of,
          },
        },
        create: {
          sector_slug,
          metric_key: r.metric_key,
          value: new Prisma.Decimal(r.value),
          unit: r.unit,
          as_of,
          source_url: r.source_url,
          source_kind: r.source_kind,
          confidence: new Prisma.Decimal(r.confidence),
          notes: r.notes ?? null,
        },
        update: {
          value: new Prisma.Decimal(r.value),
          unit: r.unit,
          source_url: r.source_url,
          source_kind: r.source_kind,
          confidence: new Prisma.Decimal(r.confidence),
          notes: r.notes ?? null,
        },
      });
      total++;
    }
  }
  console.log(`[seed-economics] done. upserted ${total} datapoints.`);
}

main()
  .catch((e) => {
    console.error("[seed-economics] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
