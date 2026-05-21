import { describe, expect, it } from "vitest";

import {
  buildFinancials,
  DEFAULT_QUARTERLY_GROWTH,
  DEFAULT_QUARTERS,
  quarterEnd,
} from "../src/mock-financials.js";

const SAMSUNG: Parameters<typeof buildFinancials>[0] = {
  ticker: "005930",
  exchange: "KOSPI",
  market_cap_usd: 295_000_000_000,
};

const MICRON: Parameters<typeof buildFinancials>[0] = {
  ticker: "MU",
  exchange: "NASDAQ",
  market_cap_usd: 100_000_000_000,
};

describe("quarterEnd", () => {
  it("returns correct calendar quarter end dates", () => {
    expect(quarterEnd(2026, 1).toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(quarterEnd(2026, 2).toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(quarterEnd(2026, 3).toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(quarterEnd(2026, 4).toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("buildFinancials", () => {
  it("returns 8 quarters by default", () => {
    expect(buildFinancials(SAMSUNG)).toHaveLength(DEFAULT_QUARTERS);
  });

  it("is sorted oldest → newest", () => {
    const s = buildFinancials(SAMSUNG);
    for (let i = 1; i < s.length; i += 1) {
      expect(s[i]!.period_end.getTime()).toBeGreaterThan(s[i - 1]!.period_end.getTime());
    }
  });

  it("is deterministic across calls", () => {
    const a = buildFinancials(SAMSUNG);
    const b = buildFinancials(SAMSUNG);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.revenue_usd).toBe(b[i]!.revenue_usd);
      expect(a[i]!.net_income_usd).toBe(b[i]!.net_income_usd);
    }
  });

  it("produces different series for different tickers", () => {
    const a = buildFinancials(SAMSUNG).map((r) => r.revenue_usd);
    const b = buildFinancials({ ...SAMSUNG, ticker: "000660" }).map((r) => r.revenue_usd);
    // Scale is similar (same market cap anchor), but margins differ.
    expect(a[0]).not.toBe(b[0]);
  });

  it("revenue order-of-magnitude matches market_cap / 8 anchor", () => {
    const s = buildFinancials(SAMSUNG);
    const lastRev = s[s.length - 1]!.revenue_usd;
    const anchor = SAMSUNG.market_cap_usd! / 8;
    // Within ±20% of anchor (wobble + last-quarter is approximately anchor).
    const ratio = lastRev / anchor;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  it("revenue grows roughly at the configured rate", () => {
    const s = buildFinancials(SAMSUNG);
    const first = s[0]!.revenue_usd;
    const last = s[s.length - 1]!.revenue_usd;
    const periods = s.length - 1;
    const empiricalGrowth = Math.pow(last / first, 1 / periods) - 1;
    // Within ±2 percentage points of the configured baseline.
    expect(Math.abs(empiricalGrowth - DEFAULT_QUARTERLY_GROWTH)).toBeLessThan(0.02);
  });

  it("accounting identity: revenue = cogs + gross_profit", () => {
    const s = buildFinancials(MICRON);
    for (const r of s) {
      expect(r.cogs_usd + r.gross_profit_usd).toBeCloseTo(r.revenue_usd, 6);
    }
  });

  it("accounting identity: ebitda = gross_profit - opex", () => {
    const s = buildFinancials(MICRON);
    for (const r of s) {
      expect(r.gross_profit_usd - r.opex_usd).toBeCloseTo(r.ebitda_usd, 6);
    }
  });

  it("net income < ebitda (positive tax + depreciation drag)", () => {
    const s = buildFinancials(MICRON);
    for (const r of s) {
      expect(r.net_income_usd).toBeLessThan(r.ebitda_usd);
    }
  });

  it("M10d balance sheet identity: assets = liabilities + equity", () => {
    const s = buildFinancials(SAMSUNG);
    for (const r of s) {
      expect(r.total_assets_usd).toBeCloseTo(
        r.total_liabilities_usd + r.total_equity_usd,
        2,
      );
    }
  });

  it("M10d total assets grow over time", () => {
    const s = buildFinancials(SAMSUNG);
    expect(s[s.length - 1]!.total_assets_usd).toBeGreaterThan(s[0]!.total_assets_usd);
  });

  it("M10d leverage stays in a sensible band per ticker", () => {
    const s = buildFinancials(SAMSUNG);
    for (const r of s) {
      const lev = r.total_liabilities_usd / r.total_assets_usd;
      expect(lev).toBeGreaterThan(0.30);
      expect(lev).toBeLessThan(0.75);
    }
  });

  it("capex is a fraction of revenue", () => {
    const s = buildFinancials(MICRON);
    for (const r of s) {
      const capexRatio = r.capex_usd / r.revenue_usd;
      expect(capexRatio).toBeGreaterThan(0.05);
      expect(capexRatio).toBeLessThan(0.45);
    }
  });

  it("returns [] when market_cap_usd is null or non-positive", () => {
    expect(
      buildFinancials({ ticker: "X", exchange: "NASDAQ", market_cap_usd: null }),
    ).toEqual([]);
    expect(
      buildFinancials({ ticker: "X", exchange: "NASDAQ", market_cap_usd: 0 }),
    ).toEqual([]);
    expect(
      buildFinancials({ ticker: "X", exchange: "NASDAQ", market_cap_usd: -1 }),
    ).toEqual([]);
  });

  it("respects quarters override", () => {
    const s = buildFinancials(SAMSUNG, { quarters: 4 });
    expect(s).toHaveLength(4);
  });

  it("fiscal_quarter ∈ [1, 4] for every row", () => {
    const s = buildFinancials(SAMSUNG);
    for (const r of s) {
      expect(r.fiscal_quarter).toBeGreaterThanOrEqual(1);
      expect(r.fiscal_quarter).toBeLessThanOrEqual(4);
    }
  });

  it("ends at the configured endYear/endQuarter", () => {
    const s = buildFinancials(SAMSUNG, { endYear: 2025, endQuarter: 4 });
    const last = s[s.length - 1]!;
    expect(last.fiscal_year).toBe(2025);
    expect(last.fiscal_quarter).toBe(4);
    expect(last.period_end.toISOString().slice(0, 10)).toBe("2025-12-31");
  });
});
