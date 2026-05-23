import type { CSSProperties } from "react";

export interface DimensionBarsProps {
  /** 0-100 or null per dimension. Null renders an empty bar with the
   * "—" placeholder so cards stay layout-stable when a score is missing. */
  technical: number | null;
  economic: number | null;
  regulatory: number | null;
  supply: number | null;
  /** Compact = single-row pill style; default = labeled row layout. */
  variant?: "default" | "compact";
  /** Drop the labels (just bars). */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface RowProps {
  label: string;
  value: number | null;
  bare: boolean;
}

const DIM_LABELS = {
  technical: "tech",
  economic: "econ",
  regulatory: "reg",
  supply: "sup",
} as const;

/**
 * Color a score on a 0-100 ramp.
 * 0-30   = rose (red)
 * 30-60  = amber
 * 60-100 = emerald (green)
 */
function scoreColor(v: number | null): string {
  if (v == null) return "rgb(64 64 64)"; // neutral-700
  if (v < 30) return "rgb(244 63 94)"; // rose-500
  if (v < 60) return "rgb(245 158 11)"; // amber-500
  return "rgb(110 231 183)"; // emerald-300
}

function DimRow({ label, value, bare }: RowProps) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const display = value == null ? "—" : Math.round(value).toString();
  return (
    <div className="flex items-center gap-2 text-[10px] leading-none tabular-nums">
      {!bare && (
        <span className="w-10 shrink-0 text-neutral-500 uppercase tracking-wide">
          {label}
        </span>
      )}
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-neutral-800">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: scoreColor(value),
          }}
        />
      </div>
      {!bare && (
        <span className="w-7 shrink-0 text-right font-mono text-neutral-300">
          {display}
        </span>
      )}
    </div>
  );
}

/**
 * Four-dimension readiness bars (technical / economic / regulatory /
 * supply). The atomic building block for `CapabilityCard`.
 *
 * Variants:
 *  - `default`  — labeled rows, fixed widths so cards align
 *  - `compact`  — 4 thin pills in a row (used in dense lists)
 */
export function DimensionBars({
  technical,
  economic,
  regulatory,
  supply,
  variant = "default",
  bare = false,
  className,
  style,
}: DimensionBarsProps) {
  const rows = [
    ["technical", technical, DIM_LABELS.technical],
    ["economic", economic, DIM_LABELS.economic],
    ["regulatory", regulatory, DIM_LABELS.regulatory],
    ["supply", supply, DIM_LABELS.supply],
  ] as const;

  if (variant === "compact") {
    return (
      <div
        className={`flex items-center gap-1 ${className ?? ""}`}
        style={style}
        role="group"
        aria-label="Capability readiness — 4 dimensions"
      >
        {rows.map(([dim, value]) => (
          <div
            key={dim}
            className="h-1.5 w-6 overflow-hidden rounded-sm bg-neutral-800"
            title={`${dim}: ${value ?? "—"}`}
          >
            <div
              className="h-full"
              style={{
                width: value == null ? "0%" : `${Math.max(0, Math.min(100, value))}%`,
                background: scoreColor(value),
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
      style={style}
      role="group"
      aria-label="Capability readiness — 4 dimensions"
    >
      {rows.map(([dim, value, label]) => (
        <DimRow key={dim} label={label} value={value} bare={bare} />
      ))}
    </div>
  );
}
