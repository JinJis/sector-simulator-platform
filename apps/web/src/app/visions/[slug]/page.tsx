/**
 * /visions/[slug] — the Hero Overview page. The 5-second-comprehension
 * landing for one technology vision.
 *
 * M37: fixture-backed; pulls everything from `getVisionFixture(slug)`.
 * M38c: swap fixture import for `fetchVisionOverview(slug)` +
 * `fetchFeasibilityHistory(slug)`. Identical type contract.
 */

import {
  CapabilityCard,
  EconomicsCurveChart,
  EtaWindow,
  FeasibilityGauge,
  RiskRow,
  SignalRow,
  TrajectorySparkline,
  type RiskSeverity,
  type SignalKind,
} from "@platform/ui";
import { notFound } from "next/navigation";

import { getVisionFixture } from "../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

// Hardcoded economics curves per vision — moves to capability_scoring_code
// outputs at M40. Kept inline here so the hero page is one-file readable.
const ECONOMICS_CURVES: Record<
  string,
  {
    primary: Array<{ year: number; value: number }>;
    baseline?: Array<{ year: number; value: number }>;
    primaryLabel: string;
    baselineLabel: string;
    yUnit: string;
  } | null
> = {
  "space-data-center": {
    primary: [
      { year: 2026, value: 0.42 },
      { year: 2028, value: 0.3 },
      { year: 2030, value: 0.18 },
      { year: 2032, value: 0.11 },
      { year: 2034, value: 0.07 },
      { year: 2036, value: 0.05 },
    ],
    baseline: [
      { year: 2026, value: 0.08 },
      { year: 2030, value: 0.09 },
      { year: 2034, value: 0.11 },
      { year: 2036, value: 0.12 },
    ],
    primaryLabel: "Orbit DC",
    baselineLabel: "Ground DC",
    yUnit: "$/kWh",
  },
  "memory-semi": null,
  sofc: null,
};

export default async function VisionOverviewPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const { overview, trajectory } = fixture;
  const { vision, capabilities, risks, recent_signals } = overview;
  const feas = vision.feasibility;
  const economics = ECONOMICS_CURVES[slug];

  return (
    <div className="space-y-8">
      {/* ----- Feasibility band ----- */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-stretch lg:justify-around">
          {feas ? (
            <FeasibilityGauge
              composite={feas.composite}
              composite_p10={feas.composite_p10}
              composite_p90={feas.composite_p90}
              delta_90d={feas.delta_90d}
              ariaLabel={`${vision.name} feasibility ${Math.round(feas.composite)} of 100`}
            />
          ) : (
            <div className="flex h-[220px] w-[220px] items-center justify-center text-sm text-neutral-500">
              Feasibility not yet computed
            </div>
          )}

          <div className="flex max-w-md flex-1 flex-col items-stretch justify-center gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                Trajectory
              </div>
              <TrajectorySparkline
                points={trajectory}
                width={360}
                height={64}
                ariaLabel={`${vision.name} feasibility trajectory`}
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-neutral-500">
                <span>6mo ago</span>
                <span>today</span>
              </div>
            </div>

            {feas?.eta_median_years != null && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                  ETA window
                </div>
                <EtaWindow
                  median={feas.eta_median_years}
                  p10={feas.eta_p10_years}
                  p90={feas.eta_p90_years}
                  width={360}
                  ariaLabel="ETA distribution"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 border-t border-neutral-800 pt-3 text-[11px] text-neutral-500">
              <span>
                Confidence:{" "}
                <span className="text-neutral-300">
                  {feas?.composite_p10 != null && feas?.composite_p90 != null
                    ? feas.composite_p90 - feas.composite_p10 < 10
                      ? "high"
                      : feas.composite_p90 - feas.composite_p10 < 20
                      ? "medium"
                      : "low"
                    : "—"}
                </span>
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.capability_count}
                </span>{" "}
                capabilities
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.signal_count_30d}
                </span>{" "}
                signals 30d
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.risk_count}
                </span>{" "}
                risks
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ----- Capabilities band ----- */}
      {capabilities.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              Capabilities
            </h2>
            <a
              href={`/visions/${slug}/capabilities`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              view all →
            </a>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {capabilities.map((c) => {
              // Latest signal direction: positive composite → up, negative → down.
              const lsDir =
                c.latest_signal?.delta_composite == null
                  ? undefined
                  : c.latest_signal.delta_composite > 0
                  ? ("up" as const)
                  : c.latest_signal.delta_composite < 0
                  ? ("down" as const)
                  : ("neutral" as const);
              return (
                <CapabilityCard
                  key={c.key}
                  capabilityKey={c.key}
                  shortName={c.short_name}
                  name={c.name}
                  composite={c.current_score?.composite ?? null}
                  delta={null /* M40 computes per-capability delta */}
                  isBinding={c.is_binding}
                  technical={c.current_score?.technical ?? null}
                  economic={c.current_score?.economic ?? null}
                  regulatory={c.current_score?.regulatory ?? null}
                  supply={c.current_score?.supply ?? null}
                  latestSignal={
                    c.latest_signal
                      ? { title: c.latest_signal.title, direction: lsDir }
                      : null
                  }
                  href={`/visions/${slug}/capabilities/${c.key}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ----- Economics curve ----- */}
      {economics && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              Economics
            </h2>
            <a
              href={`/visions/${slug}/economics`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              full curves →
            </a>
          </div>
          <EconomicsCurveChart
            primary={economics.primary}
            baseline={economics.baseline}
            primaryLabel={economics.primaryLabel}
            baselineLabel={economics.baselineLabel}
            yUnit={economics.yUnit}
            width={720}
            height={220}
            className="w-full"
            ariaLabel={`${vision.name} cost curve vs ${economics.baselineLabel}`}
          />
        </section>
      )}

      {/* ----- Risk board ----- */}
      {risks.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              Risk board
            </h2>
            <a
              href={`/visions/${slug}/risks`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              full board →
            </a>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2" role="list">
            {risks.map((r) => (
              <RiskRow
                key={r.key}
                category={r.category}
                name={r.name}
                description={r.description}
                severity={r.severity as RiskSeverity}
                likelihood={r.likelihood as "low" | "medium" | "high"}
                timeHorizon={r.time_horizon}
              />
            ))}
          </div>
        </section>
      )}

      {/* ----- Live signals band ----- */}
      {recent_signals.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              Live signals
            </h2>
            <a
              href={`/visions/${slug}/signals`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              view all →
            </a>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2" role="list">
            {recent_signals.map((s) => {
              const deltaComposite = [
                s.delta_technical,
                s.delta_economic,
                s.delta_regulatory,
                s.delta_supply,
              ]
                .filter((v): v is number => v != null)
                .reduce<number | null>(
                  (best, v) =>
                    best === null || Math.abs(v) > Math.abs(best) ? v : best,
                  null,
                );
              return (
                <SignalRow
                  key={s.id}
                  kind={s.source_kind as SignalKind}
                  title={s.title}
                  summary={s.summary}
                  capability={
                    s.capability_key
                      ? { key: s.capability_key, label: s.capability_key }
                      : null
                  }
                  deltaComposite={deltaComposite}
                  sourceUrl={s.source_url}
                  publishedAt={s.published_at}
                  highlighted={s.is_highlight}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ----- Empty-state callout when fixture is sparse ----- */}
      {capabilities.length === 0 && (
        <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
          <p className="text-sm text-neutral-400">
            This vision is registered but its capability tree hasn't been
            decomposed yet. Hand-curation lands in <strong>M38</strong>; agent
            generation in <strong>M41</strong>.
          </p>
        </section>
      )}
    </div>
  );
}
