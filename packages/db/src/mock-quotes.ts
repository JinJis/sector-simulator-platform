/**
 * Pure helpers for the mock equity quote seed. Extracted out of
 * `prisma/seed-equity-quotes.ts` so we can unit-test the math without
 * spinning up a Prisma client.
 *
 * The seed is just I/O on top of these functions — for any equity row,
 * `buildSeries({ ticker, exchange, currency, last_close_local,
 * last_close_date }, opts?)` returns the 90-day mock close-price
 * trajectory, oldest → newest, with day-0 (the most recent row)
 * pinned exactly to `last_close_local`.
 *
 * Determinism comes from `mulberry32` seeded by `hash32(ticker|exchange)`.
 * Same inputs → identical output across runs, machines, Node versions.
 */

export const DEFAULT_DAYS_BACK = 90;
export const FX_KRW_PER_USD = 1380;
export const DAILY_DRIFT = 0.00024;
export const DAILY_VOL_KR = 0.018;
export const DAILY_VOL_US = 0.022;

/** Mulberry32 — deterministic 32-bit-state PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform — two uniforms → one standard normal. */
export function gauss(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * FNV-1a-style 32-bit string hash. `salt` lets callers mix in a
 * domain tag so different consumers of the same input string get
 * uncorrelated PRNGs.
 */
export function hash32(s: string, salt = 0x9e3779b1): number {
  let h = salt >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function dailyVolFor(exchange: string): number {
  return exchange === "KOSPI" || exchange === "KOSDAQ" ? DAILY_VOL_KR : DAILY_VOL_US;
}

export interface EquityAnchor {
  ticker: string;
  exchange: string;
  currency: string | null;
  last_close_local: number | null;
  last_close_date: Date | null;
}

export interface MockQuoteRow {
  trade_date: Date;
  close_local: number;
  close_usd: number | null;
  volume: number;
}

export interface BuildSeriesOptions {
  daysBack?: number;
  drift?: number;
  sigmaOverride?: number;
  fxKrwPerUsd?: number;
}

/**
 * Produce a 90-day descending price walk anchored at `last_close_local`
 * on `last_close_date`. Returned series is sorted oldest → newest;
 * `result[result.length - 1].close_local === last_close_local`.
 *
 * Returns `[]` if the anchor is incomplete — the seed treats that as
 * "skip this equity" rather than guessing.
 */
export function buildSeries(
  eq: EquityAnchor,
  opts: BuildSeriesOptions = {},
): MockQuoteRow[] {
  if (eq.last_close_local == null || eq.last_close_date == null) return [];

  const daysBack = opts.daysBack ?? DEFAULT_DAYS_BACK;
  const drift = opts.drift ?? DAILY_DRIFT;
  const sigma = opts.sigmaOverride ?? dailyVolFor(eq.exchange);
  const fx = opts.fxKrwPerUsd ?? FX_KRW_PER_USD;

  const seed = hash32(`${eq.ticker}|${eq.exchange}`);
  const rand = mulberry32(seed);

  // closes[0] is the most recent (== anchor); closes[i] walks back.
  const closes: number[] = new Array(daysBack);
  closes[0] = eq.last_close_local;
  for (let i = 1; i < daysBack; i += 1) {
    const r = drift + sigma * gauss(rand);
    const denom = Math.max(1 + r, 0.5);
    closes[i] = closes[i - 1]! / denom;
  }

  const rows: MockQuoteRow[] = [];
  const anchor = new Date(eq.last_close_date);
  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    const close_local = closes[i]!;
    const close_usd =
      eq.currency === "USD"
        ? close_local
        : eq.currency === "KRW"
          ? close_local / fx
          : null;
    const volume = Math.max(
      1000,
      Math.round(close_local * 1000 * (0.7 + (((seed >> i) & 0xff) / 255) * 0.6)),
    );
    rows.push({ trade_date: d, close_local, close_usd, volume });
  }
  return rows;
}
