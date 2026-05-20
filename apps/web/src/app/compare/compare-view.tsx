"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  DriverSchema,
  OutputSchema,
  Scenario,
  SimMetadata,
} from "@/lib/sim-client";

import {
  COLORS,
  compactNumber,
  formatDriverValue,
  formatValue,
  pairSeries,
  prettyName,
  seriesLabel,
  type SeriesPair,
} from "../shared";
import type { ResolvedSide } from "./page";

interface Props {
  meta: SimMetadata;
  scenarios: Scenario[];
  a: ResolvedSide;
  b: ResolvedSide;
  defaultsSentinel: string;
}

const SIDE_COLORS = {
  a: "#22d3ee", // cyan — also COLORS.primary
  b: "#f97316", // orange — matches the existing "ground" line
};

export function CompareView({ meta, scenarios, a, b, defaultsSentinel }: Props) {
  const router = useRouter();

  function nav(nextA: string, nextB: string) {
    const params = new URLSearchParams({
      sector: meta.slug,
      a: nextA,
      b: nextB,
    });
    router.push(`/compare?${params.toString()}`);
  }

  // Scalars are paired by name (A's npv_ vs B's npv_). Series are paired by
  // the same suffix-stripping rule as the manual panel, but keys are
  // suffixed __a / __b on the chart row so two scenarios can overlay
  // independently.
  const scalarPairs = useMemo(
    () => pairScalars(a.outputs, b.outputs),
    [a.outputs, b.outputs],
  );
  const seriesPairs = useMemo(
    () => pairSeriesAcrossSides(a.outputs, b.outputs),
    [a.outputs, b.outputs],
  );
  const driverDiff = useMemo(
    () => collectDriverDiff(meta.drivers, a.drivers, b.drivers),
    [meta.drivers, a.drivers, b.drivers],
  );

  return (
    <div className="space-y-6">
      <PickerRow
        scenarios={scenarios}
        side="A"
        currentKey={a.key}
        otherKey={b.key}
        color={SIDE_COLORS.a}
        defaultsSentinel={defaultsSentinel}
        onChange={(next) => nav(next, b.key)}
      />
      <PickerRow
        scenarios={scenarios}
        side="B"
        currentKey={b.key}
        otherKey={a.key}
        color={SIDE_COLORS.b}
        defaultsSentinel={defaultsSentinel}
        onChange={(next) => nav(a.key, next)}
      />

      <ScalarDiffGrid pairs={scalarPairs} aLabel={a.label} bLabel={b.label} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {seriesPairs.map((p) => (
          <CompareSeriesCard
            key={p.key}
            pair={p}
            aLabel={a.label}
            bLabel={b.label}
          />
        ))}
      </div>

      <DriverDiffTable
        rows={driverDiff}
        aLabel={a.label}
        bLabel={b.label}
      />
    </div>
  );
}

function PickerRow({
  scenarios,
  side,
  currentKey,
  otherKey,
  color,
  defaultsSentinel,
  onChange,
}: {
  scenarios: Scenario[];
  side: "A" | "B";
  currentKey: string;
  otherKey: string;
  color: string;
  defaultsSentinel: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-neutral-950"
        style={{ backgroundColor: color }}
      >
        {side}
      </span>
      <select
        value={currentKey}
        onChange={(e) => {
          const v = e.target.value;
          if (v === otherKey) return; // ignore — can't compare to self
          onChange(v);
        }}
        className="min-w-[220px] rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
      >
        <option value={defaultsSentinel}>— defaults —</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id} disabled={s.id === otherKey}>
            {s.name}
            {s.id === otherKey ? " (other side)" : ""}
          </option>
        ))}
      </select>
      <span className="text-[11px] text-neutral-500">
        {currentKey === defaultsSentinel
          ? "sector defaults"
          : `${Object.keys(scenarios.find((s) => s.id === currentKey)?.driver_overrides ?? {}).length} overrides`}
      </span>
    </div>
  );
}

interface ScalarPair {
  name: string;
  unit: string;
  description: string;
  aValue: number | null;
  bValue: number | null;
}

function pairScalars(
  aOuts: OutputSchema[],
  bOuts: OutputSchema[],
): ScalarPair[] {
  const order: string[] = [];
  const aMap = new Map<string, OutputSchema>();
  const bMap = new Map<string, OutputSchema>();
  for (const o of aOuts) {
    if (o.scalar === null) continue;
    aMap.set(o.name, o);
    order.push(o.name);
  }
  for (const o of bOuts) {
    if (o.scalar === null) continue;
    bMap.set(o.name, o);
    if (!order.includes(o.name)) order.push(o.name);
  }
  return order.map((name) => {
    const a = aMap.get(name);
    const b = bMap.get(name);
    return {
      name,
      unit: a?.unit ?? b?.unit ?? "",
      description: a?.description ?? b?.description ?? "",
      aValue: a?.scalar ?? null,
      bValue: b?.scalar ?? null,
    };
  });
}

function ScalarDiffGrid({
  pairs,
  aLabel,
  bLabel,
}: {
  pairs: ScalarPair[];
  aLabel: string;
  bLabel: string;
}) {
  if (pairs.length === 0) return null;
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">
        Scalar outputs
        <span className="ml-2 text-[11px] font-normal text-neutral-500">
          {aLabel} vs {bLabel}
        </span>
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pairs.map((p) => (
          <ScalarDiffCard key={p.name} pair={p} />
        ))}
      </div>
    </div>
  );
}

function ScalarDiffCard({ pair }: { pair: ScalarPair }) {
  const { name, unit, aValue, bValue } = pair;
  const delta =
    aValue !== null && bValue !== null && Number.isFinite(aValue) && Number.isFinite(bValue)
      ? bValue - aValue
      : null;
  const deltaPct =
    delta !== null && aValue !== null && Math.abs(aValue) > 1e-9
      ? (delta / Math.abs(aValue)) * 100
      : null;

  // For "lower is better" outputs (cost, break-even year), positive delta
  // (B is higher) is *worse* — we don't try to infer this from the name and
  // just colour by sign. Users have the labels; the colour just signals
  // direction.
  const deltaColor =
    delta === null
      ? "text-neutral-400"
      : delta > 0
        ? "text-emerald-300"
        : delta < 0
          ? "text-rose-300"
          : "text-neutral-400";

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/50 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {prettyName(name)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] text-cyan-400">A</div>
          <div className="font-semibold tabular-nums text-neutral-100">
            {fmtScalar(aValue, unit, name)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-orange-400">B</div>
          <div className="font-semibold tabular-nums text-neutral-100">
            {fmtScalar(bValue, unit, name)}
          </div>
        </div>
      </div>
      <div className={`mt-2 border-t border-neutral-800 pt-2 text-[11px] tabular-nums ${deltaColor}`}>
        {delta === null ? (
          <span className="text-neutral-600">— delta not available</span>
        ) : (
          <>
            <span>
              Δ {delta > 0 ? "+" : ""}
              {formatValue(delta, unit)}
            </span>
            {deltaPct !== null && (
              <span className="ml-1.5 text-neutral-500">
                ({deltaPct > 0 ? "+" : ""}
                {deltaPct.toFixed(1)}%)
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function fmtScalar(v: number | null, unit: string, name: string): string {
  if (v === null) return "—";
  if (name === "break_even_year" && v < 0) return "no break-even";
  return formatValue(v, unit);
}

/**
 * Take A's series outputs and B's series outputs, group them by the same
 * key the manual panel uses, and unify the resulting pairs so each pair
 * has a known list of outputs and each side knows which it contributed.
 */
interface CompareSeries {
  /** Stable line key on the row (e.g. "tco_space__a"). */
  rowKey: string;
  /** Visible label in legend + tooltip. */
  label: string;
  /** Series numbers, indexed by year. */
  values: (number | undefined)[];
  /** Hex colour. */
  color: string;
  /** dashed line indicates B; helps when colour is missed. */
  dashed: boolean;
}

interface CompareSeriesPair {
  key: string;
  title: string;
  unit: string;
  description: string;
  length: number;
  lines: CompareSeries[];
}

function pairSeriesAcrossSides(
  aOuts: OutputSchema[],
  bOuts: OutputSchema[],
): CompareSeriesPair[] {
  const aPairs = pairSeries(aOuts.filter((o) => o.series !== null));
  const bPairs = pairSeries(bOuts.filter((o) => o.series !== null));

  const order: string[] = [];
  const merged = new Map<string, { a?: SeriesPair; b?: SeriesPair }>();

  for (const p of aPairs) {
    merged.set(p.key, { a: p });
    order.push(p.key);
  }
  for (const p of bPairs) {
    const cur = merged.get(p.key) ?? {};
    cur.b = p;
    merged.set(p.key, cur);
    if (!order.includes(p.key)) order.push(p.key);
  }

  return order.map((key) => {
    const { a, b } = merged.get(key)!;
    const meta = a ?? b!;
    const length = Math.max(
      ...(a?.outputs.map((o) => o.series?.length ?? 0) ?? [0]),
      ...(b?.outputs.map((o) => o.series?.length ?? 0) ?? [0]),
    );
    const lines: CompareSeries[] = [];
    if (a) {
      // Within one side there can be paired series (space vs ground) — keep
      // them, but tag each with side colour and an "A · ground"-style label.
      a.outputs.forEach((out) => {
        lines.push({
          rowKey: `${out.name}__a`,
          label: a.outputs.length > 1 ? `A · ${seriesLabel(out)}` : "A",
          values: out.series ?? [],
          color: SIDE_COLORS.a,
          dashed: false,
        });
      });
    }
    if (b) {
      b.outputs.forEach((out) => {
        lines.push({
          rowKey: `${out.name}__b`,
          label: (b.outputs.length ?? 0) > 1 ? `B · ${seriesLabel(out)}` : "B",
          values: out.series ?? [],
          color: SIDE_COLORS.b,
          dashed: true,
        });
      });
    }
    return {
      key,
      title: meta.title,
      unit: meta.unit,
      description: meta.description,
      length,
      lines,
    };
  });
}

function CompareSeriesCard({
  pair,
  aLabel,
  bLabel,
}: {
  pair: CompareSeriesPair;
  aLabel: string;
  bLabel: string;
}) {
  const data = Array.from({ length: pair.length }, (_, year) => {
    const row: Record<string, number | string> = { year };
    for (const line of pair.lines) {
      const v = line.values[year];
      if (v !== undefined && Number.isFinite(v)) row[line.rowKey] = v;
    }
    return row;
  });

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <h3 className="text-sm font-medium text-neutral-100">
        {pair.title}
        {pair.unit && <span className="ml-2 text-xs text-neutral-500">({pair.unit})</span>}
      </h3>
      {pair.description && (
        <p className="mt-1 text-[11px] text-neutral-500">{pair.description}</p>
      )}
      <p className="mt-1 text-[10px] text-neutral-600">
        <span className="text-cyan-400">A</span> = {aLabel} ·{" "}
        <span className="text-orange-400">B</span> = {bLabel} (dashed)
      </p>
      <div className="mt-3 h-56">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke={COLORS.muted} fontSize={11} />
            <YAxis
              stroke={COLORS.muted}
              fontSize={11}
              tickFormatter={(v) => compactNumber(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${COLORS.grid}`,
                fontSize: 12,
              }}
              formatter={(v: number) => formatValue(v, pair.unit)}
              labelFormatter={(y) => `year ${y}`}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} />
            {pair.lines.map((line) => (
              <Line
                key={line.rowKey}
                type="monotone"
                dataKey={line.rowKey}
                name={line.label}
                stroke={line.color}
                strokeDasharray={line.dashed ? "4 3" : undefined}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface DriverDiffRow {
  driver: DriverSchema;
  aValue: number;
  bValue: number;
}

function collectDriverDiff(
  drivers: DriverSchema[],
  aVals: Record<string, number>,
  bVals: Record<string, number>,
): DriverDiffRow[] {
  const rows: DriverDiffRow[] = [];
  for (const d of drivers) {
    const av = aVals[d.name] ?? d.default;
    const bv = bVals[d.name] ?? d.default;
    if (Math.abs(av - bv) > 1e-9) rows.push({ driver: d, aValue: av, bValue: bv });
  }
  // Largest absolute delta first — surfaces what actually differs between
  // the two scenarios at a glance.
  rows.sort(
    (x, y) =>
      Math.abs(y.aValue - y.bValue) / Math.max(Math.abs(y.driver.default), 1) -
      Math.abs(x.aValue - x.bValue) / Math.max(Math.abs(x.driver.default), 1),
  );
  return rows;
}

function DriverDiffTable({
  rows,
  aLabel,
  bLabel,
}: {
  rows: DriverDiffRow[];
  aLabel: string;
  bLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 text-xs text-neutral-500">
        두 시나리오의 드라이버 값이 모두 동일합니다.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">
        Driver differences
        <span className="ml-2 text-[11px] font-normal text-neutral-500">
          {rows.length} driver{rows.length === 1 ? "" : "s"} differ
        </span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="pb-2 pr-3 font-medium">Driver</th>
              <th className="pb-2 pr-3 font-medium text-cyan-400">A · {aLabel}</th>
              <th className="pb-2 pr-3 font-medium text-orange-400">B · {bLabel}</th>
              <th className="pb-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="text-neutral-200">
            {rows.map(({ driver, aValue, bValue }) => {
              const delta = bValue - aValue;
              return (
                <tr key={driver.name} className="border-t border-neutral-800/60">
                  <td className="py-1.5 pr-3 text-neutral-300">
                    {prettyName(driver.name)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatDriverValue(aValue, driver.unit)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatDriverValue(bValue, driver.unit)}
                  </td>
                  <td
                    className={`py-1.5 tabular-nums ${
                      delta > 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {delta > 0 ? "+" : ""}
                    {formatDriverValue(delta, driver.unit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
