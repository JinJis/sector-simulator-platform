/**
 * /visions/[slug] — the Hero Overview page. The 5-second-comprehension
 * landing for one technology vision.
 *
 * M37 shipped fixture-backed. M38b swaps to real DB via
 * `fetchVisionOverview` + `fetchFeasibilityHistory`. The vision-client
 * inferred types match the fixture shape exactly, so the diff is
 * purely the import source.
 *
 * If the tRPC call fails (sector-service unreachable), the page falls
 * back to the fixture so dev / preview environments still render
 * something rather than 500-ing.
 */

import {
  ActorCard,
  ActorPill,
  CapabilityCard,
  EconomicsCurveChart,
  EtaWindow,
  FeasibilityGauge,
  RiskRow,
  SignalRow,
  type ActorCategory,
  type ActorStage,
  type RiskSeverity,
  type SignalKind,
} from "@platform/ui";
import { TrajectorySparkline } from "@platform/ui";
import { notFound } from "next/navigation";

import { getLocale, getT } from "@/lib/i18n/server";
import {
  fetchFeasibilityHistory,
  fetchVisionOverview,
  type FeasibilityHistoryPoint,
  type VisionOverview,
} from "@/lib/vision-client";

import { CatalystsTimeline } from "../_components/catalysts-timeline";
import { InvestmentThesisPanel } from "../_components/investment-thesis-panel";
import type { Catalyst, InvestmentThesis } from "../_fixtures";
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

/**
 * Load Vision data. Server-side: try real DB via tRPC first; fall back
 * to fixture if sector-service is unreachable so dev / preview
 * environments still render. M37 fixtures stay in repo as backstop
 * through M44.
 */
async function loadVisionData(slug: string): Promise<{
  overview: VisionOverview;
  history: FeasibilityHistoryPoint[];
  source: "db" | "fixture";
  thesis: InvestmentThesis | null;
  catalysts: Catalyst[] | null;
} | null> {
  // Thesis + catalysts are editorial overlays from the fixture and
  // attach regardless of whether the live DB serves the rest. Live
  // sourcing lands in a later slice.
  const fixture = getVisionFixture(slug);
  const thesis = fixture?.thesis ?? null;
  const catalysts = fixture?.catalysts ?? null;

  try {
    const [overview, history] = await Promise.all([
      fetchVisionOverview(slug),
      fetchFeasibilityHistory(slug).catch(() => [] as FeasibilityHistoryPoint[]),
    ]);
    return { overview, history, source: "db", thesis, catalysts };
  } catch {
    if (!fixture) return null;
    // Adapt fixture trajectory to FeasibilityHistoryPoint shape.
    const history: FeasibilityHistoryPoint[] = fixture.trajectory.map((p) => ({
      as_of: p.as_of,
      composite: p.composite,
      composite_p10: p.p10,
      composite_p90: p.p90,
      binding_capability_key: null,
      eta_median_years: null,
    }));
    return {
      overview: fixture.overview,
      history,
      source: "fixture",
      thesis,
      catalysts,
    };
  }
}

export default async function VisionOverviewPage({ params }: Props) {
  const { slug } = await params;
  const data = await loadVisionData(slug);
  if (!data) notFound();
  const t = await getT();
  const locale = await getLocale();
  const { overview, history, source, thesis, catalysts } = data;
  const { vision, capabilities, risks, recent_signals, actors } = overview;
  const feas = vision.feasibility;
  const economics = ECONOMICS_CURVES[slug];
  // TrajectorySparkline expects { as_of, composite, p10?, p90? }; map.
  const trajectory = history.map((h) => ({
    as_of: h.as_of,
    composite: h.composite,
    p10: h.composite_p10,
    p90: h.composite_p90,
  }));

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
              {t("hero.feasibilityEmpty")}
            </div>
          )}

          <div className="flex max-w-md flex-1 flex-col items-stretch justify-center gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                {t("hero.trajectory")}
              </div>
              <TrajectorySparkline
                points={trajectory}
                width={360}
                height={64}
                ariaLabel={`${vision.name} feasibility trajectory`}
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-neutral-500">
                <span>{t("hero.sixMonthsAgo")}</span>
                <span>{t("hero.today")}</span>
              </div>
            </div>

            {feas?.eta_median_years != null && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                  {t("hero.etaWindow")}
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
                {t("hero.confidence")}:{" "}
                <span className="text-neutral-300">
                  {feas?.composite_p10 != null && feas?.composite_p90 != null
                    ? feas.composite_p90 - feas.composite_p10 < 10
                      ? t("hero.confidence.high")
                      : feas.composite_p90 - feas.composite_p10 < 20
                      ? t("hero.confidence.medium")
                      : t("hero.confidence.low")
                    : "—"}
                </span>
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.capability_count}
                </span>{" "}
                {t("hero.countCapabilities")}
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.signal_count_30d}
                </span>{" "}
                {t("hero.count30dSignals")}
              </span>
              <span>
                <span className="font-mono text-neutral-300 tabular-nums">
                  {vision.risk_count}
                </span>{" "}
                {t("hero.countRisks")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ----- Investor thesis + catalysts (M44/IA reshuffle) ----- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <InvestmentThesisPanel thesis={thesis} locale={locale} />
        <CatalystsTimeline catalysts={catalysts} locale={locale} />
      </section>

      {/* ----- Capabilities band ----- */}
      {capabilities.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              {t("hero.section.capabilities")}
            </h2>
            <a
              href={`/visions/${slug}/capabilities`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              {t("hero.viewAll")}
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
                >
                  {c.active_actors.length > 0 && (
                    <div className="border-t border-neutral-800 pt-2 text-[11px] text-neutral-500">
                      <span className="mr-1.5">{t("hero.activeActors")}:</span>
                      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                        {c.active_actors.map((aa, idx) => (
                          <span key={aa.actor_key} className="inline-flex items-center gap-1">
                            {idx > 0 && (
                              <span className="text-neutral-700" aria-hidden="true">
                                ·
                              </span>
                            )}
                            <ActorPill
                              actorKey={aa.actor_key}
                              name={aa.actor_short_name || aa.actor_name}
                              isoCountry={aa.iso_country}
                              role={aa.role}
                              href={`/visions/${slug}/actors/${aa.actor_key}`}
                            />
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </CapabilityCard>
              );
            })}
          </div>
        </section>
      )}

      {/* ----- Actors band (M45a) ----- */}
      {actors.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              {t("hero.section.actors")}
            </h2>
            <a
              href={`/visions/${slug}/actors`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              {t("hero.viewAll")}
            </a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {actors.slice(0, 8).map((a) => (
              <ActorCard
                key={a.actor_key}
                actorKey={a.actor_key}
                name={a.name}
                shortName={a.short_name}
                isoCountry={a.iso_country}
                category={a.category as ActorCategory}
                stage={a.stage as ActorStage}
                blurb={a.blurb}
                ticker={a.ticker}
                exchange={a.exchange}
                logoUrl={a.logo_url}
                relevance={a.relevance}
                href={`/visions/${slug}/actors/${a.actor_key}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ----- Economics curve ----- */}
      {economics && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
              {t("hero.section.economics")}
            </h2>
            <a
              href={`/visions/${slug}/economics`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              {t("hero.fullCurves")}
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
              {t("hero.section.riskBoard")}
            </h2>
            <a
              href={`/visions/${slug}/risks`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              {t("hero.fullBoard")}
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
              {t("hero.section.liveSignals")}
            </h2>
            <a
              href={`/visions/${slug}/signals`}
              className="text-xs text-neutral-500 hover:text-cyan-400"
            >
              {t("hero.viewAll")}
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
          <p className="text-sm text-neutral-400">{t("hero.emptyTree")}</p>
        </section>
      )}

      <p className="text-right text-[10px] text-neutral-600">
        {t("hero.dataSource")}:{" "}
        {source === "db" ? t("hero.dataSource.db") : t("hero.dataSource.fixture")}
      </p>
    </div>
  );
}
