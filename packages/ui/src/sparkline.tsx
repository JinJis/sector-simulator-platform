import type { CSSProperties } from "react";

export interface SparklineProps {
  /** Values plotted left → right. Need at least 2 points to render a line. */
  values: number[];
  /**
   * Optional second series drawn behind the main line — dashed gray by
   * default. Same length as `values`; gets normalized into the same
   * y-range so the comparison is meaningful. Use for "equity vs sector
   * basket" or any reference series.
   */
  overlayValues?: number[];
  /** Stroke color for the overlay. Default neutral-500 dashed. */
  overlayStroke?: string;
  /**
   * Optional forward projection — drawn dashed in the primary line's
   * color, *continuing* from the last point of `values`. By convention
   * the first element of `projectionValues` should equal `values[last]`
   * so the line connects without a visible kink. The x-axis is extended
   * to fit; the y-domain pools projection too so the chart frame
   * doesn't whiplash. Use for "current driver state implies this
   * forward target" overlays.
   */
  projectionValues?: number[];
  /** Stroke for the projection. Defaults to the auto-direction color. */
  projectionStroke?: string;
  /** SVG width in pixels. */
  width?: number;
  /** SVG height in pixels. */
  height?: number;
  /** Stroke color override. Default cyan / rose based on first→last direction. */
  stroke?: string;
  /** Render a filled area under the line. */
  filled?: boolean;
  /** Show a dot on the most recent point. */
  showLastDot?: boolean;
  /** Inline style passthrough (e.g. inline-flex sizing wrappers). */
  style?: CSSProperties;
  className?: string;
  /** Accessible label exposed via `<title>`. */
  ariaLabel?: string;
}

/**
 * Minimal dependency-free SVG sparkline. RSC-safe (pure rendering, no
 * client-side hooks). Auto-colors green/red by the first→last delta;
 * caller can override via `stroke`.
 *
 * Three series supported in one chart:
 *   1. `values`            — the primary historical line
 *   2. `overlayValues`     — a peer series (e.g. sector basket), dashed,
 *                            drawn BEHIND the primary line
 *   3. `projectionValues`  — a forward extension of values, dashed,
 *                            CONTINUING from the last historical point
 *
 * Padding logic: small inset on both axes so endpoints aren't clipped
 * by the SVG bounding box at line widths ≥1. Single-value or all-equal
 * inputs render a flat midline at half height.
 */
export function Sparkline({
  values,
  overlayValues,
  overlayStroke,
  projectionValues,
  projectionStroke,
  width = 96,
  height = 28,
  stroke,
  filled = false,
  showLastDot = true,
  style,
  className,
  ariaLabel,
}: SparklineProps) {
  if (!values || values.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={style}
        className={className}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
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

  const overlayLen = overlayValues?.length ?? 0;
  const useOverlay = overlayLen >= 2;
  const projLen = projectionValues?.length ?? 0;
  const useProjection = projLen >= 2;

  // Pool every series into the y-domain so the chart frame stays
  // honest. Without this an aggressive projection could rescale the
  // axis and visually shrink the historical line.
  const pool: number[] = [...values];
  if (useOverlay) pool.push(...overlayValues!);
  if (useProjection) pool.push(...projectionValues!);
  const min = Math.min(...pool);
  const max = Math.max(...pool);
  const span = max - min || 1;

  const padX = 2;
  const padY = 3;
  const w = width - padX * 2;
  const h = height - padY * 2;

  // x-axis: when projection is present, the total horizontal time span
  // is (values.length - 1) + (projection.length - 1) — projection's
  // first point sits at the last x of values (continuity), so we don't
  // double-count it. Without projection it's just (values.length - 1).
  const totalSteps = useProjection
    ? values.length - 1 + (projLen - 1)
    : values.length - 1;
  const step = w / totalSteps;

  const pts = values.map((v, i) => {
    const x = padX + i * step;
    const y = padY + h - ((v - min) / span) * h;
    return [x, y] as const;
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");

  const first = values[0]!;
  const last = values[values.length - 1]!;
  const auto = last >= first ? "rgb(110 231 183)" : "rgb(251 113 133)";
  const color = stroke ?? auto;

  const fillPath = filled
    ? `${path} L${(padX + (values.length - 1) * step).toFixed(2)} ${(padY + h).toFixed(2)} L${padX.toFixed(2)} ${(padY + h).toFixed(2)} Z`
    : null;

  let overlayPath: string | null = null;
  if (useOverlay) {
    const ov = overlayValues!;
    // Overlay has its own length, which may differ from values'. We
    // stretch it across the historical portion of the x-axis only
    // (not into the projection region).
    const ostep = (values.length - 1) * step / (ov.length - 1);
    overlayPath = ov
      .map((v, i) => {
        const x = padX + i * ostep;
        const y = padY + h - ((v - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  let projectionPath: string | null = null;
  let projectionEnd: readonly [number, number] | null = null;
  if (useProjection) {
    const pv = projectionValues!;
    const startX = padX + (values.length - 1) * step;
    projectionPath = pv
      .map((v, i) => {
        const x = startX + i * step;
        const y = padY + h - ((v - min) / span) * h;
        if (i === pv.length - 1) projectionEnd = [x, y];
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }
  // Auto-color projection based on its direction (last_value → end).
  let projectionColor = projectionStroke ?? color;
  if (useProjection && !projectionStroke) {
    const projLast = projectionValues![projLen - 1]!;
    projectionColor = projLast >= last ? "rgb(110 231 183)" : "rgb(251 113 133)";
  }

  const [lastX, lastY] = pts[pts.length - 1]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {ariaLabel ? <title>{ariaLabel}</title> : null}
      {fillPath && <path d={fillPath} fill={color} fillOpacity={0.15} stroke="none" />}
      {overlayPath && (
        <path
          d={overlayPath}
          fill="none"
          stroke={overlayStroke ?? "rgb(115 115 115)"}
          strokeWidth={1}
          strokeDasharray="3 2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      {projectionPath && (
        <path
          d={projectionPath}
          fill="none"
          stroke={projectionColor}
          strokeWidth={1.25}
          strokeDasharray="4 2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />
      )}
      {showLastDot && (
        <circle cx={lastX} cy={lastY} r={1.75} fill={color} />
      )}
      {projectionEnd && (
        <circle
          cx={(projectionEnd as readonly [number, number])[0]}
          cy={(projectionEnd as readonly [number, number])[1]}
          r={2}
          fill={projectionColor}
          stroke="rgb(10 10 10)"
          strokeWidth={0.75}
        />
      )}
    </svg>
  );
}
