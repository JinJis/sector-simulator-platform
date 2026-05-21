import { describe, expect, it } from "vitest";

import {
  buildSeries,
  DAILY_VOL_KR,
  DAILY_VOL_US,
  dailyVolFor,
  DEFAULT_DAYS_BACK,
  FX_KRW_PER_USD,
  gauss,
  hash32,
  mulberry32,
} from "../src/mock-quotes.js";

const SAMSUNG: Parameters<typeof buildSeries>[0] = {
  ticker: "005930",
  exchange: "KOSPI",
  currency: "KRW",
  last_close_local: 78_000,
  last_close_date: new Date("2026-04-30T00:00:00Z"),
};

const MICRON: Parameters<typeof buildSeries>[0] = {
  ticker: "MU",
  exchange: "NASDAQ",
  currency: "USD",
  last_close_local: 105.0,
  last_close_date: new Date("2026-04-30T00:00:00Z"),
};

describe("mulberry32 + hash32", () => {
  it("hash32 is stable", () => {
    expect(hash32("MU|NASDAQ")).toBe(hash32("MU|NASDAQ"));
    expect(hash32("MU|NASDAQ")).not.toBe(hash32("MU|NYSE"));
  });

  it("mulberry32 reproduces the same sequence given the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("gauss has roughly zero mean over many draws", () => {
    const rand = mulberry32(7);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i += 1) sum += gauss(rand);
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
  });
});

describe("dailyVolFor", () => {
  it("returns KR vol for KOSPI / KOSDAQ", () => {
    expect(dailyVolFor("KOSPI")).toBe(DAILY_VOL_KR);
    expect(dailyVolFor("KOSDAQ")).toBe(DAILY_VOL_KR);
  });

  it("returns US vol for NASDAQ / NYSE", () => {
    expect(dailyVolFor("NASDAQ")).toBe(DAILY_VOL_US);
    expect(dailyVolFor("NYSE")).toBe(DAILY_VOL_US);
  });
});

describe("buildSeries", () => {
  it("returns 90 rows per equity", () => {
    expect(buildSeries(SAMSUNG)).toHaveLength(DEFAULT_DAYS_BACK);
    expect(buildSeries(MICRON)).toHaveLength(DEFAULT_DAYS_BACK);
  });

  it("anchors the last row exactly to last_close_local", () => {
    const s = buildSeries(SAMSUNG);
    expect(s[s.length - 1]!.close_local).toBeCloseTo(78_000, 6);
  });

  it("is sorted oldest → newest", () => {
    const s = buildSeries(SAMSUNG);
    for (let i = 1; i < s.length; i += 1) {
      expect(s[i]!.trade_date.getTime()).toBeGreaterThan(s[i - 1]!.trade_date.getTime());
    }
  });

  it("is deterministic across calls (same ticker → same series)", () => {
    const a = buildSeries(SAMSUNG);
    const b = buildSeries(SAMSUNG);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.close_local).toBe(b[i]!.close_local);
      expect(a[i]!.trade_date.toISOString()).toBe(b[i]!.trade_date.toISOString());
    }
  });

  it("produces different series for different tickers (uncorrelated PRNGs)", () => {
    const a = buildSeries(SAMSUNG).map((r) => r.close_local);
    const b = buildSeries({ ...SAMSUNG, ticker: "000660", exchange: "KOSPI" }).map(
      (r) => r.close_local,
    );
    // The two series might happen to cross, but they shouldn't be
    // identical. Compare the early portion (anchor day always
    // matches by construction, so look at day 30).
    expect(a[30]).not.toBeCloseTo(b[30]!, 0);
  });

  it("converts KRW close → USD via FX constant", () => {
    const s = buildSeries(SAMSUNG);
    const last = s[s.length - 1]!;
    expect(last.close_usd).not.toBeNull();
    expect(last.close_usd!).toBeCloseTo(78_000 / FX_KRW_PER_USD, 4);
  });

  it("USD currency: close_usd === close_local", () => {
    const s = buildSeries(MICRON);
    for (const r of s) {
      expect(r.close_usd).toBe(r.close_local);
    }
  });

  it("returns [] when anchor is missing", () => {
    expect(
      buildSeries({
        ticker: "X",
        exchange: "NASDAQ",
        currency: "USD",
        last_close_local: null,
        last_close_date: new Date(),
      }),
    ).toEqual([]);
    expect(
      buildSeries({
        ticker: "X",
        exchange: "NASDAQ",
        currency: "USD",
        last_close_local: 10,
        last_close_date: null,
      }),
    ).toEqual([]);
  });

  it("first row trade_date is daysBack-1 days before anchor", () => {
    const s = buildSeries(SAMSUNG);
    const expected = new Date(SAMSUNG.last_close_date!);
    expected.setUTCDate(expected.getUTCDate() - (DEFAULT_DAYS_BACK - 1));
    expect(s[0]!.trade_date.toISOString().slice(0, 10)).toBe(
      expected.toISOString().slice(0, 10),
    );
  });

  it("respects daysBack override", () => {
    const s = buildSeries(SAMSUNG, { daysBack: 30 });
    expect(s).toHaveLength(30);
    expect(s[s.length - 1]!.close_local).toBeCloseTo(78_000, 6);
  });

  it("prices stay positive (no degenerate denom)", () => {
    const s = buildSeries(SAMSUNG, { sigmaOverride: 0.5 });
    for (const r of s) {
      expect(r.close_local).toBeGreaterThan(0);
    }
  });

  it("volume is positive integer", () => {
    const s = buildSeries(SAMSUNG);
    for (const r of s) {
      expect(Number.isInteger(r.volume)).toBe(true);
      expect(r.volume).toBeGreaterThanOrEqual(1000);
    }
  });
});
