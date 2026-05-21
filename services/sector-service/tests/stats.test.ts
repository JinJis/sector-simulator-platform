/**
 * Pure-math tests for `src/lib/stats.ts`. No DB, no network, no Prisma —
 * just inputs in, expected scalars / arrays out.
 */

import { describe, expect, it } from "vitest";

import {
  computeBasketStats,
  correlation,
  covariance,
  cumulativeIndex,
  dailyReturns,
  fitCapm,
  maxDrawdown,
  mean,
  stdev,
  variance,
} from "../src/lib/stats.js";

describe("descriptive stats", () => {
  it("mean / variance / stdev — small fixture", () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
    // sample variance (n-1): ((1-3)^2 + ... + (5-3)^2) / 4 = 10/4 = 2.5
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 10);
    expect(stdev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 10);
  });

  it("variance is 0 for length < 2", () => {
    expect(variance([])).toBe(0);
    expect(variance([42])).toBe(0);
  });

  it("covariance — perfect positive", () => {
    expect(covariance([1, 2, 3], [2, 4, 6])).toBeCloseTo(2.0, 10);
  });

  it("covariance — perfect negative", () => {
    expect(covariance([1, 2, 3], [6, 4, 2])).toBeCloseTo(-2.0, 10);
  });

  it("correlation in [-1, +1]", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
    // Constant series → 0 (avoid divide-by-zero NaN).
    expect(correlation([1, 1, 1], [2, 3, 4])).toBe(0);
  });
});

describe("price-series helpers", () => {
  it("dailyReturns from a 3-bar series", () => {
    const r = dailyReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });

  it("dailyReturns skips zero / non-finite previous prices", () => {
    expect(dailyReturns([0, 100])).toEqual([]);
    expect(dailyReturns([NaN, 100, 110])).toHaveLength(1);
  });

  it("cumulativeIndex applies compounding from base 100", () => {
    const idx = cumulativeIndex([0.1, -0.05, 0.2]);
    // 100 → 110 → 104.5 → 125.4
    expect(idx).toHaveLength(4);
    expect(idx[0]).toBe(100);
    expect(idx[3]).toBeCloseTo(125.4, 4);
  });

  it("maxDrawdown finds worst peak-to-trough", () => {
    // 100 → 120 → 60 → 90 → max DD = (120-60)/120 = 0.5
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(0.5, 10);
    // No drawdown for monotonic up
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });
});

describe("CAPM fit", () => {
  it("β = 1 / α = 0 / R² = 1 when equity = basket", () => {
    const r = [0.01, -0.02, 0.03, 0.005];
    const fit = fitCapm(r, r);
    expect(fit.beta).toBeCloseTo(1, 10);
    // mean(r) − β·mean(r) = 0
    expect(fit.alpha_annual_pct).toBeCloseTo(0, 10);
    expect(fit.r_squared).toBeCloseTo(1, 10);
  });

  it("β = 2 when equity moves 2x basket", () => {
    const basket = [0.01, -0.02, 0.03, 0.005];
    const equity = basket.map((x) => 2 * x);
    const fit = fitCapm(equity, basket);
    expect(fit.beta).toBeCloseTo(2, 10);
    expect(fit.r_squared).toBeCloseTo(1, 10);
  });

  it("β = null when basket variance is zero", () => {
    const fit = fitCapm([0.01, 0.02], [0.0, 0.0]);
    expect(fit.beta).toBeNull();
    expect(fit.r_squared).toBeNull();
  });

  it("returns nulls for tiny samples", () => {
    expect(fitCapm([], []).beta).toBeNull();
    expect(fitCapm([0.01], [0.01]).beta).toBeNull();
  });
});

describe("computeBasketStats — end-to-end aggregation", () => {
  it("basket cumulative index + per-equity stats line up", () => {
    // Two equities, same dates. A's daily returns are 2x B's at each
    // step so β(A vs basket) > β(B vs basket). Vary the per-step returns
    // so the basket itself has non-zero variance (otherwise β is null).
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    const bReturns = [0.01, -0.02, 0.03, -0.005];
    const aReturns = bReturns.map((r) => 2 * r);

    const aPrices = [100];
    for (const r of aReturns) aPrices.push(aPrices.at(-1)! * (1 + r));
    const bPrices = [100];
    for (const r of bReturns) bPrices.push(bPrices.at(-1)! * (1 + r));

    const series = [
      { equity_id: "A", bars: dates.map((d, i) => ({ trade_date: d, close: aPrices[i]! })) },
      { equity_id: "B", bars: dates.map((d, i) => ({ trade_date: d, close: bPrices[i]! })) },
    ];

    const result = computeBasketStats(series);
    // 5 bar dates → basket has 5 entries.
    expect(result.basket).toHaveLength(5);
    expect(result.basket[0]!.basket_index).toBe(100);

    expect(result.equities).toHaveLength(2);
    const a = result.equities.find((e) => e.equity_id === "A")!;
    const b = result.equities.find((e) => e.equity_id === "B")!;

    // Total return from first to last close.
    expect(a.return_pct).toBeCloseTo((aPrices.at(-1)! / 100 - 1) * 100, 6);
    expect(b.return_pct).toBeCloseTo((bPrices.at(-1)! / 100 - 1) * 100, 6);

    // A moves 2x B at each step → A has higher β than B vs the equal-
    // weighted basket of the two.
    expect(a.beta).not.toBeNull();
    expect(b.beta).not.toBeNull();
    expect(a.beta!).toBeGreaterThan(b.beta!);
    // A is twice as far from the basket mean → β(A) ≈ 2 × β(B).
    expect(a.beta! / b.beta!).toBeCloseTo(2, 1);

    // 4 daily returns each, both used in the regression.
    expect(a.bars_used).toBe(4);
    expect(b.bars_used).toBe(4);
  });

  it("aligns on date intersection when calendars differ (KR holiday case)", () => {
    // A trades all 3 dates; B is missing the middle date (holiday).
    const series = [
      {
        equity_id: "A",
        bars: [
          { trade_date: "2026-01-01", close: 100 },
          { trade_date: "2026-01-02", close: 110 },
          { trade_date: "2026-01-03", close: 121 },
        ],
      },
      {
        equity_id: "B",
        bars: [
          { trade_date: "2026-01-01", close: 200 },
          { trade_date: "2026-01-03", close: 220 },
        ],
      },
    ];
    const result = computeBasketStats(series);
    // Union: 3 dates.
    expect(result.basket).toHaveLength(3);

    const b = result.equities.find((e) => e.equity_id === "B")!;
    // B has 1 daily return total (Jan-1 → Jan-3, since Jan-2 is missing).
    // Basket on Jan-3 averages A's Jan-3 return (.1) and... wait, B's Jan-3
    // return is also defined (vs B's Jan-1). So basket(Jan-3) = mean(.1, .1).
    // bars_used = 1 — only one B return exists.
    expect(b.bars_used).toBe(1);
    // Single sample → variance = 0 → β = null
    expect(b.beta).toBeNull();
  });

  it("handles empty series gracefully", () => {
    const result = computeBasketStats([]);
    expect(result.basket).toEqual([]);
    expect(result.equities).toEqual([]);
  });

  it("handles single-bar equity (no returns)", () => {
    const result = computeBasketStats([
      { equity_id: "X", bars: [{ trade_date: "2026-01-01", close: 100 }] },
    ]);
    expect(result.equities[0]!.return_pct).toBeNull();
    expect(result.equities[0]!.beta).toBeNull();
    expect(result.equities[0]!.bars_used).toBe(0);
  });
});
