/**
 * Graph-traversal impliedImpact — milestone 8 preview, milestone 9 final.
 *
 * Pure math. Given the current driver values, each driver's default,
 * and the set of incoming edges to an equity node, produce a single
 * impact score in [-100, +100] suitable for the M5 30d projection.
 *
 * The formula mirrors the M1 editorial impact closely so the user UX
 * doesn't shift when the source of weights moves from `driver_links`
 * JSONB (M1) → graph_edges (M8+):
 *
 *   raw_i  = (driver_value_i - default_i) / |default_i|
 *   score  = 100 * tanh( Σ edge.weight × raw_i )
 *
 * `edge.weight` already encodes the sign × magnitude (M8 seed:
 *   {low: 0.5, med: 1.0, high: 2.0} × {+1, -1}).
 *
 * Division-by-zero on default_i = 0 is treated as 0 contribution
 * (drift from zero has no defined "% change" baseline).
 */

export interface ImpactEdge {
  /** Source = driver node_key (driver name). */
  source_key: string;
  /** Target = equity node_key (kind="equity"). */
  target_key: string;
  weight: number;
}

export interface ImpactInput {
  /** {driver_name: current_value} from the UI sliders. */
  driverValues: Record<string, number>;
  /** {driver_name: default_value} from the sim's `drivers` definition. */
  driverDefaults: Record<string, number>;
  /** Inbound edges grouped by equity target. */
  edges: ImpactEdge[];
}

/**
 * Compute impact scores for every equity referenced as a `target_key`
 * in `edges`. Returns {target_key: score ∈ [-100, +100]}.
 *
 * Equities with no inbound edges are absent from the result map;
 * callers should default to 0 for them.
 */
export function computeImpactScores(input: ImpactInput): Record<string, number> {
  const { driverValues, driverDefaults, edges } = input;

  // Group edges by target so each equity sees a single accumulation.
  const byTarget: Record<string, ImpactEdge[]> = {};
  for (const e of edges) {
    (byTarget[e.target_key] ??= []).push(e);
  }

  const out: Record<string, number> = {};
  for (const target of Object.keys(byTarget)) {
    let sum = 0;
    for (const edge of byTarget[target]!) {
      const cur = driverValues[edge.source_key];
      const def = driverDefaults[edge.source_key];
      if (cur === undefined || def === undefined) continue;
      const denom = Math.abs(def);
      if (denom < 1e-12) continue;
      const raw = (cur - def) / denom;
      sum += edge.weight * raw;
    }
    // tanh squashing → bounded [-1, +1] → scale to [-100, +100].
    out[target] = 100 * Math.tanh(sum);
  }
  return out;
}
