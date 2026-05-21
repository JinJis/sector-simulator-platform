/**
 * Pure stats helpers for the Equities M4 basket-comparison view.
 *
 * Everything here is deterministic and side-effect-free so the math
 * can be tested without a database. The tRPC `equity.basketStats`
 * procedure orchestrates the Prisma reads and threads the results
 * through `computeBasketStats`.
 *
 * Conventions:
 * - Returns are arithmetic (price_t / price_{t-1} - 1), not log.
 * - Annualization uses 252 trading days as the convention. KOSPI
 *   actually trades ~240/yr and NYSE ~252 — close enough for a
 *   directional UI; we don't claim risk-grade accuracy.
 * - All percentages are in raw percent (e.g., 12.5 = 12.5%, not
 *   0.125). The UI assumes this so renderers don't have to multiply.
 */

const TRADING_DAYS_PER_YEAR = 252;

// ---------- generic descriptive stats ----------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample variance (n-1 denominator). Returns 0 for length < 2. */
export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / (xs.length - 1);
}

export function stdev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}

/** Sample covariance (n-1 denominator). 0 if either array shorter than 2. */
export function covariance(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (xs[i]! - mx) * (ys[i]! - my);
  }
  return s / (n - 1);
}

/** Pearson correlation in [-1, +1]. Returns 0 when either series is constant. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const cov = covariance(xs, ys);
  const sx = stdev(xs);
  const sy = stdev(ys);
  if (sx === 0 || sy === 0) return 0;
  return cov / (sx * sy);
}

/** Max peak-to-trough drawdown as a positive fraction.
 *  e.g., 100 → 70 → 80 → 60 → 90 → max DD = (100-60)/100 = 0.4 */
export function maxDrawdown(prices: readonly number[]): number {
  if (prices.length < 2) return 0;
  let peak = prices[0]!;
  let worst = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    if (peak > 0) {
      const dd = (peak - p) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

// ---------- price-series helpers ---------------------------------------

/** Arithmetic daily returns. result[i] = prices[i] / prices[i-1] - 1.
 *  Skipped when prev is non-finite or ≤ 0. */
export function dailyReturns(prices: readonly number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const curr = prices[i]!;
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
      r.push(curr / prev - 1);
    }
  }
  return r;
}

/** Cumulative index starting at `base`. Each step multiplies by (1 + r_t). */
export function cumulativeIndex(returns: readonly number[], base = 100): number[] {
  const out: number[] = [base];
  let v = base;
  for (const r of returns) {
    v *= 1 + r;
    out.push(v);
  }
  return out;
}

// ---------- CAPM-ish β / α --------------------------------------------

export interface CapmFit {
  /** Slope of equity_r against basket_r. null if basket variance is ~0. */
  beta: number | null;
  /** Annualized intercept in percent: (mean_e - β·mean_b) · 252 · 100. */
  alpha_annual_pct: number | null;
  /** R² of the linear fit. Null if either series is constant. */
  r_squared: number | null;
}

/** Linear regression of `equityReturns` on `basketReturns`. Both arrays
 *  must be pre-aligned to the same calendar dates. */
export function fitCapm(
  equityReturns: readonly number[],
  basketReturns: readonly number[],
): CapmFit {
  if (equityReturns.length < 2 || basketReturns.length < 2) {
    return { beta: null, alpha_annual_pct: null, r_squared: null };
  }
  const n = Math.min(equityReturns.length, basketReturns.length);
  const er = equityReturns.slice(0, n);
  const br = basketReturns.slice(0, n);

  const varB = variance(br);
  if (varB < 1e-12) {
    return { beta: null, alpha_annual_pct: null, r_squared: null };
  }
  const beta = covariance(er, br) / varB;
  const alpha_daily = mean(er) - beta * mean(br);
  const alpha_annual_pct = alpha_daily * TRADING_DAYS_PER_YEAR * 100;

  const corr = correlation(er, br);
  const r_squared = corr * corr;
  return { beta, alpha_annual_pct, r_squared };
}

// ---------- basket aggregation ----------------------------------------

export interface DatedPrice {
  trade_date: string; // YYYY-MM-DD
  close: number;
}

export interface BasketStats {
  /** Equally-weighted basket cumulative index, starting at 100. */
  basket: { trade_date: string; basket_index: number }[];
  /** Per-equity stats. Order matches the input order. */
  equities: PerEquityStats[];
}

export interface PerEquityStats {
  equity_id: string;
  /** 90d total return %, last/first - 1. Null if <2 bars. */
  return_pct: number | null;
  /** Annualized stdev of daily returns × 100. Null if <2 returns. */
  volatility_annual_pct: number | null;
  /** Max peak-to-trough drawdown %. Null if <2 prices. */
  max_drawdown_pct: number | null;
  /** β vs basket. Null if basket variance ≈ 0 or <2 aligned points. */
  beta: number | null;
  /** Annualized α vs basket, in %. */
  alpha_annual_pct: number | null;
  /** R² of the CAPM fit. */
  r_squared: number | null;
  /** Aligned data points used in the regression — diagnostic. */
  bars_used: number;
}

/** Compute basket cumulative + per-equity stats. Input is a list of
 *  (equity_id, ascending [trade_date, close] bars). Date alignment is
 *  handled by union over *all bar dates* (not just return dates) so the
 *  resulting basket index lines up visually with any equity's price
 *  series from day 0. Equities missing on a given date simply don't
 *  contribute to the basket return that day. The per-equity CAPM fit
 *  uses only dates where both the equity and the basket have a return. */
export function computeBasketStats(
  series: { equity_id: string; bars: readonly DatedPrice[] }[],
): BasketStats {
  // 1) Per-equity daily returns keyed by date.
  const equityReturnsByDate = new Map<string, Map<string, number>>();
  for (const s of series) {
    const m = new Map<string, number>();
    for (let i = 1; i < s.bars.length; i++) {
      const prev = s.bars[i - 1]!.close;
      const curr = s.bars[i]!.close;
      if (prev > 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
        m.set(s.bars[i]!.trade_date, curr / prev - 1);
      }
    }
    equityReturnsByDate.set(s.equity_id, m);
  }

  // 2) Union of *bar* dates (not return dates) so the basket curve
  //    starts on the same day as the earliest equity bar.
  const dateSet = new Set<string>();
  for (const s of series) {
    for (const b of s.bars) dateSet.add(b.trade_date);
  }
  const dates = Array.from(dateSet).sort();

  // 3) Basket daily return on each date = mean of equity returns that
  //    exist on that date. First date has no return by definition.
  const basketReturnByDate = new Map<string, number>();
  for (const d of dates) {
    const rets: number[] = [];
    for (const m of equityReturnsByDate.values()) {
      const r = m.get(d);
      if (r !== undefined) rets.push(r);
    }
    if (rets.length > 0) {
      basketReturnByDate.set(d, mean(rets));
    }
  }

  // 4) Cumulative basket curve — index = 100 on the first date, then
  //    compound by the basket return on each subsequent date (0 if no
  //    equity had a return on that date).
  const basket: { trade_date: string; basket_index: number }[] = [];
  if (dates.length > 0) {
    let idx = 100;
    basket.push({ trade_date: dates[0]!, basket_index: 100 });
    for (let i = 1; i < dates.length; i++) {
      const d = dates[i]!;
      idx *= 1 + (basketReturnByDate.get(d) ?? 0);
      basket.push({ trade_date: d, basket_index: idx });
    }
  }

  // 5) Per-equity stats.
  const stats: PerEquityStats[] = series.map((s) => {
    const m = equityReturnsByDate.get(s.equity_id)!;
    const prices = s.bars.map((b) => b.close);

    const totalReturnPct =
      s.bars.length >= 2 && s.bars[0]!.close > 0
        ? (s.bars[s.bars.length - 1]!.close / s.bars[0]!.close - 1) * 100
        : null;

    const allReturns = Array.from(m.values());
    const vol_annual_pct =
      allReturns.length >= 2
        ? stdev(allReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100
        : null;

    const mdd = prices.length >= 2 ? maxDrawdown(prices) * 100 : null;

    // Pair (equity_r, basket_r) on dates where both exist.
    const er: number[] = [];
    const br: number[] = [];
    for (const [d, equityR] of m.entries()) {
      const basketR = basketReturnByDate.get(d);
      if (basketR !== undefined) {
        er.push(equityR);
        br.push(basketR);
      }
    }
    const fit = fitCapm(er, br);

    return {
      equity_id: s.equity_id,
      return_pct: totalReturnPct,
      volatility_annual_pct: vol_annual_pct,
      max_drawdown_pct: mdd,
      beta: fit.beta,
      alpha_annual_pct: fit.alpha_annual_pct,
      r_squared: fit.r_squared,
      bars_used: er.length,
    };
  });

  return { basket, equities: stats };
}
