import type { CSSProperties } from "react";

export interface EtaWindowProps {
  /** Years from now to the median ETA. */
  median: number;
  /** Lower / upper bounds (P10 / P90). Optional. */
  p10?: number | null;
  p90?: number | null;
  /** "now" anchor as a year. Defaults to current calendar year. */
  anchorYear?: number;
  /** Pixel width of the bar. */
  width?: number;
  /** Pixel height — just the timeline strip, labels live below. */
  height?: number;
  /** Cap visible window at this many years (default 20). */
  maxYears?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * The "ETA window" shown below the FeasibilityGauge.
 *
 * Visual:
 *
 *   ┤2031├──────●──────┤2040+├    median: 2034 ± 3y
 *
 * - Anchor (year now) and end (max horizon) are drawn as bracket marks.
 * - Median is a filled dot.
 * - P10-P90 band rendered as a translucent rectangle.
 * - Years past `maxYears` show as "2040+" — the band collapses to the
 *   right edge.
 *
 * Pure SVG, RSC-safe.
 */
export function EtaWindow({
  median,
  p10,
  p90,
  anchorYear = new Date().getFullYear(),
  width = 320,
  height = 36,
  maxYears = 20,
  className,
  style,
  ariaLabel,
}: EtaWindowProps) {
  // Clamp helpers
  const clamp = (y: number) => Math.max(0, Math.min(maxYears, y));
  const medianClamped = clamp(median);
  const p10Clamped = p10 != null ? clamp(p10) : null;
  const p90Clamped = p90 != null ? clamp(p90) : null;
  const overflowed = median > maxYears;

  const padX = 32;
  const usable = width - padX * 2;
  const y = height / 2;

  const toX = (years: number) => padX + (years / maxYears) * usable;

  const startYear = anchorYear;
  const endYear = anchorYear + maxYears;
  const medianYear = Math.round(anchorYear + median);

  const xMedian = toX(medianClamped);
  const xP10 = p10Clamped != null ? toX(p10Clamped) : null;
  const xP90 = p90Clamped != null ? toX(p90Clamped) : null;

  return (
    <div
      className={`inline-flex flex-col ${className ?? ""}`}
      style={{ width, ...style }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {/* Timeline base */}
        <line
          x1={padX}
          x2={width - padX}
          y1={y}
          y2={y}
          stroke="var(--chart-axis)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        {/* Start bracket */}
        <path
          d={`M ${padX} ${y - 8} L ${padX - 4} ${y - 8} L ${padX - 4} ${y + 8} L ${padX} ${y + 8}`}
          stroke="var(--chart-label)"
          strokeWidth={1.5}
          fill="none"
        />
        {/* End bracket */}
        <path
          d={`M ${width - padX} ${y - 8} L ${width - padX + 4} ${y - 8} L ${width - padX + 4} ${y + 8} L ${width - padX} ${y + 8}`}
          stroke="var(--chart-label)"
          strokeWidth={1.5}
          fill="none"
        />
        {/* Confidence band */}
        {xP10 != null && xP90 != null && xP90 > xP10 && (
          <rect
            x={xP10}
            y={y - 5}
            width={xP90 - xP10}
            height={10}
            fill="rgb(110 231 183)"
            fillOpacity={0.18}
            rx={2}
          />
        )}
        {/* Median dot */}
        <circle cx={xMedian} cy={y} r={5} fill="rgb(110 231 183)" stroke="var(--chart-thumb-stroke)" strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between px-1 font-mono text-[10px] tabular-nums text-neutral-500">
        <span>{startYear}</span>
        <span className="text-neutral-300">
          median: {medianYear}
          {p10 != null && p90 != null ? (
            <>
              {" "}
              <span className="text-neutral-500">
                ± {Math.round((p90 - p10) / 2)}y
              </span>
            </>
          ) : null}
        </span>
        <span>
          {endYear}
          {overflowed ? "+" : ""}
        </span>
      </div>
    </div>
  );
}
