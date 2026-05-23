import type { CSSProperties } from "react";

export interface CurvePoint {
  /** Calendar year (or any monotonic numeric x). */
  year: number;
  /** Cost / value in y-units. */
  value: number;
}

export interface EconomicsCurveChartProps {
  /** The vision's curve (e.g. orbit-DC TCO). Always drawn. */
  primary: CurvePoint[];
  /** Baseline to compare against (e.g. ground-DC TCO). Optional. */
  baseline?: CurvePoint[] | null;
  /** Label rendered in the legend for `primary`. */
  primaryLabel?: string;
  /** Label rendered in the legend for `baseline`. */
  baselineLabel?: string;
  /** Y-axis unit ("$/kWh", "$/kg", etc). */
  yUnit?: string;
  /** Width/height in pixels. */
  width?: number;
  height?: number;
  /** Show the crossover marker where primary first dips below baseline. */
  highlightCrossover?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * Two-line cost-curve comparison with optional crossover marker.
 * Used on the hero "Economics" panel + the Economics drill-down tab.
 *
 * RSC-safe pure SVG. No axes labels yet — the parent renders the
 * column header + bottom "year range" caption to keep this composable.
 */
export function EconomicsCurveChart({
  primary,
  baseline,
  primaryLabel = "Vision",
  baselineLabel = "Baseline",
  yUnit = "",
  width = 320,
  height = 160,
  highlightCrossover = true,
  className,
  style,
  ariaLabel,
}: EconomicsCurveChartProps) {
  // Validate
  if (!primary || primary.length < 2) {
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
          stroke="rgb(64 64 64)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const padL = 36;
  const padR = 12;
  const padT = 8;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;

  // Pooled domain
  const all = baseline ? [...primary, ...baseline] : primary;
  const xMin = Math.min(...all.map((p) => p.year));
  const xMax = Math.max(...all.map((p) => p.year));
  const yMax = Math.max(...all.map((p) => p.value));
  const yMin = Math.min(...all.map((p) => p.value));
  const yPad = (yMax - yMin) * 0.1 || 1;
  const yLo = Math.max(0, yMin - yPad);
  const yHi = yMax + yPad;

  const toX = (year: number) => padL + ((year - xMin) / (xMax - xMin || 1)) * w;
  const toY = (v: number) => padT + h - ((v - yLo) / (yHi - yLo || 1)) * h;

  const pathOf = (pts: CurvePoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.year).toFixed(2)} ${toY(p.value).toFixed(2)}`)
      .join(" ");

  // Crossover: first year primary < baseline (sampled at primary's years).
  let crossover: CurvePoint | null = null;
  if (highlightCrossover && baseline && baseline.length >= 2) {
    // Interpolate baseline at primary[i].year.
    const interp = (year: number): number => {
      // Linear scan — small arrays.
      for (let i = 1; i < baseline.length; i++) {
        const b0 = baseline[i - 1]!;
        const b1 = baseline[i]!;
        if (year >= b0.year && year <= b1.year) {
          const t = (year - b0.year) / (b1.year - b0.year || 1);
          return b0.value + (b1.value - b0.value) * t;
        }
      }
      return baseline[baseline.length - 1]!.value;
    };
    for (const p of primary) {
      if (p.value <= interp(p.year)) {
        crossover = p;
        break;
      }
    }
  }

  const primaryColor = "rgb(110 231 183)"; // emerald
  const baselineColor = "rgb(115 115 115)"; // neutral

  // Y-axis tick labels (3 ticks)
  const yTicks = [yLo, (yLo + yHi) / 2, yHi];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={style}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      {/* y-grid */}
      {yTicks.map((tv, i) => {
        const ty = toY(tv);
        return (
          <g key={`yt-${i}`}>
            <line
              x1={padL}
              x2={width - padR}
              y1={ty}
              y2={ty}
              stroke="rgb(38 38 38)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text
              x={padL - 4}
              y={ty + 3}
              textAnchor="end"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="9"
              fill="rgb(115 115 115)"
            >
              {tv >= 100 ? tv.toFixed(0) : tv.toFixed(2)}
              {yUnit}
            </text>
          </g>
        );
      })}
      {/* x-axis years */}
      <text
        x={padL}
        y={height - 6}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="9"
        fill="rgb(115 115 115)"
      >
        {xMin}
      </text>
      <text
        x={width - padR}
        y={height - 6}
        textAnchor="end"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="9"
        fill="rgb(115 115 115)"
      >
        {xMax}
      </text>

      {/* Baseline */}
      {baseline && baseline.length >= 2 && (
        <path
          d={pathOf(baseline)}
          fill="none"
          stroke={baselineColor}
          strokeWidth={1.25}
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Primary */}
      <path
        d={pathOf(primary)}
        fill="none"
        stroke={primaryColor}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Crossover marker */}
      {crossover && (
        <>
          <line
            x1={toX(crossover.year)}
            x2={toX(crossover.year)}
            y1={padT}
            y2={padT + h}
            stroke="rgb(245 158 11)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
          />
          <text
            x={toX(crossover.year)}
            y={padT + 10}
            textAnchor="middle"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="9"
            fill="rgb(245 158 11)"
          >
            crossover ~{crossover.year}
          </text>
        </>
      )}
      {/* Legend */}
      <g transform={`translate(${padL}, ${padT + 4})`}>
        <line x1={0} x2={12} y1={4} y2={4} stroke={primaryColor} strokeWidth={1.75} />
        <text
          x={16}
          y={7}
          fontFamily="ui-sans-serif, system-ui"
          fontSize="10"
          fill="rgb(212 212 212)"
        >
          {primaryLabel}
        </text>
        {baseline && (
          <g transform="translate(80, 0)">
            <line
              x1={0}
              x2={12}
              y1={4}
              y2={4}
              stroke={baselineColor}
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
            <text
              x={16}
              y={7}
              fontFamily="ui-sans-serif, system-ui"
              fontSize="10"
              fill="rgb(163 163 163)"
            >
              {baselineLabel}
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}
