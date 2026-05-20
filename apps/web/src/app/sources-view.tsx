"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  DriverSchema,
  ProvenanceSchema,
  SimMetadata,
  SourceSchema,
} from "@/lib/sim-client";

import {
  COLORS,
  compactNumber,
  formatDriverValue,
  GROUP_ORDER,
  prettyName,
} from "./shared";

interface Props {
  meta: SimMetadata;
}

export function SourcesView({ meta }: Props) {
  const [filter, setFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const set = new Set(meta.drivers.map((d) => d.group || "Other"));
    const known = GROUP_ORDER.filter((g) => set.has(g));
    const extras = [...set].filter((g) => !GROUP_ORDER.includes(g));
    return ["All", ...known, ...extras];
  }, [meta.drivers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meta.drivers.filter((d) => {
      if (filter !== "All" && (d.group || "Other") !== filter) return false;
      if (!q) return true;
      const hay = [d.name, d.description, meta.provenance[d.name]?.note ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filter, search, meta.drivers, meta.provenance]);

  const totalSources = useMemo(
    () =>
      Object.values(meta.provenance).reduce(
        (acc, p) => acc + (p.sources?.length ?? 0),
        0,
      ),
    [meta.provenance],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-800 bg-gradient-to-r from-neutral-900/60 via-neutral-900/30 to-neutral-900/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              Data provenance
            </h2>
            <p className="text-[11px] text-neutral-500">
              각 드라이버별 과거→현재 데이터와 출처 인용. 토글로 근거 펼치기.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-neutral-500">
            <span>
              <span className="font-semibold text-neutral-300">
                {meta.drivers.length}
              </span>{" "}
              drivers
            </span>
            <span className="text-neutral-700">·</span>
            <span>
              <span className="font-semibold text-neutral-300">
                {totalSources}
              </span>{" "}
              cited sources
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setFilter(g)}
                className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                  filter === g
                    ? "bg-cyan-500 text-neutral-950"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search drivers, notes…"
            className="w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-cyan-700 focus:outline-none sm:w-64"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((d) => (
          <ProvenanceCard
            key={d.name}
            driver={d}
            provenance={meta.provenance[d.name] ?? null}
          />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-2 rounded border border-neutral-800 bg-neutral-900/30 p-6 text-center text-sm text-neutral-500">
            no drivers match the current filter.
          </p>
        )}
      </div>
    </div>
  );
}

function ProvenanceCard({
  driver,
  provenance,
}: {
  driver: DriverSchema;
  provenance: ProvenanceSchema | null;
}) {
  const [open, setOpen] = useState(false);

  const historyData = useMemo(() => {
    if (!provenance) return [];
    return provenance.history.map((h) => ({
      date: h.date,
      value: h.value,
      // Estimate vs actual flag based on trailing 'E' or '?' marker.
      estimate: /[Ee?]$/.test(h.date),
    }));
  }, [provenance]);

  const currentValue = useMemo(() => {
    const latest = provenance?.history[provenance.history.length - 1];
    return latest?.value ?? driver.default;
  }, [provenance, driver.default]);

  const firstValue = useMemo(() => provenance?.history[0]?.value, [provenance]);
  const changePct =
    firstValue !== undefined && firstValue !== 0
      ? ((currentValue - firstValue) / Math.abs(firstValue)) * 100
      : null;

  const sourceCount = provenance?.sources.length ?? 0;
  const accent =
    changePct === null
      ? "text-neutral-400"
      : changePct > 0
        ? "text-emerald-300"
        : changePct < 0
          ? "text-rose-300"
          : "text-neutral-400";

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40 transition hover:border-neutral-700">
      <div className="border-b border-neutral-800/70 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-neutral-100">
                {prettyName(driver.name)}
              </h3>
              <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-400">
                {driver.group || "Other"}
              </span>
            </div>
            {driver.description && (
              <p className="mt-1 max-w-md text-[11px] leading-relaxed text-neutral-500">
                {driver.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-neutral-50">
              {formatDriverValue(driver.default, driver.unit)}
            </div>
            <div className="text-[10px] text-neutral-600">current default</div>
            {changePct !== null && (
              <div className={`mt-1 text-[10px] tabular-nums ${accent}`}>
                {changePct > 0 ? "▲" : changePct < 0 ? "▼" : "—"}{" "}
                {Math.abs(changePct).toFixed(0)}% since {provenance?.history[0]?.date}
              </div>
            )}
          </div>
        </div>
      </div>

      {historyData.length > 0 && (
        <div className="px-4 pt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              History
            </span>
            <span className="text-[10px] text-neutral-600">
              {historyData[0]!.date} → {historyData[historyData.length - 1]!.date}
            </span>
          </div>
          <div className="h-28">
            <ResponsiveContainer>
              <AreaChart
                data={historyData}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id={`h-${driver.name}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke={COLORS.muted} fontSize={10} />
                <YAxis
                  stroke={COLORS.muted}
                  fontSize={10}
                  tickFormatter={(v) => compactNumber(v)}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: COLORS.surface,
                    border: `1px solid ${COLORS.grid}`,
                    fontSize: 11,
                  }}
                  formatter={(v: number) => formatDriverValue(v, driver.unit)}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  fill={`url(#h-${driver.name})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {provenance?.note && (
        <div className="mt-2 px-4">
          <p className="rounded border border-neutral-800/70 bg-neutral-950/50 p-2 text-[11px] leading-relaxed text-neutral-400">
            <span className="font-semibold text-neutral-300">Note · </span>
            {provenance.note}
          </p>
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={sourceCount === 0}
          className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition ${
            sourceCount === 0
              ? "cursor-not-allowed border-neutral-800/40 text-neutral-600"
              : open
                ? "border-cyan-800/70 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-950/50"
                : "border-neutral-800 bg-neutral-900/50 text-neutral-300 hover:bg-neutral-800/70"
          }`}
        >
          <span className="font-medium">
            {sourceCount === 0
              ? "no sources cited"
              : `${sourceCount} source${sourceCount > 1 ? "s" : ""} cited`}
          </span>
          {sourceCount > 0 && (
            <span className="text-[10px]">{open ? "▲ hide" : "▼ show"}</span>
          )}
        </button>
        {open && provenance && provenance.sources.length > 0 && (
          <ul className="mt-2 space-y-2">
            {provenance.sources.map((s) => (
              <SourceItem key={s.url + s.title} source={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourceItem({ source }: { source: SourceSchema }) {
  const host = (() => {
    try {
      return new URL(source.url).host.replace(/^www\./, "");
    } catch {
      return source.url || "";
    }
  })();
  return (
    <li className="rounded border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <a
          href={source.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex-1"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-neutral-100 group-hover:text-cyan-300">
              {source.title}
            </span>
            {source.url && (
              <span className="text-[10px] text-neutral-600 group-hover:text-cyan-500">
                ↗ {host}
              </span>
            )}
          </div>
          {source.excerpt && (
            <blockquote className="mt-1 border-l-2 border-neutral-700 pl-2 text-[11px] italic leading-relaxed text-neutral-400">
              {source.excerpt}
            </blockquote>
          )}
        </a>
        {source.as_of && (
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-400">
            {source.as_of}
          </span>
        )}
      </div>
    </li>
  );
}
