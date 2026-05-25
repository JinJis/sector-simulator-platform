/**
 * Unit tests for the M46b tier auto-assignment + scoring math. Pure
 * functions, no DB.
 */

import { describe, expect, it } from "vitest";

import {
  annualizedVolPct,
  assignTier,
  bandFromSpread,
  rewardPoints,
  resolvesAt,
  scorePrediction,
  spreadPct,
} from "../src/lib/prediction-tier.js";

// ===== assignTier =======================================================

describe("assignTier — Hard short-circuits", () => {
  it("1D horizon → hard regardless of spread/vol", () => {
    const r = assignTier({
      horizon: "1d",
      spread_pct: 10,
      annualized_vol_pct: 15,
    });
    expect(r.tier).toBe("hard");
    expect(r.multiplier).toBe(5);
    expect(r.explanation).toContain("1-day");
  });

  it("σ > 50% → hard", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 10,
      annualized_vol_pct: 80,
    });
    expect(r.tier).toBe("hard");
    expect(r.explanation).toContain("80%");
  });

  it("spread ≤ 4% (±2%) → hard even on long horizon + low vol", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 4,
      annualized_vol_pct: 12,
    });
    expect(r.tier).toBe("hard");
    expect(r.explanation).toContain("Tight");
  });
});

describe("assignTier — Medium band", () => {
  it("1W → medium", () => {
    const r = assignTier({
      horizon: "1w",
      spread_pct: 10,
      annualized_vol_pct: 20,
    });
    expect(r.tier).toBe("medium");
    expect(r.multiplier).toBe(2.5);
  });

  it("1M with spread 6–10% → medium", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 8,
      annualized_vol_pct: 18,
    });
    expect(r.tier).toBe("medium");
  });

  it("σ 25–50% on 1M with low spread → medium (vol promotes it)", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 5,
      annualized_vol_pct: 35,
    });
    expect(r.tier).toBe("medium");
    expect(r.explanation).toContain("35%");
  });
});

describe("assignTier — Easy", () => {
  it("1M ±5% on low-vol → easy", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 5,
      annualized_vol_pct: 18,
    });
    expect(r.tier).toBe("easy");
    expect(r.multiplier).toBe(1);
  });

  it("1M ±5% on unknown vol → easy", () => {
    const r = assignTier({
      horizon: "1m",
      spread_pct: 5,
      annualized_vol_pct: null,
    });
    expect(r.tier).toBe("easy");
  });
});

// ===== scorePrediction ==================================================

describe("scorePrediction", () => {
  it("returns 1.0 when actual inside band", () => {
    expect(scorePrediction(100, 95, 105)).toBe(1);
    expect(scorePrediction(95, 95, 105)).toBe(1);
    expect(scorePrediction(105, 95, 105)).toBe(1);
  });

  it("returns 0 at exactly one-spread outside", () => {
    // spread = 10; one full spread away = 0
    expect(scorePrediction(115, 95, 105)).toBe(0);
    expect(scorePrediction(85, 95, 105)).toBe(0);
  });

  it("returns half score at half-spread distance", () => {
    expect(scorePrediction(110, 95, 105)).toBeCloseTo(0.5, 5);
    expect(scorePrediction(90, 95, 105)).toBeCloseTo(0.5, 5);
  });

  it("clamps to 0 beyond decay range", () => {
    expect(scorePrediction(200, 95, 105)).toBe(0);
  });

  it("degenerate band returns 0", () => {
    expect(scorePrediction(100, 105, 95)).toBe(0); // inverted
    expect(scorePrediction(100, 100, 100)).toBe(1); // single-point band: actual = mid = inside
  });
});

// ===== rewardPoints =====================================================

describe("rewardPoints", () => {
  it("computes max points per tier at full score", () => {
    expect(rewardPoints(1, "easy")).toBe(10);
    expect(rewardPoints(1, "medium")).toBe(25);
    expect(rewardPoints(1, "hard")).toBe(50);
  });

  it("scales linearly with score", () => {
    expect(rewardPoints(0.5, "hard")).toBe(25);
    expect(rewardPoints(0, "hard")).toBe(0);
  });
});

// ===== annualizedVolPct =================================================

describe("annualizedVolPct", () => {
  it("returns null for short series", () => {
    expect(annualizedVolPct([100, 101, 102])).toBe(null);
  });

  it("computes a reasonable vol on a flat series (~0)", () => {
    const flat = Array(60).fill(100);
    const v = annualizedVolPct(flat);
    expect(v).toBeCloseTo(0, 5);
  });

  it("computes higher vol on a noisy series", () => {
    // Random-walk-ish series with ~1% daily moves
    const series = [100];
    for (let i = 1; i < 60; i++) {
      const last = series[i - 1] ?? 100;
      series.push(last * (1 + (i % 2 === 0 ? 0.01 : -0.01)));
    }
    const v = annualizedVolPct(series);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(10); // not flat
    expect(v!).toBeLessThan(50); // not crazy
  });
});

// ===== band utilities ===================================================

describe("bandFromSpread / spreadPct", () => {
  it("round-trips through bandFromSpread → spreadPct", () => {
    const { band_min, band_max } = bandFromSpread(100, 10);
    expect(band_min).toBeCloseTo(95, 5);
    expect(band_max).toBeCloseTo(105, 5);
    expect(spreadPct(band_min, band_max)).toBeCloseTo(10, 5);
  });
});

// ===== resolvesAt =======================================================

describe("resolvesAt", () => {
  it("adds correct calendar days per horizon", () => {
    const anchor = new Date("2026-05-01T00:00:00Z");
    const r1d = resolvesAt(anchor, "1d");
    const r1w = resolvesAt(anchor, "1w");
    const r1m = resolvesAt(anchor, "1m");
    expect(
      (r1d.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
    ).toBeCloseTo(1, 5);
    expect(
      (r1w.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
    ).toBeCloseTo(7, 5);
    expect(
      (r1m.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
    ).toBeCloseTo(30, 5);
  });
});
