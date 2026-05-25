/**
 * M46b — Prediction tier auto-assignment + scoring.
 *
 * Tier rules (lifted from the Community 3.0 plan §4):
 *   Hard    5×  — 1D horizon, OR σ > 50%/yr, OR spread ≤ ±2% (4% total)
 *   Medium  2.5× — 1W, OR 1M with 5% < spread ≤ 10%, OR σ ∈ [25, 50)
 *   Easy    1×   — 1M with spread ≤ 5%, σ < 25%
 *
 * Scoring (resolution time):
 *   - actual ∈ [min, max] → score 1.0 (full points)
 *   - actual outside band → linear decay; score 0 at distance ≥ spread
 *   - reward_points = round(score × tier_multiplier × 10)
 *
 * Pure functions — no DB, no time. Tested in isolation and called both
 * by sector-service (placement validation, leaderboard projections) and
 * the data-pipeline resolution cron (via a port we'll mirror in Python).
 */

export type Horizon = "1d" | "1w" | "1m";
export type Tier = "easy" | "medium" | "hard";

export const HORIZON_DAYS: Record<Horizon, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
};

export const TIER_MULTIPLIER: Record<Tier, number> = {
  easy: 1,
  medium: 2.5,
  hard: 5,
};

export const TIER_MAX_POINTS: Record<Tier, number> = {
  easy: 10,
  medium: 25,
  hard: 50,
};

const TIGHT_SPREAD_PCT = 4; // ±2% total width
const MEDIUM_SPREAD_PCT_1M = 10;
const HIGH_VOL_PCT = 50;
const MEDIUM_VOL_PCT = 25;

export interface TierInputs {
  horizon: Horizon;
  /** (max − min) / midpoint × 100. Always positive. */
  spread_pct: number;
  /** Annualized historical σ in % per year. Null = unknown (e.g. new equity). */
  annualized_vol_pct: number | null;
}

export interface TierResult {
  tier: Tier;
  /** Short human-readable explanation surfaced as a tooltip. */
  explanation: string;
  /** The reward multiplier — convenience so callers don't double-import. */
  multiplier: number;
}

/**
 * Compute the tier + explanation. Pure function; the same inputs
 * always produce the same output. Order of clauses matters — the
 * Hard checks come first so a 1D bet on a low-vol equity still
 * resolves as Hard (single-day moves are inherently harder).
 */
export function assignTier(inputs: TierInputs): TierResult {
  const { horizon, spread_pct, annualized_vol_pct } = inputs;
  // ---- Hard ----------------------------------------------------------
  if (horizon === "1d") {
    return {
      tier: "hard",
      explanation: "1-day horizon — directional move in one trading day.",
      multiplier: TIER_MULTIPLIER.hard,
    };
  }
  if (annualized_vol_pct !== null && annualized_vol_pct > HIGH_VOL_PCT) {
    return {
      tier: "hard",
      explanation: `Annualized σ ${annualized_vol_pct.toFixed(0)}% > ${HIGH_VOL_PCT}% — high-volatility name.`,
      multiplier: TIER_MULTIPLIER.hard,
    };
  }
  if (spread_pct <= TIGHT_SPREAD_PCT) {
    return {
      tier: "hard",
      explanation: `Tight ±${(spread_pct / 2).toFixed(1)}% band requires high conviction.`,
      multiplier: TIER_MULTIPLIER.hard,
    };
  }
  // ---- Medium --------------------------------------------------------
  if (horizon === "1w") {
    return {
      tier: "medium",
      explanation: `1-week horizon with ±${(spread_pct / 2).toFixed(1)}% band.`,
      multiplier: TIER_MULTIPLIER.medium,
    };
  }
  if (horizon === "1m" && spread_pct > 5 && spread_pct <= MEDIUM_SPREAD_PCT_1M) {
    return {
      tier: "medium",
      explanation: `1-month ±${(spread_pct / 2).toFixed(1)}% band — moderate spread.`,
      multiplier: TIER_MULTIPLIER.medium,
    };
  }
  if (
    annualized_vol_pct !== null &&
    annualized_vol_pct >= MEDIUM_VOL_PCT &&
    annualized_vol_pct <= HIGH_VOL_PCT
  ) {
    return {
      tier: "medium",
      explanation: `Annualized σ ${annualized_vol_pct.toFixed(0)}% — moderate volatility.`,
      multiplier: TIER_MULTIPLIER.medium,
    };
  }
  // ---- Easy ----------------------------------------------------------
  return {
    tier: "easy",
    explanation:
      annualized_vol_pct !== null
        ? `1-month ±${(spread_pct / 2).toFixed(1)}% band on σ ${annualized_vol_pct.toFixed(0)}% — gentle target.`
        : `1-month ±${(spread_pct / 2).toFixed(1)}% band.`,
    multiplier: TIER_MULTIPLIER.easy,
  };
}

/**
 * Annualized historical volatility from a series of daily closes.
 * Returns null when not enough data to compute reliably.
 *
 * `closes` may be ordered any way — we sort by index implicitly by
 * walking pairwise. Caller is responsible for chronological order.
 */
export function annualizedVolPct(closes: number[]): number | null {
  if (closes.length < 10) return null;
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev !== undefined && cur !== undefined && prev > 0 && cur > 0) {
      logReturns.push(Math.log(cur / prev));
    }
  }
  if (logReturns.length < 5) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) /
    (logReturns.length - 1);
  if (variance < 0) return null;
  const dailyStd = Math.sqrt(variance);
  // Roughly 252 trading days per year for equity markets.
  return dailyStd * Math.sqrt(252) * 100;
}

/**
 * Score an actual close against the prediction band. 1.0 inside,
 * linear decay to 0 over one full spread-width outside. Clamped to
 * [0, 1].
 */
export function scorePrediction(
  actual: number,
  band_min: number,
  band_max: number,
): number {
  if (band_max < band_min) return 0;
  if (actual >= band_min && actual <= band_max) return 1;
  const spread = band_max - band_min;
  if (spread <= 0) return 0;
  const distance = actual < band_min ? band_min - actual : actual - band_max;
  if (distance >= spread) return 0;
  return Math.max(0, 1 - distance / spread);
}

/**
 * Resolve points awarded: round(score × tier_mult × 10). Score is
 * pre-clamped by `scorePrediction`.
 */
export function rewardPoints(score: number, tier: Tier): number {
  return Math.round(score * TIER_MULTIPLIER[tier] * 10);
}

/**
 * Derive (min, max) from a midpoint + spread_pct. Convenience for
 * forms / tests.
 */
export function bandFromSpread(mid: number, spread_pct: number): {
  band_min: number;
  band_max: number;
} {
  const half = (spread_pct / 100 / 2) * mid;
  return { band_min: mid - half, band_max: mid + half };
}

/** Spread_pct from a (min, max) pair. */
export function spreadPct(band_min: number, band_max: number): number {
  const mid = (band_min + band_max) / 2;
  if (mid <= 0) return 0;
  return ((band_max - band_min) / mid) * 100;
}

/**
 * resolves_at = anchor_date + horizon_days. Pure date math — no
 * trading-calendar adjustment (M46c can swap in a calendar lookup
 * later; v1 uses calendar days for simplicity).
 */
export function resolvesAt(anchor_date: Date, horizon: Horizon): Date {
  const ms = HORIZON_DAYS[horizon] * 24 * 60 * 60 * 1000;
  return new Date(anchor_date.getTime() + ms);
}
