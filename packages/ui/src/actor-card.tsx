import type { CSSProperties, ReactNode } from "react";

export type ActorCategory =
  | "public_corp"
  | "private_startup"
  | "government_lab"
  | "national_lab"
  | "academic_lab"
  | "standards_body"
  | "ngo";

export type ActorStage = "research" | "pilot" | "commercial" | "scaling";

export interface ActorCardProps {
  /** Stable actor key (used as the link target fragment). */
  actorKey: string;
  /** Display name. */
  name: string;
  /** Optional short name to fit the card width — falls back to `name`. */
  shortName?: string | null;
  /** ISO 3166-1 alpha-2 — "US", "KR", … — rendered as a flag emoji. */
  isoCountry: string;
  /** Drives the category badge icon + tooltip. */
  category: ActorCategory | string;
  /** Maturity pill color. */
  stage: ActorStage | string;
  /** Optional one-line tagline. */
  blurb?: string | null;
  /** Listing info — when set, ticker + exchange pill renders. */
  ticker?: string | null;
  exchange?: string | null;
  /** Optional logo URL — falls back to initial-letter avatar. */
  logoUrl?: string | null;
  /** Most recent signal one-liner ("Starship V3 first burn"). */
  latestSignal?: { title: string; direction?: "up" | "down" | "neutral" } | null;
  /** Optional vision-specific relevance (0-100) — surfaces as a small pill. */
  relevance?: number | null;
  /** Anchor href — when set, the card becomes a link. */
  href?: string;
  /** Optional click handler for non-anchor contexts. */
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  /** Bottom slot for custom content (e.g. capability roles per actor). */
  children?: ReactNode;
}

const CATEGORY_ICON: Record<string, string> = {
  public_corp: "🏢",
  private_startup: "🚀",
  government_lab: "🏛️",
  national_lab: "🔬",
  academic_lab: "🎓",
  standards_body: "📐",
  ngo: "🌐",
};

const CATEGORY_LABEL: Record<string, string> = {
  public_corp: "Public corp",
  private_startup: "Startup",
  government_lab: "Govt lab",
  national_lab: "National lab",
  academic_lab: "Academic",
  standards_body: "Standards",
  ngo: "NGO",
};

type StageColor = { bg: string; text: string; border: string };

const STAGE_COLOR_FALLBACK: StageColor = {
  bg: "bg-amber-500/10",
  text: "text-amber-400",
  border: "border-amber-500/40",
};

const STAGE_COLOR: Record<string, StageColor> = {
  research: STAGE_COLOR_FALLBACK,
  pilot: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/40",
  },
  commercial: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
  },
  scaling: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-300",
    border: "border-cyan-500/50",
  },
};

/**
 * Convert ISO 3166-1 alpha-2 country code → flag emoji. Lower-case
 * accepted. Unknown → globe emoji.
 */
export function countryFlag(iso: string): string {
  if (!iso || iso.length !== 2) return "🌐";
  const code = iso.toUpperCase();
  const A = 0x41;
  const REGIONAL_A = 0x1f1e6;
  const codePoints = [...code].map((c) => REGIONAL_A + (c.charCodeAt(0) - A));
  if (codePoints.some((cp) => cp < REGIONAL_A || cp > REGIONAL_A + 25)) return "🌐";
  return String.fromCodePoint(...codePoints);
}

/**
 * Initial-letter avatar — used when logo_url is missing or fails.
 * Color picked deterministically from the actor key so the same actor
 * gets the same color across renders.
 */
function initialAvatar(key: string, name: string): { letter: string; color: string } {
  const letter = (name || key).trim().charAt(0).toUpperCase() || "?";
  // Deterministic hash → hue.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return { letter, color: `hsl(${hue} 55% 35%)` };
}

/**
 * The actor card used in:
 *   - Hero "Actors" band (top-N per vision, sorted by relevance)
 *   - `/visions/[slug]/actors` index page
 *   - `/visions/[slug]/capabilities/[key]` capability detail (filtered
 *     to actors active on this capability)
 *
 * Visual layout (top to bottom):
 *   Row 1: logo|avatar + name + flag + category icon + ticker pill
 *   Row 2: blurb (clamped to 2 lines)
 *   Row 3: stage pill + relevance pill + latest signal (truncated)
 *   Slot: optional children for capability role badges, etc.
 */
export function ActorCard({
  actorKey,
  name,
  shortName,
  isoCountry,
  category,
  stage,
  blurb,
  ticker,
  exchange,
  logoUrl,
  latestSignal,
  relevance,
  href,
  onClick,
  className,
  style,
  children,
}: ActorCardProps) {
  const display = shortName || name;
  const flag = countryFlag(isoCountry);
  const catIcon = CATEGORY_ICON[category] ?? "❓";
  const catLabel = CATEGORY_LABEL[category] ?? category;
  const stageColor: StageColor = STAGE_COLOR[stage] ?? STAGE_COLOR_FALLBACK;
  const avatar = initialAvatar(actorKey, name);

  const cardContent = (
    <div
      className={`group flex h-full flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 transition-colors hover:border-neutral-700 ${className ?? ""}`}
      style={style}
      data-actor-key={actorKey}
    >
      <div className="flex items-start gap-2.5">
        {/* Logo / initial avatar */}
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-sm border border-neutral-800 object-contain bg-neutral-950"
            loading="lazy"
            aria-hidden="true"
          />
        ) : (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-neutral-800 font-mono text-sm font-semibold text-neutral-100"
            style={{ background: avatar!.color }}
            aria-hidden="true"
          >
            {avatar!.letter}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="truncate text-sm font-medium text-neutral-100"
              title={name}
            >
              {display}
            </span>
            <span
              className="shrink-0 select-none text-sm leading-none"
              aria-label={isoCountry.toUpperCase()}
              title={isoCountry.toUpperCase()}
            >
              {flag}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span aria-label={catLabel} title={catLabel}>
              {catIcon}
            </span>
            <span>{catLabel}</span>
            {ticker && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className="font-mono text-[10px] tracking-wider text-neutral-400"
                  title={exchange ? `${ticker} on ${exchange}` : ticker}
                >
                  {ticker}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {blurb && (
        <p
          className="line-clamp-2 text-xs leading-snug text-neutral-400"
          title={blurb}
        >
          {blurb}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-1">
        <span
          className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${stageColor.bg} ${stageColor.text} ${stageColor.border}`}
          title={`Stage: ${stage}`}
        >
          {stage}
        </span>
        {relevance != null && (
          <span
            className="shrink-0 rounded-sm border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-neutral-400"
            title={`Per-vision relevance: ${relevance}/100`}
          >
            {Math.round(relevance)}
          </span>
        )}
      </div>

      {latestSignal && (
        <div className="border-t border-neutral-800 pt-1.5 text-[11px] leading-snug text-neutral-400">
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
              {latestSignal.direction === "up"
                ? "↗"
                : latestSignal.direction === "down"
                  ? "↘"
                  : "→"}
            </span>
          )}
        </div>
      )}

      {children}
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        aria-label={`Actor detail: ${name}`}
      >
        {cardContent}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        aria-label={`Actor detail: ${name}`}
      >
        {cardContent}
      </button>
    );
  }
  return cardContent;
}
