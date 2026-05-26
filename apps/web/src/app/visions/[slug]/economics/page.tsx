/**
 * /visions/[slug]/economics — Economics detail tab (MP5).
 *
 * Pulls every datapoint via `trpc.economics.list`, groups by
 * `metric_key`, pairs the primary + baseline curves per vision and
 * renders them on `EconomicsCurveChart`. Below the chart, a per-metric
 * datapoint table shows the year, value, confidence, and a
 * `SourceChip` per row so any number on the chart traces back to the
 * IEA / Lazard / EIA / DOE / TrendForce page it came from.
 *
 * Falls back to the empty state when the DB has no rows for the
 * vision (e.g., fresh `db:reset` without `pnpm db:seed:economics`).
 */

import { EconomicsCurveChart, SourceChip } from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { trpc } from "@/lib/sim-client";

import { ECONOMICS_PAIRS } from "../../_economics-pairs";
import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

type Datapoint = {
  id: string;
  metric_key: string;
  value: number;
  unit: string;
  as_of: string | Date;
  source_url: string;
  source_kind: string;
  confidence: number;
  notes: string | null;
};

function toCurvePoints(rows: Datapoint[]): Array<{ year: number; value: number }> {
  return rows
    .map((r) => ({
      year: new Date(r.as_of).getUTCFullYear(),
      value: r.value,
    }))
    .sort((a, b) => a.year - b.year);
}

export default async function EconomicsIndexPage({ params }: Props) {
  const { slug } = await params;
  const t = await getT();
  const pair = ECONOMICS_PAIRS[slug] ?? null;

  // Make sure the vision itself exists (so /economics on an unknown
  // slug 404s instead of rendering the empty state).
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();

  let rows: Datapoint[] = [];
  try {
    const r = await trpc.economics.list.query({ sector_slug: slug, limit: 500 });
    rows = r.map((x) => ({
      id: x.id,
      metric_key: x.metric_key,
      value: x.value,
      unit: x.unit,
      as_of: x.as_of,
      source_url: x.source_url,
      source_kind: x.source_kind,
      confidence: x.confidence,
      notes: x.notes,
    }));
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("economics.title")}
        </h2>
        <p className="mt-2 text-sm text-neutral-400">
          No economics datapoints seeded yet. Run{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
            pnpm db:seed:economics
          </code>{" "}
          to populate the 4-vision baseline.
        </p>
      </section>
    );
  }

  const byMetric = new Map<string, Datapoint[]>();
  for (const r of rows) {
    const arr = byMetric.get(r.metric_key) ?? [];
    arr.push(r);
    byMetric.set(r.metric_key, arr);
  }
  for (const arr of byMetric.values()) {
    arr.sort((a, b) => new Date(a.as_of).getTime() - new Date(b.as_of).getTime());
  }

  const primaryRows = pair ? (byMetric.get(pair.primary.key) ?? []) : [];
  const baselineRows = pair ? (byMetric.get(pair.baseline.key) ?? []) : [];

  // Metric list for the per-metric table section. Sort by metric_key for
  // stable order across renders.
  const tableMetrics = Array.from(byMetric.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("economics.title")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {rows.length} datapoints · {byMetric.size} metric series · every row
          carries a source chip.
        </p>
      </header>

      {pair && primaryRows.length >= 2 && baselineRows.length >= 2 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-neutral-200">{pair.title}</h3>
            <span className="text-[10px] text-neutral-500">{pair.yUnit}</span>
          </div>
          <EconomicsCurveChart
            primary={toCurvePoints(primaryRows)}
            baseline={toCurvePoints(baselineRows)}
            primaryLabel={pair.primary.label}
            baselineLabel={pair.baseline.label}
            yUnit={pair.yUnit}
            width={720}
            height={320}
            ariaLabel={pair.title}
            className="max-w-full"
          />
          <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
            {pair.caption}
          </p>
        </section>
      )}

      {tableMetrics.map(([metric_key, dps]) => (
        <section
          key={metric_key}
          className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-neutral-300">
              {metric_key}
            </h3>
            <span className="text-[10px] text-neutral-500">
              {dps.length} datapoints · {dps[0]?.unit ?? ""}
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <th className="py-1.5 pr-2 font-medium">Year</th>
                <th className="py-1.5 pr-2 text-right font-medium">Value</th>
                <th className="py-1.5 pr-2 text-right font-medium">Confidence</th>
                <th className="py-1.5 pr-2 font-medium">Notes</th>
                <th className="py-1.5 pr-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {dps.map((d) => {
                const year = new Date(d.as_of).getUTCFullYear();
                const dim = d.confidence < 0.5;
                return (
                  <tr
                    key={d.id}
                    className={`border-b border-neutral-900/70 ${dim ? "opacity-60" : ""}`}
                  >
                    <td className="py-1.5 pr-2 font-mono tabular-nums text-neutral-300">
                      {year}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-neutral-200">
                      {d.value.toLocaleString("en-US", {
                        maximumFractionDigits: 3,
                      })}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-neutral-500">
                      {Math.round(d.confidence * 100)}%
                    </td>
                    <td className="py-1.5 pr-2 text-neutral-500">
                      {d.notes ?? ""}
                    </td>
                    <td className="py-1.5 pr-2">
                      <SourceChip
                        source={{
                          url: d.source_url,
                          kind: d.source_kind,
                          published_at: d.as_of,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <p className="text-[10px] italic text-neutral-600">
        Scenarios (baseline · optimistic · pessimistic) ship after MP5. Today's
        view shows the baseline scenario only — datapoints with confidence
        below 50% render at reduced opacity.
      </p>
    </div>
  );
}
