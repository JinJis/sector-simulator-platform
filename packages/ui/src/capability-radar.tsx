import type { CSSProperties } from "react";

/**
 * CapabilityRadar (M53).
 *
 * 4-axis radar — technical · economic · regulatory · supply — with a
 * primary polygon (current snapshot) and an optional baseline polygon
 * (typically 90 days ago) drawn dashed so the user reads movement at a
 * glance. Designed for two contexts:
 *
 *   - Vision Overview: averaged across all capabilities, used to show
 *     where the *vision as a whole* is binding.
 *   - Capability detail (M53.5 follow-up): per-capability radar.
 *
 * Pure SVG (RSC-safe). All four dims share a 0..100 scale; the chart
 * pads the upper edge so a perfect 100 still reads inside the ring.
 */

export interface CapabilityRadarDims {
  technical: number | null;
  economic: number | null;
  regulatory: number | null;
  supply: number | null;
}

export interface CapabilityRadarProps {
  current: CapabilityRadarDims;
  /** Optional baseline (e.g., 90d ago) — drawn dashed under the current
   *  polygon. When null/missing, only the current polygon renders. */
  baseline?: CapabilityRadarDims | null;
  /** Visual size. */
  width?: number;
  height?: number;
  /** Axis labels override. Defaults to English short labels. */
  labels?: {
    technical?: string;
    economic?: string;
    regulatory?: string;
    supply?: string;
  };
  /** Show the dotted reference ring at 50 (mid-band). */
  showMidRing?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const DEFAULT_LABELS = {
  technical: "Technical",
  economic: "Economic",
  regulatory: "Regulatory",
  supply: "Supply",
};

const PRIMARY_FILL = "rgba(110, 231, 183, 0.18)"; // emerald
const PRIMARY_STROKE = "rgb(110, 231, 183)";
const BASELINE_STROKE = "rgb(115, 115, 115)";

function clamp01(v: number | null): number {
  if (v == null || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function CapabilityRadar({
  current,
  baseline,
  width = 280,
  height = 280,
  labels,
  showMidRing = true,
  className,
  style,
  ariaLabel,
}: CapabilityRadarProps) {
  const cx = width / 2;
  const cy = height / 2;
  // Reserve room for the axis labels around the edge.
  const radius = Math.min(cx, cy) - 32;
  const lbl = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  // 4 axes — top (technical), right (economic), bottom (regulatory),
  // left (supply). Angles in radians, 0 = pointing up.
  const axes = [
    { key: "technical" as const, label: lbl.technical, angle: -Math.PI / 2 },
    { key: "economic" as const, label: lbl.economic, angle: 0 },
    { key: "regulatory" as const, label: lbl.regulatory, angle: Math.PI / 2 },
    { key: "supply" as const, label: lbl.supply, angle: Math.PI },
  ];

  const point = (value: number, angle: number) => {
    const r = (clamp01(value) / 100) * radius;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  };

  const polyFor = (dims: CapabilityRadarDims): string => {
    const pts = axes.map((a) => {
      const [x, y] = point(dims[a.key] ?? 0, a.angle);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return pts.join(" ");
  };

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
      {/* Outer ring */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--chart-grid)"
        strokeWidth={1}
      />
      {/* Mid ring at 50% */}
      {showMidRing && (
        <circle
          cx={cx}
          cy={cy}
          r={radius / 2}
          fill="none"
          stroke="var(--chart-grid)"
          strokeWidth={0.75}
          strokeDasharray="2 4"
          opacity={0.6}
        />
      )}
      {/* Axes */}
      {axes.map((a) => {
        const [x, y] = point(100, a.angle);
        return (
          <line
            key={`axis-${a.key}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        );
      })}
      {/* Baseline polygon */}
      {baseline && (
        <polygon
          points={polyFor(baseline)}
          fill="transparent"
          stroke={BASELINE_STROKE}
          strokeWidth={1.25}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}
      {/* Current polygon */}
      <polygon
        points={polyFor(current)}
        fill={PRIMARY_FILL}
        stroke={PRIMARY_STROKE}
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {/* Vertex dots on current */}
      {axes.map((a) => {
        const [x, y] = point(current[a.key] ?? 0, a.angle);
        return (
          <circle
            key={`pt-${a.key}`}
            cx={x}
            cy={y}
            r={2.5}
            fill={PRIMARY_STROKE}
          />
        );
      })}
      {/* Axis labels + per-axis value */}
      {axes.map((a) => {
        const [lx, ly] = point(118, a.angle);
        const v = current[a.key];
        const anchor =
          Math.abs(Math.cos(a.angle)) < 0.1
            ? "middle"
            : Math.cos(a.angle) > 0
              ? "start"
              : "end";
        const baseDy =
          Math.abs(Math.sin(a.angle)) < 0.1
            ? 4
            : Math.sin(a.angle) > 0
              ? 14
              : -8;
        return (
          <g key={`lbl-${a.key}`}>
            <text
              x={lx}
              y={ly + baseDy}
              textAnchor={anchor}
              fontFamily="ui-sans-serif, system-ui"
              fontSize="10"
              fill="var(--chart-label)"
            >
              {a.label}
            </text>
            {v != null && (
              <text
                x={lx}
                y={ly + baseDy + 10}
                textAnchor={anchor}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="9"
                fill={PRIMARY_STROKE}
              >
                {Math.round(v)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
