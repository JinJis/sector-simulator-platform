/**
 * Pure helpers shared between Workspace and ScenarioBar — kept out of
 * either component so neither has to import the other for these tiny
 * comparisons.
 */

import type { DriverSchema } from "@/lib/sim-client";

const EPS = 1e-9;

/**
 * Reduce a full driver-value map down to just the entries that differ from
 * the sector's defaults. This is the payload we persist as a scenario —
 * keeps stored scenarios resilient to sector schema additions (a newly
 * introduced driver just picks up its default when an old scenario loads).
 */
export function diffFromDefaults(
  values: Record<string, number>,
  drivers: { name: string; default: number }[] | DriverSchema[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of drivers) {
    const v = values[d.name];
    if (v === undefined) continue;
    if (Math.abs(v - d.default) > EPS) out[d.name] = v;
  }
  return out;
}

/**
 * Whether two override maps describe the same scenario state — driver-by-
 * driver float compare with a small epsilon. We treat "missing key" and
 * "value equals default in the other map" as different, because keys are
 * meaningful (a scenario *says* "I override this driver").
 */
export function isSameOverrides(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av === undefined || bv === undefined) return false;
    if (Math.abs(av - bv) > EPS) return false;
  }
  return true;
}
