import type { CSSProperties } from "react";

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskLikelihood = "low" | "medium" | "high";

export interface RiskRowProps {
  /** Category drives the leading label color/icon (political / legal / supply / safety / etc). */
  category: string;
  /** Short name — what's the risk. */
  name: string;
  /** One-line description rendered next to the name. */
  description?: string | null;
  severity: RiskSeverity;
  likelihood?: RiskLikelihood | null;
  /** Optional time-horizon chip (immediate / 1y / 3y / 5y / 10y). */
  timeHorizon?: string | null;
  /** Compact = single-line; expanded shows description on a second line. */
  variant?: "default" | "compact";
  className?: string;
  style?: CSSProperties;
}

const SEVERITY_COLOR: Record<RiskSeverity, { bg: string; ring: string; label: string }> = {
  low: { bg: "rgb(115 115 115)", ring: "rgb(115 115 115)", label: "LOW" },
  medium: { bg: "rgb(245 158 11)", ring: "rgb(245 158 11)", label: "MED" },
  high: { bg: "rgb(244 63 94)", ring: "rgb(244 63 94)", label: "HIGH" },
  critical: { bg: "rgb(244 63 94)", ring: "rgb(244 63 94)", label: "CRIT" },
};

const CATEGORY_LABEL: Record<string, string> = {
  political: "Political",
  legal: "Legal",
  supply: "Supply",
  safety: "Safety",
  environmental: "Env",
  financial: "Financial",
  social: "Social",
};

/**
 * One row on the hero Risk Board. Severity-coded dot + category +
 * name + (optional) description. `critical` severity gets a ring +
 * filled dot; lower severities get filled dot only. `low` severity
 * renders as an outline dot to read "low priority" at a glance.
 */
export function RiskRow({
  category,
  name,
  description,
  severity,
  likelihood,
  timeHorizon,
  variant = "default",
  className,
  style,
}: RiskRowProps) {
  const sev = SEVERITY_COLOR[severity];
  const catLabel = CATEGORY_LABEL[category] ?? category;

  // Visual style: low = outline; medium/high/critical = filled.
  const isFilled = severity !== "low";

  return (
    <div
      className={`flex items-start gap-3 py-1.5 ${className ?? ""}`}
      style={style}
      role="listitem"
    >
      {/* Severity dot */}
      <span
        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background: isFilled ? sev.bg : "transparent",
          boxShadow: `0 0 0 1px ${sev.ring}${severity === "critical" ? ", 0 0 0 3px " + sev.ring + "30" : ""}`,
        }}
        aria-label={`severity: ${severity}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            {catLabel}
          </span>
          <span className="text-sm font-medium text-neutral-200">{name}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: sev.bg }}>
            {sev.label}
          </span>
          {likelihood && (
            <span className="text-[10px] text-neutral-500" title={`likelihood: ${likelihood}`}>
              · {likelihood} likelihood
            </span>
          )}
          {timeHorizon && (
            <span className="rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
              {timeHorizon}
            </span>
          )}
        </div>
        {description && variant === "default" && (
          <p className="mt-1 text-xs leading-snug text-neutral-400" title={description}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
