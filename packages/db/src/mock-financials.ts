/**
 * Mock quarterly financials generator — milestone 10.
 *
 * Produces 8 deterministic quarters of (revenue, COGS, gross_profit,
 * opex, ebitda, net_income, capex) per equity, anchored on
 * `market_cap_usd / 8` as a rough quarterly revenue baseline. This is
 * intentionally crude — accurate enough to populate a UI demo, off by
 * 10-30% from reality for most names. The real-data DART/EDGAR adapter
 * lands as M10b.
 *
 * Pure functions, no DB. Tested in tests/mock-financials.test.ts.
 */

import { hash32, mulberry32 } from "./mock-quotes.js";

export const DEFAULT_QUARTERS = 8;
/** Quarterly compound growth rate baseline (~10%/yr → ~2.4%/q). */
export const DEFAULT_QUARTERLY_GROWTH = 0.024;

export interface FinancialAnchor {
  ticker: string;
  exchange: string;
  market_cap_usd: number | null;
}

export interface MockFinancialRow {
  fiscal_year: number;
  fiscal_quarter: number;  // 1..4
  period_end: Date;
  revenue_usd: number;
  cogs_usd: number;
  gross_profit_usd: number;
  opex_usd: number;
  ebitda_usd: number;
  net_income_usd: number;
  capex_usd: number;
}

export interface BuildFinancialsOptions {
  quarters?: number;
  endYear?: number;
  endQuarter?: number;
  /** Override the default quarterly growth rate. */
  quarterlyGrowth?: number;
}

/**
 * Last day of a fiscal quarter (calendar quarter approximation).
 * Q1=Mar31, Q2=Jun30, Q3=Sep30, Q4=Dec31.
 */
export function quarterEnd(year: number, quarter: number): Date {
  const lastDayByQuarter = {
    1: [2, 31],
    2: [5, 30],
    3: [8, 30],
    4: [11, 31],
  } as const;
  const tuple = lastDayByQuarter[quarter as 1 | 2 | 3 | 4];
  const [month, day] = tuple;
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * Walk `quarters` quarters backwards from (endYear, endQuarter)
 * inclusive. Returns array sorted oldest → newest.
 */
function enumerateQuarters(
  endYear: number,
  endQuarter: number,
  quarters: number,
): { year: number; quarter: number }[] {
  const out: { year: number; quarter: number }[] = [];
  let y = endYear;
  let q = endQuarter;
  for (let i = 0; i < quarters; i += 1) {
    out.push({ year: y, quarter: q });
    q -= 1;
    if (q < 1) {
      q = 4;
      y -= 1;
    }
  }
  return out.reverse();
}

/**
 * Build a `quarters`-length series of mock financials for one equity.
 * Margins (gross / opex / ebitda / net / capex) are deterministic per
 * ticker via mulberry32 so the same ticker → same series across runs.
 */
export function buildFinancials(
  eq: FinancialAnchor,
  opts: BuildFinancialsOptions = {},
): MockFinancialRow[] {
  if (eq.market_cap_usd == null || eq.market_cap_usd <= 0) return [];

  const quarters = opts.quarters ?? DEFAULT_QUARTERS;
  const endYear = opts.endYear ?? 2026;
  const endQuarter = opts.endQuarter ?? 1;
  const growth = opts.quarterlyGrowth ?? DEFAULT_QUARTERLY_GROWTH;

  // Margins: deterministic per equity. Ranges roughly match observed
  // industrial / semiconductor / fuel-cell maker realities:
  //   gross 25-45% (HBM is higher, fuel cells lower)
  //   opex (R&D + SG&A) 10-22%
  //   capex 10-30% of revenue
  const seed = hash32(`${eq.ticker}|${eq.exchange}|financials`, 0xc2b2ae35);
  const rand = mulberry32(seed);
  const grossMargin = 0.25 + rand() * 0.20;       // 25-45%
  const opexRatio = 0.10 + rand() * 0.12;          // 10-22%
  const capexRatio = 0.10 + rand() * 0.20;         // 10-30%
  // EBITDA = gross_profit - opex (approximation; D&A folded in below)
  // Net income = ebitda × (1 - tax_drag - depreciation_drag)
  const taxAndDeprDrag = 0.30 + rand() * 0.15;     // 30-45% combined

  // Anchor: market_cap / 8 ≈ rough quarterly revenue at current scale.
  // We grow back from "today" so the most recent quarter ≈ this anchor.
  const anchorRev = eq.market_cap_usd / 8;

  const quartersList = enumerateQuarters(endYear, endQuarter, quarters);
  // Oldest first; we set revenue_oldest = anchor / (1+g)^(quarters-1)
  // and walk forward. Each quarter wobbles ±3% around the trend.
  const baseRev = anchorRev / Math.pow(1 + growth, quarters - 1);

  const rows: MockFinancialRow[] = [];
  for (let i = 0; i < quartersList.length; i += 1) {
    const { year, quarter } = quartersList[i]!;
    const wobble = 1 + (rand() - 0.5) * 0.06;
    const revenue = baseRev * Math.pow(1 + growth, i) * wobble;
    const grossProfit = revenue * grossMargin;
    const cogs = revenue - grossProfit;
    const opex = revenue * opexRatio;
    const ebitda = grossProfit - opex;
    const netIncome = ebitda * (1 - taxAndDeprDrag);
    const capex = revenue * capexRatio;

    rows.push({
      fiscal_year: year,
      fiscal_quarter: quarter,
      period_end: quarterEnd(year, quarter),
      revenue_usd: revenue,
      cogs_usd: cogs,
      gross_profit_usd: grossProfit,
      opex_usd: opex,
      ebitda_usd: ebitda,
      net_income_usd: netIncome,
      capex_usd: capex,
    });
  }

  return rows;
}
