import type { CSSProperties } from "react";

import { TrajectorySparkline, type TrajectoryPoint } from "./trajectory-sparkline";

export interface VisionCardProps {
  slug: string;
  name: string;
  /** Tagline / framing question rendered as second line. */
  question?: string | null;
  /** Current vision-level composite. Null when not yet computed. */
  composite?: number | null;
  /** Delta over last 90d. */
  delta90d?: number | null;
  /** Number of tracked capabilities. */
  capabilityCount?: number;
  /** Number of signals in the last 30 days. */
  signalCount30d?: number;
  /** Trajectory points for the small sparkline. */
  trajectory?: TrajectoryPoint[];
  /** ETA in years from now (rendered as "2034" if anchorYear=now). */
  etaMedianYears?: number | null;
  anchorYear?: number;
  /** Link target — when set, the whole card is an anchor. */
  href?: string;
  className?: string;
  style?: CSSProperties;
}

function compositeColor(v: number | null | undefined): string {
  if (v == null) return "rgb(115 115 115)";
  if (v < 30) return "rgb(244 63 94)";
  if (v < 60) return "rgb(245 158 11)";
  return "rgb(110 231 183)";
}

/**
 * The home-page tile for one vision. Headline + trajectory + delta +
 * ETA + lightweight metadata. Designed to fit a 3-4 column grid.
 *
 * The whole card is clickable when `href` is set.
 */
export function VisionCard({
  slug,
  name,
  question,
  composite,
  delta90d,
  capabilityCount,
  signalCount30d,
  trajectory,
  etaMedianYears,
  anchorYear = new Date().getFullYear(),
  href,
  className,
  style,
}: VisionCardProps) {
  const color = compositeColor(composite);
  const deltaSign =
    delta90d == null ? null : delta90d > 0 ? "▲" : delta90d < 0 ? "▼" : "─";
  const deltaColor =
    delta90d == null
      ? "rgb(115 115 115)"
      : delta90d > 0
      ? "rgb(110 231 183)"
      : delta90d < 0
      ? "rgb(251 113 133)"
      : "rgb(115 115 115)";
  const etaYear =
    etaMedianYears != null ? Math.round(anchorYear + etaMedianYears) : null;

  const inner = (
    <div
      className={`group flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 transition-colors hover:border-neutral-700 ${className ?? ""}`}
      style={style}
      data-vision-slug={slug}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-neutral-100" title={name}>
            {name}
          </div>
          {question && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-snug text-neutral-500"
              title={question}
            >
              {question}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono text-3xl font-semibold leading-none"
            style={{ color }}
          >
            {composite == null ? "—" : Math.round(composite)}
          </span>
          <span className="text-[10px] text-neutral-500">/ 100</span>
        </div>
        {delta90d != null && (
          <span className="font-mono text-xs tabular-nums" style={{ color: deltaColor }}>
            {deltaSign} {delta90d > 0 ? "+" : ""}
            {delta90d.toFixed(1)}{" "}
            <span className="text-[10px] text-neutral-500">90d</span>
          </span>
        )}
        <div className="ml-auto">
          <TrajectorySparkline
            points={trajectory ?? []}
            width={96}
            height={28}
            ariaLabel={`${name} feasibility trajectory`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-neutral-800 pt-3 text-[11px] text-neutral-500">
        {etaYear != null && (
          <span>
            ETA{" "}
            <span className="font-mono text-neutral-300 tabular-nums">{etaYear}</span>
          </span>
        )}
        {capabilityCount != null && (
          <span>
            <span className="font-mono text-neutral-300 tabular-nums">{capabilityCount}</span>{" "}
            capabilities
          </span>
        )}
        {signalCount30d != null && (
          <span>
            <span className="font-mono text-neutral-300 tabular-nums">{signalCount30d}</span>{" "}
            signals 30d
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        aria-label={`Open vision: ${name}`}
      >
        {inner}
      </a>
    );
  }
  return inner;
}
