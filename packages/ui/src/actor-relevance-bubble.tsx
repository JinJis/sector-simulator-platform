import type { CSSProperties } from "react";

/**
 * ActorRelevanceBubble (M53).
 *
 * Scatter / bubble plot answering "who matters most + who's moving":
 *   - x: per-vision relevance (0..100)
 *   - y: 90-day signal volume (linear; auto domain)
 *   - size: actor stage (research < pilot < commercial < scaling)
 *   - color: category (public_corp / startup / govt / lab / standards / ngo)
 *
 * Each bubble is a clickable anchor when `href` is set on the item,
 * routing to the actor detail page. Pure SVG (RSC-safe).
 */

export type ActorBubbleStage =
  | "research"
  | "pilot"
  | "commercial"
  | "scaling";

export interface ActorBubblePoint {
  actor_key: string;
  label: string;
  relevance: number; // 0..100
  signal_count: number; // last 90d
  stage: ActorBubbleStage | string;
  category?: string;
  href?: string;
}

export interface ActorRelevanceBubbleProps {
  items: ActorBubblePoint[];
  width?: number;
  height?: number;
  /** Optional caption shown under the chart. */
  caption?: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const STAGE_RADIUS: Record<string, number> = {
  research: 5,
  pilot: 8,
  commercial: 11,
  scaling: 14,
};

const CATEGORY_FILL: Record<string, string> = {
  public_corp: "rgba(110, 231, 183, 0.65)", // emerald
  private_startup: "rgba(244, 114, 182, 0.65)", // pink
  government_lab: "rgba(245, 158, 11, 0.65)", // amber
  national_lab: "rgba(251, 146, 60, 0.65)", // orange
  academic_lab: "rgba(167, 139, 250, 0.65)", // violet
  standards_body: "rgba(59, 130, 246, 0.65)", // blue
  ngo: "rgba(34, 211, 238, 0.65)", // cyan
};

const CATEGORY_STROKE: Record<string, string> = {
  public_corp: "rgb(110, 231, 183)",
  private_startup: "rgb(244, 114, 182)",
  government_lab: "rgb(245, 158, 11)",
  national_lab: "rgb(251, 146, 60)",
  academic_lab: "rgb(167, 139, 250)",
  standards_body: "rgb(59, 130, 246)",
  ngo: "rgb(34, 211, 238)",
};

function radius(stage: string): number {
  return STAGE_RADIUS[stage] ?? 7;
}

function fillFor(category: string | undefined): string {
  return CATEGORY_FILL[category ?? ""] ?? "rgba(115, 115, 115, 0.55)";
}

function strokeFor(category: string | undefined): string {
  return CATEGORY_STROKE[category ?? ""] ?? "rgb(115, 115, 115)";
}

export function ActorRelevanceBubble({
  items,
  width = 640,
  height = 320,
  caption,
  className,
  style,
  ariaLabel,
}: ActorRelevanceBubbleProps) {
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const maxCount = Math.max(1, ...items.map((i) => i.signal_count));
  const xMin = 0;
  const xMax = 100;

  const toX = (relevance: number) =>
    padL + ((Math.max(0, Math.min(100, relevance)) - xMin) / (xMax - xMin || 1)) * w;
  const toY = (count: number) => padT + h - (count / maxCount) * h;

  // X ticks (0/50/100) + Y ticks (max, max/2, 0).
  const xTicks = [0, 50, 100];
  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  return (
    <div className={className} style={style}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
      >
        {/* Grid */}
        {xTicks.map((tx) => {
          const x = toX(tx);
          return (
            <g key={`x-${tx}`}>
              <line
                x1={x}
                x2={x}
                y1={padT}
                y2={padT + h}
                stroke="var(--chart-grid)"
                strokeWidth={0.75}
                strokeDasharray="2 4"
                opacity={0.6}
              />
              <text
                x={x}
                y={height - 12}
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="9"
                fill="var(--chart-label)"
              >
                {tx}
              </text>
            </g>
          );
        })}
        {yTicks.map((ty, i) => {
          const y = toY(ty);
          return (
            <g key={`y-${i}-${ty}`}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
                strokeWidth={0.75}
                strokeDasharray="2 4"
                opacity={0.6}
              />
              <text
                x={padL - 4}
                y={y + 3}
                textAnchor="end"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="9"
                fill="var(--chart-label)"
              >
                {ty}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text
          x={padL + w / 2}
          y={height - 2}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui"
          fontSize="9"
          fill="var(--chart-label)"
        >
          Per-vision relevance →
        </text>
        <text
          x={12}
          y={padT + h / 2}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui"
          fontSize="9"
          fill="var(--chart-label)"
          transform={`rotate(-90 12 ${padT + h / 2})`}
        >
          Signals last 90d ↑
        </text>

        {/* Bubbles */}
        {items.map((p) => {
          const cx = toX(p.relevance);
          const cy = toY(p.signal_count);
          const r = radius(String(p.stage));
          const Tag = (p.href ? "a" : "g") as "a" | "g";
          const tagProps = p.href ? { href: p.href } : {};
          return (
            <Tag {...tagProps} key={p.actor_key}>
              <title>
                {p.label}
                {` · relevance ${Math.round(p.relevance)} · ${p.signal_count} signals (90d) · ${p.stage}`}
              </title>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={fillFor(p.category)}
                stroke={strokeFor(p.category)}
                strokeWidth={1.25}
              />
              <text
                x={cx + r + 3}
                y={cy + 3}
                fontFamily="ui-sans-serif, system-ui"
                fontSize="9"
                fill="var(--chart-strong-label)"
              >
                {p.label}
              </text>
            </Tag>
          );
        })}
      </svg>
      {caption && (
        <p className="mt-1 text-[10px] text-neutral-500">{caption}</p>
      )}
    </div>
  );
}
