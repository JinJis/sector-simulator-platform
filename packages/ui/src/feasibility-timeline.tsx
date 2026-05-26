import type { CSSProperties } from "react";

/**
 * FeasibilityTimeline (M53).
 *
 * Dual-axis vision-level timeline:
 *   - Left axis (0..100): composite feasibility line + optional p10/p90
 *     confidence band.
 *   - Right axis: daily signal volume rendered as bars under the line.
 *
 * The shared x-axis is calendar time. Both series share their domain so
 * a date with both a composite snapshot and a signal bar lines up
 * exactly — that vertical alignment is the chart's whole point ("signal
 * spikes match score moves").
 *
 * Pure SVG (RSC-safe). Click-to-drawer is M51 territory; v1 just
 * renders the visual.
 */

export interface TimelinePoint {
  /** ISO date string or Date — anchors the x coordinate. */
  date: string | Date;
  composite: number;
  /** Optional confidence band edges. Drawn only when both present. */
  p10?: number | null;
  p90?: number | null;
}

export interface TimelineVolumePoint {
  date: string | Date;
  count: number;
}

export interface FeasibilityTimelineProps {
  trajectory: TimelinePoint[];
  volume?: TimelineVolumePoint[] | null;
  width?: number;
  height?: number;
  /** Label rendered above the left axis. */
  scoreLabel?: string;
  /** Label rendered above the right axis (bars). */
  volumeLabel?: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const LINE_COLOR = "rgb(110, 231, 183)"; // emerald
const BAND_FILL = "rgba(110, 231, 183, 0.12)";
const BAR_COLOR = "rgba(59, 130, 246, 0.45)"; // blue
const BAR_OUTLINE = "rgba(59, 130, 246, 0.75)";

function toDate(d: string | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

export function FeasibilityTimeline({
  trajectory,
  volume,
  width = 720,
  height = 240,
  scoreLabel = "Composite",
  volumeLabel = "Signals/day",
  className,
  style,
  ariaLabel,
}: FeasibilityTimelineProps) {
  if (!trajectory || trajectory.length < 2) {
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
        <text
          x={width / 2}
          y={height / 2 - 6}
          textAnchor="middle"
          fontSize="10"
          fill="var(--chart-label)"
        >
          waiting for trajectory points…
        </text>
      </svg>
    );
  }

  // Layout.
  const padL = 36;
  const padR = 36;
  const padT = 16;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;

  // x-domain across both series.
  const allDates = [
    ...trajectory.map((p) => toDate(p.date).getTime()),
    ...(volume ?? []).map((p) => toDate(p.date).getTime()),
  ];
  const xMin = Math.min(...allDates);
  const xMax = Math.max(...allDates);
  const toX = (t: number) =>
    padL + ((t - xMin) / (xMax - xMin || 1)) * w;

  // y-left domain: composite is 0..100 by spec.
  const toY = (v: number) => padT + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  // y-right domain (volume): dynamic max with a small headroom.
  const maxVol = Math.max(1, ...(volume ?? []).map((v) => v.count));
  const toBarH = (count: number) => (count / maxVol) * (h * 0.55);

  const linePath = trajectory
    .slice()
    .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    .map((p, i) => {
      const x = toX(toDate(p.date).getTime()).toFixed(2);
      const y = toY(p.composite).toFixed(2);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");

  const bandPath = (() => {
    const pts = trajectory
      .filter((p) => p.p10 != null && p.p90 != null)
      .slice()
      .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
    if (pts.length < 2) return null;
    const top = pts
      .map((p, i) => {
        const x = toX(toDate(p.date).getTime()).toFixed(2);
        const y = toY(p.p90!).toFixed(2);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");
    const bottom = pts
      .slice()
      .reverse()
      .map((p) => {
        const x = toX(toDate(p.date).getTime()).toFixed(2);
        const y = toY(p.p10!).toFixed(2);
        return `L${x} ${y}`;
      })
      .join(" ");
    return `${top} ${bottom} Z`;
  })();

  // y-axis ticks for the score (0/50/100).
  const yTicks = [0, 50, 100];

  // Approximate bar width — divide the chart width by either the
  // number of bars or 60, whichever is smaller (avoid hair-thin bars).
  const barCount = Math.max(1, volume?.length ?? 0);
  const barWidth = Math.max(2, Math.min(8, (w * 0.9) / barCount));

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
      {/* y grid + labels */}
      {yTicks.map((tv) => {
        const y = toY(tv);
        return (
          <g key={`y-${tv}`}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke="var(--chart-grid)"
              strokeWidth={0.75}
              strokeDasharray="2 4"
              opacity={0.7}
            />
            <text
              x={padL - 4}
              y={y + 3}
              textAnchor="end"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="9"
              fill="var(--chart-label)"
            >
              {tv}
            </text>
          </g>
        );
      })}
      {/* Right axis label (volume) */}
      <text
        x={width - padR + 4}
        y={padT + 8}
        textAnchor="start"
        fontFamily="ui-sans-serif, system-ui"
        fontSize="9"
        fill="var(--chart-label)"
      >
        {volumeLabel}{maxVol > 0 ? ` · max ${maxVol}` : ""}
      </text>
      {/* Score label */}
      <text
        x={padL}
        y={padT + 8}
        textAnchor="start"
        fontFamily="ui-sans-serif, system-ui"
        fontSize="9"
        fill={LINE_COLOR}
      >
        {scoreLabel}
      </text>
      {/* x-axis years (min + max) */}
      <text
        x={padL}
        y={height - 6}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="9"
        fill="var(--chart-label)"
      >
        {new Date(xMin).toISOString().slice(0, 10)}
      </text>
      <text
        x={width - padR}
        y={height - 6}
        textAnchor="end"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="9"
        fill="var(--chart-label)"
      >
        {new Date(xMax).toISOString().slice(0, 10)}
      </text>

      {/* Confidence band */}
      {bandPath && (
        <path d={bandPath} fill={BAND_FILL} stroke="none" />
      )}
      {/* Bars (rendered below the line) */}
      {volume?.map((v, i) => {
        const x = toX(toDate(v.date).getTime()) - barWidth / 2;
        const bh = toBarH(v.count);
        const y = padT + h - bh;
        return (
          <rect
            key={`bar-${i}-${typeof v.date === "string" ? v.date : v.date.toISOString()}`}
            x={x}
            y={y}
            width={barWidth}
            height={bh}
            fill={BAR_COLOR}
            stroke={BAR_OUTLINE}
            strokeWidth={0.5}
            rx={1}
          />
        );
      })}
      {/* Composite line */}
      <path
        d={linePath}
        fill="none"
        stroke={LINE_COLOR}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Latest-point marker */}
      {(() => {
        const last = trajectory.reduce((a, b) =>
          toDate(a.date).getTime() > toDate(b.date).getTime() ? a : b,
        );
        const x = toX(toDate(last.date).getTime());
        const y = toY(last.composite);
        return <circle cx={x} cy={y} r={3} fill={LINE_COLOR} />;
      })()}
    </svg>
  );
}
