import type { CSSProperties } from "react";

export interface FeasibilityGaugeProps {
  /** 0-100. The headline number. */
  composite: number;
  /** Optional P10-P90 band rendered as a translucent wedge behind the number. */
  composite_p10?: number | null;
  composite_p90?: number | null;
  /** Delta over the last 90 days (signed). Renders ▲/▼ arrow + value. */
  delta_90d?: number | null;
  /** Override the "(90d)" tag — e.g. "(30d)" if a card uses a shorter window. */
  delta_window_label?: string;
  /** Pull-out caption — "FEASIBILITY INDEX" by default. */
  label?: string;
  /** Pixel size of the SVG. The gauge is a square. Default 220. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * The hero gauge — a single big number with arc background coloring, an
 * optional confidence band wedge, and a 90d delta tag underneath. Pure
 * SVG, RSC-safe.
 *
 * Visual logic:
 *   - Arc spans 240° from -120° (bottom-left) to +120° (bottom-right);
 *     bottom 120° is intentionally cut so the number sits flat at
 *     12 o'clock equivalent.
 *   - Confidence band, if provided, fills the wedge from P10 to P90.
 *   - The big number uses a color ramp (rose < 30 < amber < 60 <
 *     emerald) so a glance reads the same as the bars.
 *
 * Why not Recharts: this is one shape, custom, and recharts adds
 * ~80kb. SVG is 60 lines.
 */
export function FeasibilityGauge({
  composite,
  composite_p10,
  composite_p90,
  delta_90d,
  delta_window_label = "90d",
  label = "FEASIBILITY INDEX",
  size = 220,
  className,
  style,
  ariaLabel,
}: FeasibilityGaugeProps) {
  // Arc geometry: 240° sweep, centered on top.
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const stroke = size * 0.06;

  // Map a 0-100 value to an angle in degrees on the arc.
  // 0  → -120°  (left bottom)
  // 100 → +120° (right bottom)
  const toAngle = (v: number) => -120 + (Math.max(0, Math.min(100, v)) / 100) * 240;
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const polar = (deg: number) => {
    const rad = toRad(deg);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  // Arc path generator
  const arcPath = (startDeg: number, endDeg: number) => {
    const s = polar(startDeg);
    const e = polar(endDeg);
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    const sweep = endDeg > startDeg ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  };

  const compositeColor =
    composite < 30
      ? "rgb(244 63 94)"
      : composite < 60
      ? "rgb(245 158 11)"
      : "rgb(110 231 183)";

  const hasBand =
    composite_p10 != null &&
    composite_p90 != null &&
    composite_p90 > composite_p10;

  const deltaSign = delta_90d == null ? null : delta_90d > 0 ? "▲" : delta_90d < 0 ? "▼" : "─";
  const deltaColor =
    delta_90d == null
      ? "rgb(115 115 115)"
      : delta_90d > 0
      ? "rgb(110 231 183)"
      : delta_90d < 0
      ? "rgb(251 113 133)"
      : "rgb(115 115 115)";

  return (
    <div
      className={`relative inline-flex flex-col items-center justify-center ${className ?? ""}`}
      style={{ width: size, ...style }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {/* Background track */}
        <path
          d={arcPath(-120, 120)}
          fill="none"
          stroke="rgb(38 38 38)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Confidence band (P10 → P90) — drawn before the main arc */}
        {hasBand && (
          <path
            d={arcPath(toAngle(composite_p10!), toAngle(composite_p90!))}
            fill="none"
            stroke={compositeColor}
            strokeOpacity={0.15}
            strokeWidth={stroke * 1.3}
            strokeLinecap="butt"
          />
        )}
        {/* Score arc */}
        <path
          d={arcPath(-120, toAngle(composite))}
          fill="none"
          stroke={compositeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      </svg>
      {/* Center label — overlay positioned dead-center */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-4">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          {label}
        </span>
        <span
          className="font-mono text-[clamp(2.5rem,8vw,3.5rem)] font-semibold leading-none"
          style={{ color: compositeColor }}
        >
          {Math.round(composite)}
        </span>
        <span className="text-[10px] text-neutral-500">/ 100</span>
        {delta_90d != null && (
          <span
            className="mt-1 font-mono text-xs tabular-nums"
            style={{ color: deltaColor }}
          >
            {deltaSign} {delta_90d > 0 ? "+" : ""}
            {delta_90d.toFixed(1)}{" "}
            <span className="text-[10px] text-neutral-500">({delta_window_label})</span>
          </span>
        )}
      </div>
    </div>
  );
}
