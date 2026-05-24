/**
 * Client-side mirror of the Python feasibility aggregator
 * (simulation-service/feasibility/aggregator.py +
 * vision_aggregator.py).
 *
 * Used by the M42 WhatIf Feasibility callout in the Playground: when a
 * user moves a driver slider, we shift the primary-affected
 * capability's technical dimension by a normalized amount, then re-run
 * this aggregator client-side to project the vision composite without
 * a round-trip to simulation-service.
 *
 * Kept in lock-step with the Python implementation — if Liebig
 * softening defaults move there, move them here too.
 */

export interface CapabilityScores {
  technical: number | null;
  economic: number | null;
  regulatory: number | null;
  supply: number | null;
}

export interface CapabilityWithComposite extends CapabilityScores {
  key: string;
  name: string;
  weight: number;
  composite: number | null;
  composite_p10: number | null;
  composite_p90: number | null;
}

const CAPABILITY_SOFTENING = 0.6;
const VISION_SOFTENING = 0.5;
const DEFAULT_DIM_WEIGHT = 0.25;

/**
 * Compute a capability composite from 4-dim scores via weighted-mean
 * + Liebig softening. Returns null when all dims are null.
 */
export function aggregateCapability(
  scores: CapabilityScores,
  softening: number = CAPABILITY_SOFTENING,
): { composite: number | null; p10: number | null; p90: number | null } {
  const dims: Array<{ value: number; weight: number }> = [];
  if (scores.technical !== null) dims.push({ value: scores.technical, weight: DEFAULT_DIM_WEIGHT });
  if (scores.economic !== null) dims.push({ value: scores.economic, weight: DEFAULT_DIM_WEIGHT });
  if (scores.regulatory !== null) dims.push({ value: scores.regulatory, weight: DEFAULT_DIM_WEIGHT });
  if (scores.supply !== null) dims.push({ value: scores.supply, weight: DEFAULT_DIM_WEIGHT });
  if (dims.length === 0) return { composite: null, p10: null, p90: null };

  const totalW = dims.reduce((a, d) => a + d.weight, 0);
  const weightedMean = dims.reduce((a, d) => a + d.value * d.weight, 0) / totalW;
  const lowest = Math.min(...dims.map((d) => d.value));
  const highest = Math.max(...dims.map((d) => d.value));

  let composite = lowest + softening * (weightedMean - lowest);
  composite = Math.max(0, Math.min(100, composite));

  const halfBand = (highest - lowest) / 4;
  return {
    composite: round2(composite),
    p10: round2(Math.max(0, composite - halfBand)),
    p90: round2(Math.min(100, composite + halfBand)),
  };
}

/**
 * Roll capability composites into a vision composite. Mirrors the
 * Python vision_aggregator: weighted-mean blended toward the binding
 * (lowest) capability via `softening` (default 0.5 — slightly more
 * Liebig-strict at vision level).
 *
 * Returns null when no capability has a composite.
 */
export function aggregateVision(
  capabilities: CapabilityWithComposite[],
  softening: number = VISION_SOFTENING,
): { composite: number; bindingKey: string } | null {
  const rated = capabilities.filter(
    (c) => c.composite !== null && c.weight > 0,
  );
  if (rated.length === 0) return null;
  const totalW = rated.reduce((a, c) => a + c.weight, 0);
  if (totalW <= 0) return null;

  const weightedMean =
    rated.reduce((a, c) => a + (c.composite as number) * c.weight, 0) / totalW;

  let binding = rated[0]!;
  for (const c of rated) {
    if ((c.composite as number) < (binding.composite as number)) binding = c;
  }
  const bindingScore = binding.composite as number;

  let composite = bindingScore + softening * (weightedMean - bindingScore);
  composite = Math.max(0, Math.min(100, composite));

  return { composite: round2(composite), bindingKey: binding.key };
}

/**
 * Project a vision composite given a set of driver overrides.
 *
 * Model (intentionally simple — this is a UX hint, not a sim):
 *   - Each driver primarily affects one capability (via
 *     Capability.primary_driver_name).
 *   - Normalized offset = (value - default) / (max - min)  ∈ [-1, +1]
 *   - That offset shifts the affected capability's `technical` dim by
 *     `offset × SHIFT_RANGE` (default 25 points), clamped to [0, 100].
 *   - We then re-aggregate capability composites + vision composite.
 *
 * The model is symmetric — moving a slider to its max raises that
 * capability's tech score by 25 points (clamped); moving to min drops
 * it by 25. Magnitude is calibrated so 4 slider moves to extremes can
 * shift the vision composite by 5-15 points — enough to feel
 * responsive, not so much that the UI feels exaggerated.
 *
 * `driverDirection` flips the sign for inverse drivers (e.g. cost
 * drivers where higher = worse). Default +1; future work can pull
 * this from a Capability metadata field.
 */
export interface DriverOverride {
  driver_name: string;
  value: number;
  default: number;
  min: number;
  max: number;
  /** +1 for "higher value → better"; -1 for inverse (cost / risk drivers). */
  direction?: 1 | -1;
}

const SHIFT_RANGE_POINTS = 25;

export function projectWhatIfVision(params: {
  capabilities: CapabilityWithComposite[];
  driverToCapability: Record<string, string>;
  drivers: DriverOverride[];
}): {
  current: { composite: number; bindingKey: string } | null;
  projected: { composite: number; bindingKey: string } | null;
  perCapabilityShift: Record<string, number>;
} {
  const current = aggregateVision(params.capabilities);

  // Bucket per-capability shifts (sum offsets for caps with multiple
  // drivers; agg can balance out internally).
  const shiftByCap: Record<string, number> = {};
  for (const d of params.drivers) {
    const cap_key = params.driverToCapability[d.driver_name];
    if (!cap_key) continue;
    const range = d.max - d.min;
    if (range <= 0) continue;
    const offset = (d.value - d.default) / range; // [-1, +1] but can exceed
    const direction = d.direction ?? 1;
    const shift = clamp(offset, -1, 1) * direction * SHIFT_RANGE_POINTS;
    shiftByCap[cap_key] = (shiftByCap[cap_key] ?? 0) + shift;
  }

  // Apply shifts to a copy and re-aggregate capability composites first
  // (so the vision aggregator sees the projected composite).
  const projectedCaps: CapabilityWithComposite[] = params.capabilities.map(
    (c) => {
      const shift = shiftByCap[c.key] ?? 0;
      if (shift === 0) return c;
      const newTech =
        c.technical === null
          ? null
          : clamp(c.technical + shift, 0, 100);
      const newScores: CapabilityScores = {
        technical: newTech,
        economic: c.economic,
        regulatory: c.regulatory,
        supply: c.supply,
      };
      const agg = aggregateCapability(newScores);
      return {
        ...c,
        technical: newTech,
        composite: agg.composite,
        composite_p10: agg.p10,
        composite_p90: agg.p90,
      };
    },
  );

  const projected = aggregateVision(projectedCaps);
  return { current, projected, perCapabilityShift: shiftByCap };
}

// ---- helpers ---------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
