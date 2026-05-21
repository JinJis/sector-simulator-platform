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
 * Padding logic: small inset on both axes so endpoints aren't clipped
 * by the SVG bounding box at line widths ≥1. Single-value or all-equal
 * inputs render a flat midline at half height.
 */
export function Sparkline({
  values,
  overlayValues,
  overlayStroke,
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

  // Pool both series when computing the y-domain so they share scale —
  // makes "equity vs basket" comparisons honest. Overlay shorter than
  // `values` is OK (gets clipped at its own length).
  const overlayLen = overlayValues?.length ?? 0;
  const useOverlay = overlayLen >= 2;
  const allValues = useOverlay ? [...values, ...overlayValues!] : values;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const padX = 2;
  const padY = 3;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const step = w / (values.length - 1);

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
    const ostep = w / (ov.length - 1);
    overlayPath = ov
      .map((v, i) => {
        const x = padX + i * ostep;
        const y = padY + h - ((v - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
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
      {showLastDot && (
        <circle cx={lastX} cy={lastY} r={1.75} fill={color} />
      )}
    </svg>
  );
}
