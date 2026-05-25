import type { CSSProperties, ReactNode } from "react";

import { DimensionBars } from "./dimension-bars";

export interface CapabilityCardProps {
  /** Capability key — used as the card href fragment. Not rendered. */
  capabilityKey: string;
  /** Compact card label. Falls back to `name` when missing. */
  shortName?: string | null;
  /** Full capability name (a11y / fallback). */
  name: string;
  /** Composite 0-100. Null = "not assessed yet". */
  composite: number | null;
  /** Signed delta from prior snapshot. Renders ▲/▼ pill. */
  delta?: number | null;
  /** Flag this capability as the binding constraint on the vision. */
  isBinding?: boolean;
  /** 4-dimension scores. */
  technical: number | null;
  economic: number | null;
  regulatory: number | null;
  supply: number | null;
  /** One-line "Latest: …" summary anchored to the most recent signal. */
  latestSignal?: {
    title: string;
    direction?: "up" | "down" | "neutral";
  } | null;
  /** Optional href — when set, the card renders as <a>. */
  href?: string;
  /** Optional click handler for non-anchor contexts. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  /**
   * Children slot at the bottom of the card — used by the hero to embed
   * extra context (e.g. binding-constraint reason). Optional.
   */
  children?: ReactNode;
}

function compositeColor(v: number | null): string {
  if (v == null) return "rgb(115 115 115)";
  if (v < 30) return "rgb(244 63 94)";
  if (v < 60) return "rgb(245 158 11)";
  return "rgb(110 231 183)";
}

/**
 * The 4-dim capability card rendered on the hero Overview.
 *
 * Layout (top to bottom):
 *   - Row 1: short_name + optional ⚠ BINDING pill
 *   - Row 2: big composite number + delta arrow
 *   - Row 3: 4-dim bars (tech / econ / reg / supply)
 *   - Row 4 (optional): "Latest: …" one-liner
 *   - Row 5 (optional): children (custom slot)
 *
 * Becomes an anchor when href is set, with proper focus styles for
 * keyboard nav (key page in the IA — many cards on one screen).
 */
export function CapabilityCard({
  capabilityKey,
  shortName,
  name,
  composite,
  delta,
  isBinding = false,
  technical,
  economic,
  regulatory,
  supply,
  latestSignal,
  href,
  onClick,
  className,
  style,
  children,
}: CapabilityCardProps) {
  const display = shortName || name;
  const compColor = compositeColor(composite);
  const deltaSign = delta == null ? null : delta > 0 ? "▲" : delta < 0 ? "▼" : "─";
  const deltaColor =
    delta == null
      ? "rgb(115 115 115)"
      : delta > 0
      ? "rgb(110 231 183)"
      : delta < 0
      ? "rgb(251 113 133)"
      : "rgb(115 115 115)";

  const cardContent = (
    <div
      className={`group flex h-full flex-col gap-3 rounded-lg border bg-neutral-900/60 p-3 transition-colors ${
        isBinding
          ? "border-amber-500/60 hover:border-amber-400"
          : "border-neutral-800 hover:border-neutral-700"
      } ${className ?? ""}`}
      style={style}
      data-capability-key={capabilityKey}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-200" title={name}>
            {display}
          </div>
        </div>
        {isBinding && (
          <span
            className="shrink-0 rounded-sm border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-400"
            title="Binding constraint — lowest weighted dimension dragging the vision feasibility down"
          >
            ⚠ Binding
          </span>
        )}
      </div>

      {/* Composite + delta */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl font-semibold leading-none" style={{ color: compColor }}>
          {composite == null ? "—" : Math.round(composite)}
        </span>
        <span className="text-[10px] text-neutral-500">/ 100</span>
        {delta != null && (
          <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: deltaColor }}>
            {deltaSign} {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        )}
      </div>

      {/* Dimension bars */}
      <DimensionBars
        technical={technical}
        economic={economic}
        regulatory={regulatory}
        supply={supply}
      />

      {/* Latest signal one-liner */}
      {latestSignal && (
        <div className="border-t border-neutral-800 pt-2 text-xs leading-snug text-neutral-400">
          <span className="text-neutral-500">Latest: </span>
          <span className="text-neutral-300" title={latestSignal.title}>
            {latestSignal.title}
          </span>
          {latestSignal.direction && (
            <span
              className="ml-1"
              style={{
                color:
                  latestSignal.direction === "up"
                    ? "rgb(110 231 183)"
                    : latestSignal.direction === "down"
                    ? "rgb(251 113 133)"
                    : "rgb(115 115 115)",
              }}
            >
              {latestSignal.direction === "up" ? "↗" : latestSignal.direction === "down" ? "↘" : "→"}
            </span>
          )}
        </div>
      )}

      {children}
    </div>
  );

  // Overlay-link pattern: HTML forbids nested <a>/<button>, so we
  // wrap the card in a positioning container, render cardContent
  // above (z-10) and lay a transparent click target underneath
  // (z-0). Children that are themselves anchors (ActorPill, etc.)
  // stay inside cardContent and remain clickable independently —
  // their hit area sits above the overlay because of the parent
  // z-stacking. Clicking anywhere else on the card routes to the
  // capability detail page through the overlay.
  if (href) {
    return (
      <div className="relative">
        <div className="relative z-10">{cardContent}</div>
        <a
          href={href}
          className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          aria-label={`Capability detail: ${name}`}
        />
      </div>
    );
  }
  if (onClick) {
    return (
      <div className="relative">
        <div className="relative z-10">{cardContent}</div>
        <button
          type="button"
          onClick={onClick}
          className="absolute inset-0 z-0 w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          aria-label={`Capability detail: ${name}`}
        />
      </div>
    );
  }
  return cardContent;
}
