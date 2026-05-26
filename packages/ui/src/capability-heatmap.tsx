import type { CSSProperties } from "react";

/**
 * Capability heatmap (MP3).
 *
 * For one actor's detail page, shows how much recent signal volume that
 * actor produced across each capability they are bound to. Bars are
 * normalized to the max in the set so the strongest binding always
 * fills the column; muted colors when count = 0 (so unbound caps still
 * appear but visibly empty).
 *
 * Click a bar → `href` opens the matching capability detail page. The
 * consumer decides href shape (typically `/visions/<slug>/capabilities
 * /<key>`) so this component stays routing-agnostic.
 *
 * Color carries role semantics (lead = emerald, supplier = cyan,
 * customer = amber, competitor = neutral, regulator = violet) — same
 * palette CapabilityActor uses elsewhere so users learn it once.
 */

export type CapabilityHeatmapRole =
  | "lead"
  | "supplier"
  | "customer"
  | "competitor"
  | "regulator";

export interface CapabilityHeatmapItem {
  capability_key: string;
  label: string;
  count: number;
  role?: CapabilityHeatmapRole | string;
  href?: string;
}

export interface CapabilityHeatmapProps {
  items: CapabilityHeatmapItem[];
  /** Tagline shown below the bar grid. Optional. */
  caption?: string;
  className?: string;
  style?: CSSProperties;
}

const ROLE_BAR: Record<string, string> = {
  lead: "bg-emerald-500/80 group-hover:bg-emerald-400",
  supplier: "bg-cyan-500/80 group-hover:bg-cyan-400",
  customer: "bg-amber-500/80 group-hover:bg-amber-400",
  competitor: "bg-neutral-500/70 group-hover:bg-neutral-400",
  regulator: "bg-violet-500/80 group-hover:bg-violet-400",
};

const ROLE_EMPTY: Record<string, string> = {
  lead: "bg-emerald-900/30",
  supplier: "bg-cyan-900/30",
  customer: "bg-amber-900/30",
  competitor: "bg-neutral-800",
  regulator: "bg-violet-900/30",
};

function barClass(role: string | undefined, isEmpty: boolean): string {
  const key = (role ?? "competitor").toLowerCase();
  if (isEmpty) return ROLE_EMPTY[key] ?? ROLE_EMPTY.competitor!;
  return ROLE_BAR[key] ?? ROLE_BAR.competitor!;
}

export function CapabilityHeatmap({
  items,
  caption,
  className,
  style,
}: CapabilityHeatmapProps) {
  if (items.length === 0) return null;

  const maxCount = Math.max(1, ...items.map((i) => i.count));

  return (
    <div className={className} style={style}>
      <ol
        className="flex items-end gap-1.5"
        // Bars sit on a 64px-tall baseline; height = pct of max.
        style={{ minHeight: 80 }}
      >
        {items.map((item) => {
          const pct = Math.round((item.count / maxCount) * 100);
          const height = item.count > 0 ? Math.max(8, (pct * 64) / 100) : 4;
          const Tag = (item.href ? "a" : "div") as "a" | "div";
          const tagProps = item.href ? { href: item.href } : {};
          return (
            <li
              key={item.capability_key}
              className="group flex min-w-0 flex-1 flex-col items-center"
            >
              <Tag
                {...tagProps}
                className={`block w-full max-w-[40px] rounded-t-sm transition-colors ${barClass(item.role, item.count === 0)}`}
                style={{ height }}
                title={`${item.label} · ${item.count} signals${item.role ? ` · ${item.role}` : ""}`}
              />
              <span
                className="mt-1 w-full truncate text-center text-[9px] uppercase tracking-wide text-neutral-500 group-hover:text-neutral-300"
                title={item.label}
              >
                {item.label}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-neutral-600">
                {item.count}
              </span>
            </li>
          );
        })}
      </ol>
      {caption && (
        <p className="mt-2 text-[10px] text-neutral-500">{caption}</p>
      )}
    </div>
  );
}
