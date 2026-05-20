"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchLive,
  runSim,
  type DriverSchema,
  type OutputSchema,
  type ProvenanceSchema,
  type SensitivityEntry,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import {
  COLORS,
  compactNumber,
  formatDriverValue,
  formatValue,
  GROUP_ORDER,
  pairSeries,
  prettyName,
  seriesLabel,
  type SeriesPair,
} from "./shared";

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
}

export function ManualPanel({ meta, sensitivity }: Props) {
  const initial = useMemo(
    () => Object.fromEntries(meta.drivers.map((d) => [d.name, d.default])),
    [meta.drivers],
  );

  const [values, setValues] = useState<Record<string, number>>(initial);
  const [outputs, setOutputs] = useState<OutputSchema[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void runSim(meta.slug, values)
        .then((res) => {
          if (cancelled) return;
          setOutputs(res.outputs);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "unknown error");
        });
    });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, values]);

  const grouped = useMemo(() => groupBy(meta.drivers, (d) => d.group || "Other"), [meta.drivers]);
  const groupNames = useMemo(() => {
    const known = GROUP_ORDER.filter((g) => grouped.has(g));
    const extras = [...grouped.keys()].filter((g) => !GROUP_ORDER.includes(g));
    return [...known, ...extras];
  }, [grouped]);

  const scalarOutputs = outputs.filter((o) => o.scalar !== null);
  const seriesOutputs = outputs.filter((o) => o.series !== null);
  const pairs = pairSeries(seriesOutputs);

  function applyPreset(name: string) {
    const overrides = meta.presets[name] ?? {};
    setValues({ ...initial, ...overrides });
    setActivePreset(name);
  }

  function resetAll() {
    setValues(initial);
    setActivePreset(null);
  }

  async function initFromLive() {
    try {
      const r = await fetchLive(meta.slug);
      setValues(r.drivers);
      setActivePreset(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "live fetch failed");
    }
  }

  const dirty = useMemo(
    () => meta.drivers.some((d) => Math.abs((values[d.name] ?? d.default) - d.default) > 1e-9),
    [meta.drivers, values],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      <aside className="space-y-5 lg:sticky lg:top-[120px] lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto lg:pr-2">
        <PresetBar
          presets={Object.keys(meta.presets)}
          active={activePreset}
          dirty={dirty}
          onSelect={applyPreset}
          onReset={resetAll}
          onInitFromLive={initFromLive}
        />
        {groupNames.map((g) => (
          <DriverGroup
            key={g}
            name={g}
            drivers={grouped.get(g) ?? []}
            values={values}
            provenance={meta.provenance}
            onChange={(name, n) => {
              setActivePreset(null);
              setValues((prev) => ({ ...prev, [name]: n }));
            }}
          />
        ))}
        {error && (
          <p className="rounded border border-red-900 bg-red-950/50 p-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </aside>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Outputs{" "}
            <span className="ml-1 text-[11px] font-normal text-neutral-500">
              현재 슬라이더 값으로 계산
            </span>
          </h2>
          {isPending && (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              simulating…
            </span>
          )}
        </div>
        <ScalarGrid outputs={scalarOutputs} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {pairs.map((p) => (
            <SeriesCard key={p.key} pair={p} />
          ))}
        </div>
        {sensitivity && <SensitivityCard sensitivity={sensitivity} outputs={scalarOutputs} />}
        {outputs.length === 0 && !error && (
          <p className="text-sm text-neutral-500">시뮬레이션 실행 중…</p>
        )}
      </section>
    </div>
  );
}

function PresetBar({
  presets,
  active,
  dirty,
  onSelect,
  onReset,
  onInitFromLive,
}: {
  presets: string[];
  active: string | null;
  dirty: boolean;
  onSelect: (name: string) => void;
  onReset: () => void;
  onInitFromLive: () => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Scenario presets
          {dirty && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          )}
        </span>
        <div className="flex gap-3">
          <button
            onClick={onInitFromLive}
            className="text-[11px] text-cyan-400 underline-offset-4 hover:underline"
            title="현재 라이브 데이터로 드라이버 초기화"
          >
            ↻ from live
          </button>
          <button
            onClick={onReset}
            className="text-[11px] text-neutral-500 underline-offset-4 hover:text-neutral-300 hover:underline"
          >
            reset
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const isActive = active === p;
          return (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                isActive
                  ? "bg-cyan-500 text-neutral-950 shadow-sm shadow-cyan-500/30"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DriverGroup({
  name,
  drivers,
  values,
  provenance,
  onChange,
}: {
  name: string;
  drivers: DriverSchema[];
  values: Record<string, number>;
  provenance: Record<string, ProvenanceSchema>;
  onChange: (name: string, n: number) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <h3 className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
        {name}
      </h3>
      <div className="space-y-4">
        {drivers.map((d) => (
          <DriverSlider
            key={d.name}
            driver={d}
            value={values[d.name] ?? d.default}
            provenance={provenance[d.name] ?? null}
            onChange={(n) => onChange(d.name, n)}
          />
        ))}
      </div>
    </div>
  );
}

function DriverSlider({
  driver,
  value,
  provenance,
  onChange,
}: {
  driver: DriverSchema;
  value: number;
  provenance: ProvenanceSchema | null;
  onChange: (n: number) => void;
}) {
  const step = (driver.max - driver.min) / 200;
  const isDirty = Math.abs(value - driver.default) > 1e-9;
  const histPts = provenance?.history ?? [];

  return (
    <div>
      <label className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-neutral-200">{prettyName(driver.name)}</span>
        <span
          className={`tabular-nums ${isDirty ? "text-cyan-300" : "text-neutral-400"}`}
        >
          {formatDriverValue(value, driver.unit)}
        </span>
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="range"
          min={driver.min}
          max={driver.max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-cyan-400"
        />
        {histPts.length >= 2 && (
          <div className="h-6 w-14 shrink-0">
            <ResponsiveContainer>
              <LineChart
                data={histPts.map((h) => ({ date: h.date, value: h.value }))}
                margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
              >
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS.muted}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[10px] text-neutral-600 tabular-nums">
        <span>{formatDriverValue(driver.min, driver.unit)}</span>
        <span title={`default ${formatDriverValue(driver.default, driver.unit)}`}>
          default {formatDriverValue(driver.default, driver.unit)}
        </span>
        <span>{formatDriverValue(driver.max, driver.unit)}</span>
      </div>
      {driver.description && (
        <p className="mt-1 text-[11px] leading-snug text-neutral-500">
          {driver.description}
        </p>
      )}
    </div>
  );
}

function ScalarGrid({ outputs }: { outputs: OutputSchema[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {outputs.map((o) => (
        <ScalarCard key={o.name} output={o} />
      ))}
    </div>
  );
}

function ScalarCard({ output }: { output: OutputSchema }) {
  const value = output.scalar ?? 0;
  const isBreakeven = output.name === "break_even_year";
  const isNpv = output.name.startsWith("npv_");
  const accent = isNpv
    ? value > 0
      ? "text-emerald-300"
      : value < 0
        ? "text-rose-300"
        : "text-neutral-100"
    : isBreakeven && value < 0
      ? "text-rose-300"
      : "text-neutral-100";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700">
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {prettyName(output.name)}
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>
        {isBreakeven && value < 0
          ? "no break-even"
          : formatValue(value, output.unit)}
      </p>
      {output.description && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
          {output.description}
        </p>
      )}
    </div>
  );
}

function SeriesCard({ pair }: { pair: SeriesPair }) {
  const length = Math.max(...pair.outputs.map((o) => o.series?.length ?? 0));
  const data = Array.from({ length }, (_, year) => {
    const row: Record<string, number | string> = { year };
    for (const out of pair.outputs) {
      const v = out.series?.[year];
      if (v !== undefined && Number.isFinite(v)) row[seriesLabel(out)] = v;
    }
    return row;
  });
  const lineColors = [COLORS.primary, COLORS.secondary, COLORS.tertiary];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <h2 className="text-sm font-medium text-neutral-100">
        {pair.title}
        {pair.unit && <span className="ml-2 text-xs text-neutral-500">({pair.unit})</span>}
      </h2>
      {pair.description && (
        <p className="mt-1 text-[11px] text-neutral-500">{pair.description}</p>
      )}
      <div className="mt-3 h-56">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke={COLORS.muted} fontSize={11} />
            <YAxis stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => compactNumber(v)} />
            <Tooltip
              contentStyle={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${COLORS.grid}`,
                fontSize: 12,
              }}
              formatter={(v: number) => formatValue(v, pair.unit)}
              labelFormatter={(y) => `year ${y}`}
            />
            {pair.outputs.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} />
            )}
            {pair.outputs.map((out, i) => (
              <Line
                key={out.name}
                type="monotone"
                dataKey={seriesLabel(out)}
                stroke={lineColors[i % lineColors.length]}
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

function SensitivityCard({
  sensitivity,
  outputs,
}: {
  sensitivity: SensitivityResponse;
  outputs: OutputSchema[];
}) {
  const availableOutputs = Object.keys(sensitivity.by_output);
  const initialOutput = outputs.find((o) => o.name === "npv_savings_vs_ground_usd")?.name
    ?? availableOutputs[0];
  const [selected, setSelected] = useState<string>(initialOutput ?? "");

  if (!selected || availableOutputs.length === 0) return null;

  const entries: SensitivityEntry[] = sensitivity.by_output[selected] ?? [];
  const top = entries.slice(0, 10);
  const unit = outputs.find((o) => o.name === selected)?.unit ?? "";

  const data = top
    .map((e) => ({
      driver: prettyName(e.driver),
      swing: e.swing,
    }))
    .reverse();

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">Sensitivity (tornado)</h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
        >
          {availableOutputs.map((o) => (
            <option key={o} value={o}>
              {prettyName(o)}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        각 드라이버를 min↔max로 휘둘렀을 때 결과의 swing. 막대 길이가 길수록 그 드라이버에 더 민감.
      </p>
      <div className="mt-3 h-72">
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 90, bottom: 0 }}
          >
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              stroke={COLORS.muted}
              fontSize={11}
              tickFormatter={(v) => compactNumber(v)}
            />
            <YAxis
              type="category"
              dataKey="driver"
              stroke="#a3a3a3"
              tick={{ fontSize: 11 }}
              width={140}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${COLORS.grid}`,
                fontSize: 12,
              }}
              formatter={(v: number) => formatValue(v, unit)}
            />
            <ReferenceLine x={0} stroke="#525252" />
            <Bar dataKey="swing" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.driver} fill={d.swing >= 0 ? COLORS.primary : COLORS.negative} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
