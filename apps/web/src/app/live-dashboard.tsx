"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  type LiveResponse,
  type OutputSchema,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import {
  COLORS,
  compactNumber,
  formatDriverValue,
  formatValue,
  GROUP_ORDER,
  prettyName,
} from "./shared";

const POLL_MS = 3000;
const WINDOW_SIZE = 30;

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initial: LiveResponse | null;
}

interface DriverTimePoint {
  tick: number;
  value: number;
}

interface OutputTimePoint {
  tick: number;
  value: number;
}

export function LiveDashboard({ meta, sensitivity, initial }: Props) {
  const [live, setLive] = useState<LiveResponse | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastFetch = useRef<number>(Date.now());

  const driverHistory = useRef<Map<string, DriverTimePoint[]>>(new Map());
  const outputHistory = useRef<Map<string, OutputTimePoint[]>>(new Map());
  const [, force] = useState(0);

  function ingest(r: LiveResponse) {
    for (const [name, value] of Object.entries(r.drivers)) {
      const arr = driverHistory.current.get(name) ?? [];
      arr.push({ tick: r.tick, value });
      if (arr.length > WINDOW_SIZE) arr.shift();
      driverHistory.current.set(name, arr);
    }
    for (const out of r.outputs) {
      if (out.scalar !== null && Number.isFinite(out.scalar)) {
        const arr = outputHistory.current.get(out.name) ?? [];
        arr.push({ tick: r.tick, value: out.scalar });
        if (arr.length > WINDOW_SIZE) arr.shift();
        outputHistory.current.set(out.name, arr);
      }
    }
    setLive(r);
    force((n) => n + 1);
  }

  // Seed history from initial snapshot.
  useEffect(() => {
    if (initial) ingest(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchLive(meta.slug);
        if (cancelled) return;
        ingest(r);
        setError(null);
        lastFetch.current = Date.now();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "unknown");
      }
    }
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [meta.slug, paused]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastFetch.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof meta.drivers>();
    for (const d of meta.drivers) {
      const k = d.group || "Other";
      const arr = m.get(k) ?? [];
      arr.push(d);
      m.set(k, arr);
    }
    return m;
  }, [meta.drivers]);
  const groupNames = useMemo(() => {
    const known = GROUP_ORDER.filter((g) => grouped.has(g));
    const extras = [...grouped.keys()].filter((g) => !GROUP_ORDER.includes(g));
    return [...known, ...extras];
  }, [grouped]);

  const scalarOutputs = live?.outputs.filter((o) => o.scalar !== null) ?? [];

  return (
    <div className="space-y-6">
      <LiveHeader
        tick={live?.tick ?? null}
        timestamp={live?.timestamp ?? null}
        secondsAgo={secondsAgo}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        error={error}
      />

      {/* Output KPIs with mini live charts */}
      <section>
        <SectionTitle title="Outputs" caption="실시간 시뮬레이션 결과 — 매 tick마다 재계산" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scalarOutputs.map((o) => (
            <LiveOutputCard
              key={o.name}
              output={o}
              history={outputHistory.current.get(o.name) ?? []}
            />
          ))}
        </div>
      </section>

      {/* Live driver values by group */}
      <section>
        <SectionTitle
          title="Inputs (auto-fetched)"
          caption="data-pipeline-service 시뮬레이션 — 각 드라이버가 실시간으로 드리프트"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groupNames.map((g) => (
            <div
              key={g}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
            >
              <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
                {g}
              </h3>
              <div className="space-y-3">
                {(grouped.get(g) ?? []).map((d) => (
                  <LiveDriverRow
                    key={d.name}
                    name={d.name}
                    unit={d.unit}
                    min={d.min}
                    max={d.max}
                    defaultValue={d.default}
                    value={live?.drivers[d.name] ?? d.default}
                    history={driverHistory.current.get(d.name) ?? []}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Series outputs as live full charts */}
      <section>
        <SectionTitle
          title="Projections"
          caption="현재 라이브 입력으로 미션 horizon 끝까지 투영"
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(live?.outputs ?? [])
            .filter((o) => o.series !== null)
            .filter((o) => !o.name.endsWith("_ground_usd") && !o.name.endsWith("_ground"))
            .map((o) => (
              <ProjectionCard
                key={o.name}
                output={o}
                allOutputs={live?.outputs ?? []}
              />
            ))}
        </div>
      </section>

      {sensitivity && (
        <section>
          <SectionTitle
            title="Sensitivity"
            caption="현재 베이스라인 기준 — 드라이버를 min↔max로 흔들었을 때 결과 변동폭"
          />
          <SensitivityCard sensitivity={sensitivity} outputs={scalarOutputs} />
        </section>
      )}
    </div>
  );
}

function LiveHeader({
  tick,
  timestamp,
  secondsAgo,
  paused,
  onTogglePause,
  error,
}: {
  tick: number | null;
  timestamp: string | null;
  secondsAgo: number;
  paused: boolean;
  onTogglePause: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-gradient-to-r from-neutral-900/60 via-neutral-900/40 to-neutral-900/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${
              paused
                ? "bg-amber-500"
                : error
                  ? "bg-red-500"
                  : "animate-ping bg-emerald-400 opacity-75"
            }`}
          />
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              paused ? "bg-amber-500" : error ? "bg-red-500" : "bg-emerald-400"
            }`}
          />
        </span>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
            {paused ? "Paused" : error ? "Error" : "Streaming"}
          </div>
          <div className="text-[11px] text-neutral-500">
            tick #{tick ?? "—"} · last update {secondsAgo}s ago
            {timestamp ? ` · ${timestamp.replace("T", " ").replace("+00:00", "Z")}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-[10px] uppercase tracking-wider text-neutral-600 sm:inline">
          poll every {POLL_MS / 1000}s · window {WINDOW_SIZE} ticks
        </span>
        <button
          onClick={onTogglePause}
          className="rounded-md border border-neutral-700 bg-neutral-800/70 px-3 py-1 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700"
        >
          {paused ? "▶ resume" : "❚❚ pause"}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
      <p className="text-[11px] text-neutral-500">{caption}</p>
    </div>
  );
}

function LiveDriverRow({
  name,
  unit,
  min,
  max,
  defaultValue,
  value,
  history,
}: {
  name: string;
  unit: string;
  min: number;
  max: number;
  defaultValue: number;
  value: number;
  history: DriverTimePoint[];
}) {
  const prev = history.length > 1 ? history[history.length - 2]!.value : value;
  const delta = value - prev;
  const pos = max - min === 0 ? 0 : ((value - min) / (max - min)) * 100;
  const trend = delta > 0.0001 ? "up" : delta < -0.0001 ? "down" : "flat";
  const trendColor =
    trend === "up" ? "text-emerald-300" : trend === "down" ? "text-rose-300" : "text-neutral-500";
  const trendArrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "—";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span
          className="truncate font-medium text-neutral-300"
          title={prettyName(name)}
        >
          {prettyName(name)}
        </span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <span className="text-sm font-semibold text-neutral-100">
            {formatDriverValue(value, unit)}
          </span>
          <span className={`text-[10px] ${trendColor}`}>{trendArrow}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-700 to-cyan-400 transition-all duration-700"
            style={{ width: `${Math.max(0, Math.min(100, pos))}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-neutral-500/70"
            style={{
              left: `${Math.max(0, Math.min(100, ((defaultValue - min) / (max - min)) * 100))}%`,
            }}
            title={`default ${formatDriverValue(defaultValue, unit)}`}
          />
        </div>
        <Sparkline data={history} color={COLORS.primary} />
      </div>
    </div>
  );
}

function Sparkline({
  data,
  color,
}: {
  data: { tick: number; value: number }[];
  color: string;
}) {
  if (data.length < 2) {
    return <div className="h-6 w-16 rounded bg-neutral-800/40" />;
  }
  return (
    <div className="h-6 w-16">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function LiveOutputCard({
  output,
  history,
}: {
  output: OutputSchema;
  history: OutputTimePoint[];
}) {
  const value = output.scalar ?? 0;
  const prev = history.length > 1 ? history[history.length - 2]!.value : value;
  const delta = value - prev;
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
  const trendColor =
    delta > 0.0001 ? "text-emerald-400" : delta < -0.0001 ? "text-rose-400" : "text-neutral-500";
  const trendArrow = delta > 0.0001 ? "▲" : delta < -0.0001 ? "▼" : "—";
  const stroke = isNpv && value < 0 ? COLORS.negative : COLORS.primary;

  return (
    <div className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700">
      <div className="absolute inset-0 -z-0 opacity-30">
        <ResponsiveContainer>
          <AreaChart
            data={history}
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={`g-${output.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={1.5}
              fill={`url(#g-${output.name})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            {prettyName(output.name)}
          </p>
          <span className={`text-[10px] tabular-nums ${trendColor}`}>
            {trendArrow}
            {history.length > 1 && Math.abs(delta) > 0.0001
              ? ` ${formatDelta(delta, output.unit)}`
              : ""}
          </span>
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>
          {isBreakeven && value < 0 ? "no break-even" : formatValue(value, output.unit)}
        </p>
        {output.description && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
            {output.description}
          </p>
        )}
      </div>
    </div>
  );
}

function ProjectionCard({
  output,
  allOutputs,
}: {
  output: OutputSchema;
  allOutputs: OutputSchema[];
}) {
  // Pair "_space_usd" with "_ground_usd" peer where applicable.
  const peer = allOutputs.find((o) =>
    output.name.endsWith("_space_usd")
      ? o.name === output.name.replace("_space_usd", "_ground_usd")
      : output.name.endsWith("_space")
        ? o.name === output.name.replace("_space", "_ground")
        : false,
  );
  const series = output.series ?? [];
  const peerSeries = peer?.series ?? null;
  const length = Math.max(series.length, peerSeries?.length ?? 0);
  const data = Array.from({ length }, (_, year) => {
    const row: Record<string, number | string> = { year };
    if (series[year] !== undefined && Number.isFinite(series[year])) {
      row[peer ? "space" : prettyName(output.name)] = series[year]!;
    }
    if (peerSeries && peerSeries[year] !== undefined && Number.isFinite(peerSeries[year])) {
      row.ground = peerSeries[year]!;
    }
    return row;
  });

  const title = peer
    ? prettyName(output.name.replace(/_(space|ground)(_usd)?$/, ""))
    : prettyName(output.name);
  const keys = peer ? ["space", "ground"] : [prettyName(output.name)];
  const colorMap: Record<string, string> = {
    space: COLORS.primary,
    ground: COLORS.secondary,
    [prettyName(output.name)]: COLORS.primary,
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-100">
          {title}
          {output.unit && (
            <span className="ml-2 text-xs font-normal text-neutral-500">
              ({output.unit})
            </span>
          )}
        </h3>
        {peer && (
          <div className="flex items-center gap-3 text-[10px] text-neutral-500">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: COLORS.primary }}
              />
              space
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: COLORS.secondary }}
              />
              ground
            </span>
          </div>
        )}
      </div>
      {output.description && (
        <p className="mt-1 text-[11px] text-neutral-500">{output.description}</p>
      )}
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
              formatter={(v: number) => formatValue(v, output.unit)}
              labelFormatter={(y) => `year ${y}`}
            />
            {keys.map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colorMap[k]}
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
  const initialOutput =
    outputs.find((o) => o.name === "npv_savings_vs_ground_usd")?.name ?? availableOutputs[0];
  const [selected, setSelected] = useState<string>(initialOutput ?? "");
  if (!selected || availableOutputs.length === 0) return null;

  const entries = sensitivity.by_output[selected] ?? [];
  const top = entries.slice(0, 10);
  const unit = outputs.find((o) => o.name === selected)?.unit ?? "";
  const data = top
    .map((e) => ({ driver: prettyName(e.driver), swing: e.swing }))
    .reverse();

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] text-neutral-500">
          막대 길이 = 그 드라이버의 영향력. 청록=positive, 적색=negative swing.
        </p>
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

function formatDelta(delta: number, unit: string): string {
  const sign = delta > 0 ? "+" : "";
  return sign + formatValue(delta, unit);
}
