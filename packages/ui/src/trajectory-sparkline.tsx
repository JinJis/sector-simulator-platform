import type { CSSProperties } from "react";

export interface TrajectoryPoint {
  /** ISO string or Date — only used for sorting + a11y. */
  as_of: string | Date;
  /** Composite score 0-100. */
  composite: number;
  /** Optional P10 / P90 band. */
  p10?: number | null;
  p90?: number | null;
}

export interface TrajectorySparklineProps {
  points: TrajectoryPoint[];
  /** SVG width in pixels. */
  width?: number;
  /** SVG height in pixels. */
  height?: number;
  /** Override the line stroke (defaults to score-direction color). */
  stroke?: string;
  /** Render the P10-P90 band as a translucent fill. Default true if data has bands. */
  showBand?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * Composite-score trajectory + confidence band sparkline. Renders the
 * FeasibilityIndex over time with a P10-P90 wedge behind the line.
 *
 * Differs from `Sparkline` in that:
 *   - The y-axis is locked to [0, 100] (not auto-scaled to data) — so
 *     a "50" looks the same in every vision.
 *   - A confidence band is drawn behind the line when P10/P90 present.
 *
 * Pure SVG, RSC-safe.
 */
export function TrajectorySparkline({
  points,
  width = 320,
  height = 60,
  stroke,
  showBand,
  className,
  style,
  ariaLabel,
}: TrajectorySparklineProps) {
  // Defensive: empty input → flat placeholder line.
  if (!points || points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        style={style}
        aria-hidden="true"
      >
        <line
          x1={2}
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--chart-axis)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  // Locked y-domain to keep visions comparable.
  const padX = 4;
  const padY = 6;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const n = points.length;
  const step = n > 1 ? w / (n - 1) : 0;
  const toY = (v: number) => padY + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  const linePts = points.map((p, i) => [padX + i * step, toY(p.composite)] as const);

  const hasBand =
    (showBand ?? true) &&
    points.some((p) => p.p10 != null && p.p90 != null && p.p90! > p.p10!);

  // Band as a closed polygon: upper edge L→R then lower edge R→L.
  let bandPath: string | null = null;
  if (hasBand) {
    const upper = points
      .map((p, i) => {
        const x = padX + i * step;
        const v = p.p90 ?? p.composite;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${toY(v).toFixed(2)}`;
      })
      .join(" ");
    const lower = points
      .slice()
      .reverse()
      .map((p, i) => {
        // i counts from the reversed array — convert back to original index for x.
        const origIdx = points.length - 1 - i;
        const x = padX + origIdx * step;
        const v = p.p10 ?? p.composite;
        return `L${x.toFixed(2)} ${toY(v).toFixed(2)}`;
      })
      .join(" ");
    bandPath = `${upper} ${lower} Z`;
  }

  const path = linePts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  const firstV = points[0]!.composite;
  const lastV = points[n - 1]!.composite;
  const auto =
    lastV >= firstV ? "rgb(110 231 183)" : "rgb(251 113 133)";
  const color = stroke ?? auto;
  const [lastX, lastY] = linePts[linePts.length - 1]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={style}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {ariaLabel ? <title>{ariaLabel}</title> : null}
      {/* Subtle 50-line baseline for visual reference */}
      <line
        x1={padX}
        x2={width - padX}
        y1={toY(50)}
        y2={toY(50)}
        stroke="var(--chart-grid)"
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      {bandPath && (
        <path d={bandPath} fill={color} fillOpacity={0.15} stroke="none" />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} stroke="var(--chart-thumb-stroke)" strokeWidth={1} />
    </svg>
  );
}
