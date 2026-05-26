"use client";

import { useState, type CSSProperties } from "react";

/**
 * Severity × Likelihood matrix (MP4).
 *
 * Standard heatmap layout used in finance / safety dashboards:
 *
 *   Likelihood ↑
 *       high │  med-risk   │ high-risk  │ critical    │ critical
 *       med  │  low-risk   │ med-risk   │ high-risk   │ critical
 *       low  │  low-risk   │ low-risk   │ med-risk    │ high-risk
 *            └─────────────┴────────────┴─────────────┴───────────
 *                  low       medium        high         critical
 *                                  Severity →
 *
 * Cells show the count of risks landing in each bucket. Clicking a
 * cell calls `onCellClick(severity, likelihood)` so the consumer can
 * scroll or highlight the matching rows in the list below.
 *
 * Pure client component (needs onClick) — keeps the matrix self-
 * contained, no state plumbing required from the page.
 */

export type RiskMatrixSeverity = "low" | "medium" | "high" | "critical";
export type RiskMatrixLikelihood = "low" | "medium" | "high";

export interface RiskMatrixCell {
  severity: RiskMatrixSeverity;
  likelihood: RiskMatrixLikelihood;
  count: number;
}

export interface RiskMatrixProps {
  cells: RiskMatrixCell[];
  /** Called when a cell is clicked. The cell's count may be zero. */
  onCellClick?: (
    severity: RiskMatrixSeverity,
    likelihood: RiskMatrixLikelihood,
  ) => void;
  className?: string;
  style?: CSSProperties;
}

const SEVERITIES: RiskMatrixSeverity[] = ["low", "medium", "high", "critical"];
// Render likelihood top-down so "high" sits at the top of the grid
// (matches finance convention — higher = worse climb).
const LIKELIHOODS: RiskMatrixLikelihood[] = ["high", "medium", "low"];

const SEVERITY_RANK: Record<RiskMatrixSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const LIKELIHOOD_RANK: Record<RiskMatrixLikelihood, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_LABEL: Record<RiskMatrixSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
const LIKELIHOOD_LABEL: Record<RiskMatrixLikelihood, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * Risk score = severity × likelihood. 1 (best) … 12 (worst).
 * Mapped to a 5-band tailwind palette so the colour ramp reads at
 * a glance:
 *   1-2 = neutral (chill)
 *   3-4 = lime/yellow (watch)
 *   5-6 = amber  (concern)
 *   7-9 = orange (heightened)
 *  10-12 = rose  (red zone)
 */
function cellColor(severity: RiskMatrixSeverity, likelihood: RiskMatrixLikelihood, count: number): string {
  const score = SEVERITY_RANK[severity] * LIKELIHOOD_RANK[likelihood];
  if (count === 0) {
    // Empty cells still show the gradient (so the matrix is readable)
    // but at very low opacity.
    if (score <= 2) return "bg-neutral-900/30 border-neutral-800";
    if (score <= 4) return "bg-yellow-950/15 border-yellow-900/30";
    if (score <= 6) return "bg-amber-950/15 border-amber-900/30";
    if (score <= 9) return "bg-orange-950/15 border-orange-900/30";
    return "bg-rose-950/15 border-rose-900/30";
  }
  if (score <= 2) return "bg-neutral-800/80 border-neutral-700 text-neutral-200";
  if (score <= 4) return "bg-yellow-900/60 border-yellow-700/60 text-yellow-100";
  if (score <= 6) return "bg-amber-900/70 border-amber-700/70 text-amber-50";
  if (score <= 9) return "bg-orange-900/80 border-orange-700/80 text-orange-50";
  return "bg-rose-900/80 border-rose-700/80 text-rose-50";
}

export function RiskMatrix({
  cells,
  onCellClick,
  className,
  style,
}: RiskMatrixProps) {
  // Bucket the counts into a (severity, likelihood) lookup.
  const counts = new Map<string, number>();
  for (const c of cells) {
    counts.set(`${c.severity}|${c.likelihood}`, c.count);
  }
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className={className} style={style}>
      <div className="inline-grid gap-1 text-[10px]" style={{ gridTemplateColumns: "auto repeat(4, minmax(56px, 1fr))" }}>
        {/* header row */}
        <div />
        {SEVERITIES.map((s) => (
          <div
            key={`h-${s}`}
            className="px-1 text-center font-medium uppercase tracking-wider text-neutral-500"
          >
            {SEVERITY_LABEL[s]}
          </div>
        ))}
        {/* body rows */}
        {LIKELIHOODS.map((l) => (
          <ROW key={l} likelihood={l}>
            {SEVERITIES.map((s) => {
              const cellKey = `${s}|${l}`;
              const count = counts.get(cellKey) ?? 0;
              const isHover = hover === cellKey;
              return (
                <button
                  key={cellKey}
                  type="button"
                  onClick={() => onCellClick?.(s, l)}
                  onMouseEnter={() => setHover(cellKey)}
                  onMouseLeave={() => setHover((h) => (h === cellKey ? null : h))}
                  className={`flex h-12 flex-col items-center justify-center rounded border transition-colors ${cellColor(s, l, count)} ${isHover ? "ring-2 ring-cyan-500/70" : ""} ${count > 0 && onCellClick ? "cursor-pointer" : "cursor-default"}`}
                  aria-label={`${SEVERITY_LABEL[s]} severity, ${LIKELIHOOD_LABEL[l]} likelihood, ${count} risks`}
                  title={`${SEVERITY_LABEL[s]} × ${LIKELIHOOD_LABEL[l]} — ${count} risk${count === 1 ? "" : "s"}`}
                >
                  <span className="font-mono text-base font-medium tabular-nums leading-none">
                    {count}
                  </span>
                </button>
              );
            })}
          </ROW>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-neutral-500">
        Severity → · Likelihood ↑ — cells colour by severity × likelihood; click to filter the list below.
      </p>
    </div>
  );
}

function ROW({
  likelihood,
  children,
}: {
  likelihood: RiskMatrixLikelihood;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-right font-medium uppercase tracking-wider text-neutral-500">
        {LIKELIHOOD_LABEL[likelihood]}
      </div>
      {children}
    </>
  );
}
