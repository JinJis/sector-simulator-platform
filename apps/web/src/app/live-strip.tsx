"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fetchLive, type LiveResponse, type OutputSchema } from "@/lib/sim-client";

import { formatValue, prettyName } from "./shared";

const POLL_MS = 3000;
const KPI_OUTPUT_NAMES = [
  "npv_savings_vs_ground_usd",
  "break_even_year",
  "system_capex_usd",
  "launch_mass_kg",
] as const;

interface Props {
  slug: string;
  initial: LiveResponse | null;
}

export function LiveStrip({ slug, initial }: Props) {
  const [live, setLive] = useState<LiveResponse | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastFetch = useRef<number>(Date.now());
  const prevValues = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchLive(slug);
        if (cancelled) return;
        setLive(r);
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
  }, [slug]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastFetch.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const kpis = useMemo(() => {
    const byName = new Map(live?.outputs.map((o) => [o.name, o]) ?? []);
    return KPI_OUTPUT_NAMES.map((n) => byName.get(n)).filter(
      (o): o is OutputSchema => !!o,
    );
  }, [live]);

  return (
    <div className="sticky top-0 z-20 -mx-6 mb-5 border-b border-neutral-800/80 bg-neutral-950/85 px-6 py-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${
                error ? "bg-red-500" : "animate-ping bg-emerald-400 opacity-75"
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                error ? "bg-red-500" : "bg-emerald-400"
              }`}
            />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-300">
              {error ? "Live · error" : "Live"}
            </span>
            <span className="text-[10px] text-neutral-500 tabular-nums">
              #{live?.tick ?? "—"} · {secondsAgo}s ago
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-x-7 gap-y-2">
          {kpis.map((o) => (
            <KpiPill key={o.name} output={o} prevRef={prevValues} />
          ))}
        </div>

        <span className="text-[10px] uppercase tracking-wider text-neutral-600">
          demo signal · seeded drift
        </span>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-400">live feed: {error}</p>
      )}
    </div>
  );
}

function KpiPill({
  output,
  prevRef,
}: {
  output: OutputSchema;
  prevRef: React.MutableRefObject<Map<string, number>>;
}) {
  const v = output.scalar ?? 0;
  const prev = prevRef.current.get(output.name);
  const delta = prev !== undefined ? v - prev : 0;
  prevRef.current.set(output.name, v);

  const isNpv = output.name.startsWith("npv_");
  const isBreakeven = output.name === "break_even_year";
  const color = isNpv
    ? v > 0
      ? "text-emerald-300"
      : v < 0
        ? "text-rose-300"
        : "text-neutral-200"
    : isBreakeven && v < 0
      ? "text-rose-300"
      : "text-neutral-100";
  const label = isBreakeven && v < 0 ? "no break-even" : formatValue(v, output.unit);
  const trendArrow =
    Math.abs(delta) < 1e-9 ? "" : delta > 0 ? "▲" : "▼";
  const trendColor = delta > 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {prettyName(output.name)}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={`text-sm font-semibold tabular-nums ${color}`}>{label}</span>
        {trendArrow && (
          <span className={`text-[9px] ${trendColor}`}>{trendArrow}</span>
        )}
      </span>
    </div>
  );
}
