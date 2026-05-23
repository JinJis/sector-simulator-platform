import type { CSSProperties } from "react";

import { countryFlag } from "./actor-card";

export interface ActorPillProps {
  /** Stable actor key — drives href fragment + ARIA. */
  actorKey: string;
  /** Display name (short_name preferred). */
  name: string;
  /** Optional ISO 3166-1 alpha-2 — renders trailing flag emoji. */
  isoCountry?: string | null;
  /** Optional role label rendered as a colored prefix ("lead" / "supplier"). */
  role?: "lead" | "competitor" | "supplier" | "customer" | "regulator" | string | null;
  /** When set, the pill becomes an anchor. */
  href?: string;
  /** When true, the pill is rendered slightly more prominent (used on
   * capability detail / hero capability card). Default false. */
  emphasize?: boolean;
  className?: string;
  style?: CSSProperties;
}

const ROLE_COLOR: Record<string, string> = {
  lead: "text-emerald-300",
  competitor: "text-neutral-300",
  supplier: "text-blue-300",
  customer: "text-purple-300",
  regulator: "text-amber-300",
};

/**
 * Compact inline actor reference. Used in:
 *   - Capability card footer ("Active: SpaceX 🇺🇸 · Lonestar 🇺🇸 · Starcloud 🇺🇸")
 *   - Signal row trailing chip
 *   - Risk row "affected_capability_keys" expansion
 *   - Anywhere a one-line actor reference is needed
 *
 * Default rendering is text-only; emphasize=true adds the rounded
 * border + background so it pops as a tappable pill.
 */
export function ActorPill({
  actorKey,
  name,
  isoCountry,
  role,
  href,
  emphasize = false,
  className,
  style,
}: ActorPillProps) {
  const flag = isoCountry ? countryFlag(isoCountry) : null;
  const roleColor = role ? (ROLE_COLOR[role] ?? "text-neutral-400") : null;

  const inner = (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums ${
        emphasize
          ? "rounded-sm border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 hover:border-neutral-700"
          : ""
      } ${className ?? ""}`}
      style={style}
      data-actor-key={actorKey}
    >
      {role && (
        <span
          className={`text-[9px] font-medium uppercase tracking-wider ${roleColor}`}
          title={`Role: ${role}`}
        >
          {role}
        </span>
      )}
      <span className="text-neutral-200">{name}</span>
      {flag && (
        <span
          className="select-none text-[11px] leading-none"
          aria-label={isoCountry?.toUpperCase()}
          title={isoCountry?.toUpperCase()}
        >
          {flag}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <a
        href={href}
        className="text-neutral-200 hover:text-cyan-400 focus:outline-none focus-visible:underline"
        aria-label={`Actor: ${name}`}
      >
        {inner}
      </a>
    );
  }
  return inner;
}
