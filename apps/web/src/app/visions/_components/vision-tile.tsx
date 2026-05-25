/**
 * VisionTile — replacement for the legacy `<VisionCard>`. Designed for
 * scannable / visual / status-anchored display:
 *
 *   - Domain emoji + accent gradient (themeForVision)
 *   - Large composite number + horizontal feasibility bar
 *   - Trajectory arrow w/ delta_90d + color-coded sign
 *   - Activity row: capabilities · 30d signals · binding capability
 *   - Status pill: 🔥 trending (delta > +3) / ⚠ slowing (delta < -3)
 *   - "Last updated" timestamp (defers to anchor date)
 *
 * Server-component safe — no client hooks. Whole tile is one anchor.
 */

import Link from "next/link";

import { themeForVision } from "./domain-theme";

export interface VisionTileData {
  slug: string;
  name: string;
  description?: string | null;
  question?: string | null;
  domain_label?: string | null;
  composite: number | null;
  delta_90d: number | null;
  binding_capability_key?: string | null;
  eta_median_years?: number | null;
  capability_count: number;
  signal_count_30d: number;
  /** anchor year for the ETA badge ("2034"). */
  anchorYear?: number;
}

export function VisionTile({
  data,
  featured = false,
}: {
  data: VisionTileData;
  featured?: boolean;
}) {
  const theme = themeForVision(data.domain_label ?? null, data.slug);
  const anchorYear = data.anchorYear ?? new Date().getFullYear();
  const etaYear =
    data.eta_median_years != null
      ? Math.round(anchorYear + data.eta_median_years)
      : null;
  const compositeLabel = data.composite == null ? "—" : Math.round(data.composite);
  const compositePct = Math.max(0, Math.min(100, data.composite ?? 0));

  const trending =
    data.delta_90d != null && data.delta_90d >= 3
      ? "trending"
      : data.delta_90d != null && data.delta_90d <= -3
        ? "slowing"
        : null;

  return (
    <Link
      href={`/visions/${data.slug}`}
      className={`group relative block overflow-hidden rounded-2xl border bg-gradient-to-br ${theme.border} ${theme.bg} to-neutral-950 p-5 transition hover:shadow-lg hover:${theme.glow} ${featured ? "lg:col-span-2 lg:row-span-2" : ""}`}
    >
      {/* Trending / slowing pill (top-right) */}
      {trending && (
        <span
          className={`absolute right-4 top-4 z-10 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            trending === "trending"
              ? "border-emerald-700/60 bg-emerald-950/60 text-emerald-300"
              : "border-rose-700/60 bg-rose-950/60 text-rose-300"
          }`}
        >
          {trending === "trending" ? "🔥 Trending" : "⚠ Slowing"}
        </span>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${theme.border} text-2xl ${theme.accent}`}
        >
          {theme.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={`rounded border ${theme.border} px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${theme.accent}`}
            >
              {theme.label}
            </span>
          </div>
          <h2
            className={`mt-1 truncate ${featured ? "text-2xl" : "text-lg"} font-semibold text-neutral-50 group-hover:text-cyan-200`}
          >
            {data.name}
          </h2>
          {data.question && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-neutral-400">
              {data.question}
            </p>
          )}
        </div>
      </div>

      {/* Feasibility — big number + bar */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            Feasibility
          </span>
          <span className="flex items-baseline gap-1.5 text-[11px] text-neutral-500">
            {data.delta_90d != null && (
              <span
                className={
                  data.delta_90d > 0
                    ? "text-emerald-400"
                    : data.delta_90d < 0
                      ? "text-rose-400"
                      : "text-neutral-500"
                }
              >
                {data.delta_90d > 0 ? "▲" : data.delta_90d < 0 ? "▼" : "─"}{" "}
                {Math.abs(data.delta_90d).toFixed(1)}
              </span>
            )}
            <span className="text-neutral-700">·</span>
            <span>90d</span>
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span
            className={`font-mono tabular-nums ${featured ? "text-5xl" : "text-4xl"} font-bold ${compositeColorClass(data.composite)}`}
          >
            {compositeLabel}
          </span>
          <span className="text-[12px] text-neutral-500">/ 100</span>
        </div>
        {/* Horizontal bar */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900">
          <div
            className={`h-full rounded-full ${compositeBarClass(data.composite)}`}
            style={{ width: `${compositePct}%` }}
          />
        </div>
      </div>

      {/* Activity row */}
      <div className="mt-5 grid grid-cols-3 gap-3 text-[11px]">
        <Stat
          label="Capabilities"
          value={data.capability_count.toString()}
          accent={theme.accent}
        />
        <Stat
          label="30d signals"
          value={data.signal_count_30d.toString()}
          accent={theme.accent}
          highlight={data.signal_count_30d >= 10}
        />
        <Stat
          label="ETA"
          value={etaYear ? etaYear.toString() : "—"}
          accent={theme.accent}
        />
      </div>

      {/* Binding capability footer */}
      {data.binding_capability_key && (
        <p className="mt-4 truncate border-t border-neutral-800/60 pt-3 text-[11px] text-neutral-500">
          <span className="text-amber-400">⚠</span> Binding:{" "}
          <span className="font-mono text-neutral-300">
            {data.binding_capability_key}
          </span>
        </p>
      )}
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
  highlight,
}: {
  label: string;
  value: string;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-neutral-600">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
          highlight ? accent : "text-neutral-200"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function compositeColorClass(v: number | null): string {
  if (v == null) return "text-neutral-400";
  if (v < 30) return "text-rose-300";
  if (v < 60) return "text-amber-300";
  return "text-emerald-300";
}

function compositeBarClass(v: number | null): string {
  if (v == null) return "bg-neutral-700";
  if (v < 30) return "bg-gradient-to-r from-rose-500 to-rose-400";
  if (v < 60) return "bg-gradient-to-r from-amber-500 to-amber-400";
  return "bg-gradient-to-r from-emerald-500 to-emerald-400";
}
