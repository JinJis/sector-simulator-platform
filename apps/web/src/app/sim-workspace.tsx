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
  runSim,
  type DriverSchema,
  type OutputSchema,
  type SensitivityEntry,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
}

const GROUP_ORDER = ["Launch", "Compute", "Power", "Thermal", "Economics"];

export function SimWorkspace({ meta, sensitivity }: Props) {
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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-5">
        <PresetBar
          presets={Object.keys(meta.presets)}
          active={activePreset}
          onSelect={applyPreset}
          onReset={resetAll}
        />
        {groupNames.map((g) => (
          <DriverGroup
            key={g}
            name={g}
            drivers={grouped.get(g) ?? []}
            values={values}
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
        {isPending && <p className="text-xs text-neutral-500">simulating…</p>}
      </aside>

      <section className="space-y-6">
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

// ----- Subcomponents -----

function PresetBar({
  presets,
  active,
  onSelect,
  onReset,
}: {
  presets: string[];
  active: string | null;
  onSelect: (name: string) => void;
  onReset: () => void;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Scenario presets
        </span>
        <button
          onClick={onReset}
          className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-300 hover:underline"
        >
          reset
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const isActive = active === p;
          return (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                isActive
                  ? "bg-cyan-500 text-neutral-950"
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
  onChange,
}: {
  name: string;
  drivers: DriverSchema[];
  values: Record<string, number>;
  onChange: (name: string, n: number) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-400">
        {name}
      </h3>
      <div className="space-y-4">
        {drivers.map((d) => (
          <DriverSlider
            key={d.name}
            driver={d}
            value={values[d.name] ?? d.default}
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
  onChange,
}: {
  driver: DriverSchema;
  value: number;
  onChange: (n: number) => void;
}) {
  const step = (driver.max - driver.min) / 200;
  return (
    <div>
      <label className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{prettyName(driver.name)}</span>
        <span className="text-neutral-400">
          {formatDriverValue(value, driver.unit)}
        </span>
      </label>
      <input
        type="range"
        min={driver.min}
        max={driver.max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-cyan-400"
      />
      {driver.description && (
        <p className="mt-1 text-xs text-neutral-500">{driver.description}</p>
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
      ? "text-emerald-400"
      : value < 0
        ? "text-rose-400"
        : "text-neutral-200"
    : isBreakeven && value < 0
      ? "text-rose-400"
      : "text-neutral-100";

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {prettyName(output.name)}
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>
        {isBreakeven && value < 0
          ? "no break-even"
          : formatValue(value, output.unit)}
      </p>
      {output.description && (
        <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
          {output.description}
        </p>
      )}
    </div>
  );
}

interface SeriesPair {
  key: string;
  title: string;
  unit: string;
  description: string;
  outputs: OutputSchema[];
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
  const colors = ["#22d3ee", "#f97316", "#a3e635"];

  return (
    <div className="rounded border border-neutral-800 p-4">
      <h2 className="text-sm font-medium">
        {pair.title}
        {pair.unit && <span className="ml-2 text-neutral-500">({pair.unit})</span>}
      </h2>
      {pair.description && (
        <p className="mt-1 text-xs text-neutral-500">{pair.description}</p>
      )}
      <div className="mt-3 h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke="#737373" />
            <YAxis stroke="#737373" tickFormatter={(v) => compactNumber(v)} />
            <Tooltip
              contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #262626" }}
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
                stroke={colors[i % colors.length]}
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
    .reverse(); // recharts BarChart with layout="vertical": last item is on top

  return (
    <div className="rounded border border-neutral-800 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Sensitivity (tornado)</h2>
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
      <p className="mt-1 text-xs text-neutral-500">
        각 드라이버를 min↔max로 휘둘렀을 때 결과의 swing. 막대 길이가 길수록 그 드라이버에 더 민감.
      </p>
      <div className="mt-3 h-72">
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 90, bottom: 0 }}
          >
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              stroke="#737373"
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
              contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #262626" }}
              formatter={(v: number) => formatValue(v, unit)}
            />
            <ReferenceLine x={0} stroke="#525252" />
            <Bar dataKey="swing" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.driver} fill={d.swing >= 0 ? "#22d3ee" : "#f87171"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----- helpers -----

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

function pairSeries(series: OutputSchema[]): SeriesPair[] {
  // Pair outputs by stripping _space_usd / _ground_usd / similar suffixes.
  const pairs = new Map<string, OutputSchema[]>();
  const order: string[] = [];
  for (const out of series) {
    const key = out.name
      .replace(/_(space|ground)_usd$/, "")
      .replace(/_(space|ground)$/, "");
    if (!pairs.has(key)) {
      pairs.set(key, []);
      order.push(key);
    }
    pairs.get(key)!.push(out);
  }
  return order.map((key) => {
    const outputs = pairs.get(key)!;
    return {
      key,
      title: prettyName(key),
      unit: outputs[0].unit,
      description: outputs[0].description,
      outputs,
    };
  });
}

function seriesLabel(out: OutputSchema): string {
  if (/_space_usd$/.test(out.name) || /_space$/.test(out.name)) return "space";
  if (/_ground_usd$/.test(out.name) || /_ground$/.test(out.name)) return "ground";
  return prettyName(out.name);
}

function prettyName(snake: string): string {
  return snake
    .replace(/_/g, " ")
    .replace(/\busd\b/gi, "USD")
    .replace(/\bpflops\b/gi, "PFLOPS")
    .replace(/\bnpv\b/gi, "NPV")
    .replace(/\bpct\b/gi, "%")
    .replace(/\byr\b/gi, "yr")
    .replace(/\bkw\b/gi, "kW")
    .replace(/\bw\b/gi, "W")
    .replace(/\bkg\b/gi, "kg")
    .replace(/\s+per\s+/g, "/")
    .trim();
}

function formatDriverValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  let body: string;
  if (Number.isInteger(v) && abs < 1000) body = v.toFixed(0);
  else if (abs >= 1000) body = v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  else if (abs >= 10) body = v.toFixed(1);
  else body = v.toFixed(2);
  return unit ? `${body} ${unit}` : body;
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (unit === "USD" || unit === "$") {
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  if (unit === "yr") return `${v.toFixed(1)} yr`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M ${unit}`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k ${unit}`;
  if (abs >= 10) return `${v.toFixed(1)} ${unit}`;
  return `${v.toFixed(2)} ${unit}`;
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}
