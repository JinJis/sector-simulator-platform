/**
 * /visions/[slug]/capabilities/[key] — capability detail drill-down.
 *
 * Reads capability + current score + dependency edges via
 * `capability.get` tRPC and per-capability actor wiring via
 * `actor.listForCapability`. Score history via `capability.scoreHistory`
 * — feeds a small trajectory sparkline (locked to 0-100).
 *
 * The fixture fallback used by the Hero page (when sector-service is
 * down) doesn't extend here — this is DB-only. If sector-service is
 * unreachable, an inline error renders rather than empty placeholders.
 */

import {
  ActorPill,
  DimensionBars,
  TrajectorySparkline,
  type RiskSeverity,
} from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import {
  fetchCapability,
  fetchCapabilityScoreHistory,
} from "@/lib/vision-client";
import { SECTOR_SERVICE_URL, trpc } from "@/lib/sim-client";

interface Props {
  params: Promise<{ slug: string; key: string }>;
}

const SCORE_BAND = (v: number | null): string => {
  if (v == null) return "text-neutral-500";
  if (v < 30) return "text-rose-400";
  if (v < 60) return "text-amber-400";
  return "text-emerald-400";
};

export default async function CapabilityDetailPage({ params }: Props) {
  const { slug, key } = await params;
  const t = await getT();

  let cap: Awaited<ReturnType<typeof fetchCapability>>;
  let scoreHistory: Awaited<ReturnType<typeof fetchCapabilityScoreHistory>>;
  let capActors: Awaited<ReturnType<typeof trpc.actor.listForCapability.query>>;
  try {
    [cap, scoreHistory, capActors] = await Promise.all([
      fetchCapability(slug, key),
      fetchCapabilityScoreHistory(slug, key, 60),
      trpc.actor.listForCapability.query({ sector_slug: slug, capability_key: key }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NOT_FOUND") || msg.includes("capability ")) {
      notFound();
    }
    return (
      <section className="rounded-xl border border-amber-500/50 bg-amber-950/20 p-6 text-sm">
        <p className="font-medium text-amber-300">
          {t("capability.loadFail")} <code>{key}</code>.
        </p>
        <p className="mt-2 text-amber-200/80">{msg}</p>
        <p className="mt-3 text-xs text-amber-200/60">
          sector-service: {SECTOR_SERVICE_URL}
        </p>
      </section>
    );
  }

  const cur = cap.current_score;
  const trajectoryPoints = scoreHistory.map((s) => ({
    as_of: s.as_of,
    composite: s.composite ?? 0,
  }));

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-semibold text-neutral-50">
            {cap.capability.short_name || cap.capability.name}
          </h2>
          <code className="rounded-sm border border-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
            {cap.capability.key}
          </code>
        </div>
        <p className="mt-2 text-sm text-neutral-400">{cap.capability.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span>
            {t("capability.weight")}:{" "}
            <strong className="text-neutral-300 tabular-nums">
              {cap.capability.weight.toFixed(2)}
            </strong>
          </span>
          {cap.capability.primary_driver_name && (
            <span>
              {t("capability.primaryDriver")}:{" "}
              <code className="text-neutral-300">
                {cap.capability.primary_driver_name}
              </code>
            </span>
          )}
          <span>
            {t("capability.displayOrder")}:{" "}
            <strong className="text-neutral-300 tabular-nums">
              {cap.capability.display_order}
            </strong>
          </span>
        </div>
      </header>

      {/* 4-dim score breakdown */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            {t("capability.currentReadiness")}
          </h3>
          {cur?.as_of && (
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {t("capability.asOf")} {new Date(cur.as_of).toISOString().slice(0, 10)}
            </span>
          )}
        </div>
        {cur ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                  {t("capability.composite")}
                </div>
                <div
                  className={`mt-2 font-mono text-6xl font-semibold leading-none tabular-nums ${SCORE_BAND(
                    cur.composite,
                  )}`}
                >
                  {cur.composite == null ? "—" : Math.round(cur.composite)}
                </div>
                <div className="mt-1 text-[10px] text-neutral-500">/ 100</div>
                {cur.composite_p10 != null && cur.composite_p90 != null && (
                  <div className="mt-2 text-[11px] text-neutral-500 tabular-nums">
                    P10–P90: {Math.round(cur.composite_p10)} – {Math.round(cur.composite_p90)}
                  </div>
                )}
              </div>
            </div>
            <div>
              <DimensionBars
                technical={cur.technical}
                economic={cur.economic}
                regulatory={cur.regulatory}
                supply={cur.supply}
              />
              {cur.rationale && (
                <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                  <span className="text-neutral-500">{t("capability.rationale")}: </span>
                  {cur.rationale}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">
            {t("capability.scoreEmpty")}
          </p>
        )}
      </section>

      {/* Trajectory */}
      {trajectoryPoints.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            {t("capability.trajectoryTitle")} ({trajectoryPoints.length} {t("capability.trajectorySnapshots")})
          </h3>
          <div className="mt-3">
            <TrajectorySparkline
              points={trajectoryPoints}
              width={640}
              height={80}
              ariaLabel={`${cap.capability.name} composite trajectory`}
            />
          </div>
        </section>
      )}

      {/* Why this matters */}
      <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-6">
        <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-300">
          {t("capability.whyMatters")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-200">
          {cap.capability.rationale}
        </p>
      </section>

      {/* Dependencies */}
      {(cap.dependencies.length > 0 || cap.dependents.length > 0) && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
            {t("capability.dependenciesTitle")}
          </h3>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                {t("capability.dependsOn")}
              </p>
              {cap.dependencies.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">{t("capability.noUpstream")}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {cap.dependencies.map((d) => (
                    <li key={d.id} className="text-sm">
                      →{" "}
                      <a
                        href={`/visions/${slug}/capabilities/${d.target_key}`}
                        className="text-neutral-200 hover:text-cyan-400 hover:underline"
                      >
                        {d.target_key}
                      </a>
                      {d.rationale && (
                        <span className="ml-2 text-xs text-neutral-500">— {d.rationale}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                {t("capability.dependedOnBy")}
              </p>
              {cap.dependents.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">{t("capability.noDownstream")}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {cap.dependents.map((d) => (
                    <li key={d.id} className="text-sm">
                      ←{" "}
                      <a
                        href={`/visions/${slug}/capabilities/${d.source_key}`}
                        className="text-neutral-200 hover:text-cyan-400 hover:underline"
                      >
                        {d.source_key}
                      </a>
                      {d.rationale && (
                        <span className="ml-2 text-xs text-neutral-500">— {d.rationale}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Active actors */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h3 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("capability.activeActors")}
        </h3>
        {capActors.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">{t("capability.actorsEmpty")}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {capActors.map((ca) => (
              <li
                key={ca.id}
                className="flex items-baseline justify-between rounded border border-neutral-800 bg-neutral-950/40 px-3 py-2"
              >
                <a
                  href={`/visions/${slug}/actors/${ca.actor.key}`}
                  className="text-sm text-neutral-200 hover:text-cyan-400 hover:underline"
                >
                  {ca.actor.short_name || ca.actor.name}
                </a>
                <ActorPill
                  actorKey={ca.actor.key}
                  name=""
                  role={ca.role}
                  isoCountry={ca.actor.iso_country}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-right text-[10px] text-neutral-600">
        {t("capability.signalFeedFooter")}
      </p>
    </div>
  );
}
