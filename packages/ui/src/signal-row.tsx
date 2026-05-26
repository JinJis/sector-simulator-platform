import type { CSSProperties } from "react";

import { SourceChip, SourceList } from "./source-chip";

export type SignalKind =
  | "paper"
  | "patent"
  | "news"
  | "filing"
  | "gov_report"
  | "vendor_doc"
  | "dataset"
  | "social";

export interface SignalRowProps {
  /** Source taxonomy — controls the leading icon + tooltip. */
  kind: SignalKind | string;
  title: string;
  /** Optional summary on second line (truncates with line-clamp). */
  summary?: string | null;
  /** Capability key + display label for the trailing pill. */
  capability?: { key: string; label: string } | null;
  /** Composite delta — drives ↗/↘ arrow + magnitude pill. */
  deltaComposite?: number | null;
  /** Source URL — when set, the title links out. */
  sourceUrl?: string | null;
  /** Grounded-search citations (digest signals). Each rendered as a
   *  small chip; popover lists all when ≥2. Empty / omitted = no
   *  extra chips. */
  citations?: { url: string; title: string }[] | null;
  /** ISO date string or Date — rendered as "3d ago" relative format. */
  publishedAt?: string | Date | null;
  /** Set true if the row is in the highlight stream (hero "Live Signals"). */
  highlighted?: boolean;
  /** Show summary on second line (default = compact, single line). */
  showSummary?: boolean;
  className?: string;
  style?: CSSProperties;
}

const KIND_ICON: Record<string, string> = {
  paper: "📄",
  patent: "📜",
  news: "📰",
  filing: "📑",
  gov_report: "🏛️",
  vendor_doc: "🔧",
  dataset: "📊",
  social: "💬",
};

const KIND_LABEL: Record<string, string> = {
  paper: "Paper",
  patent: "Patent",
  news: "News",
  filing: "Filing",
  gov_report: "Gov report",
  vendor_doc: "Vendor doc",
  dataset: "Dataset",
  social: "Social",
};

/**
 * `internal://digest/...` and `internal://crawler/...` are synthetic
 * source URLs the digest + fetcher pipeline uses for de-duplication
 * — they're not navigable, so don't render a SourceChip that links
 * to them. Real citations (when present) carry the actual URLs.
 */
function isInternalUrl(url: string): boolean {
  return url.startsWith("internal://");
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/**
 * One row in the hero "Live Signals" feed (and the Signals tab).
 * Layout: kind icon | title (+ optional summary) | capability pill |
 * relative time | delta arrow.
 *
 * When `sourceUrl` is set, the title becomes an anchor (target=_blank
 * + rel=noreferrer). The whole row stays semantically a div so screen
 * readers don't double-announce.
 */
export function SignalRow({
  kind,
  title,
  summary,
  capability,
  deltaComposite,
  sourceUrl,
  citations,
  publishedAt,
  highlighted = false,
  showSummary = false,
  className,
  style,
}: SignalRowProps) {
  const icon = KIND_ICON[kind] ?? "•";
  const kindLabel = KIND_LABEL[kind] ?? kind;
  const t = publishedAt instanceof Date ? publishedAt : publishedAt ? new Date(publishedAt) : null;
  const time = t ? relativeTime(t) : null;

  const deltaSign =
    deltaComposite == null
      ? null
      : deltaComposite > 0
      ? "↗"
      : deltaComposite < 0
      ? "↘"
      : "→";
  const deltaColor =
    deltaComposite == null
      ? "rgb(115 115 115)"
      : deltaComposite > 0
      ? "rgb(110 231 183)"
      : deltaComposite < 0
      ? "rgb(251 113 133)"
      : "rgb(115 115 115)";

  return (
    <div
      className={`flex items-start gap-3 py-1.5 ${highlighted ? "border-l-2 border-amber-500/50 pl-2.5" : ""} ${className ?? ""}`}
      style={style}
      role="listitem"
    >
      <span
        className="mt-0.5 select-none text-base leading-none"
        aria-label={kindLabel}
        title={kindLabel}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {sourceUrl && !isInternalUrl(sourceUrl) ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm leading-snug text-neutral-200 hover:text-cyan-400 hover:underline"
              title={title}
            >
              {title}
            </a>
          ) : (
            <span
              className="truncate text-sm leading-snug text-neutral-200"
              title={title}
            >
              {title}
            </span>
          )}
          {sourceUrl && !isInternalUrl(sourceUrl) && (
            <SourceChip
              source={{
                url: sourceUrl,
                title,
                kind,
                published_at: publishedAt,
              }}
              className="shrink-0"
            />
          )}
          {citations && citations.length > 0 && (
            <SourceList
              sources={citations.map((c) => ({
                url: c.url,
                title: c.title,
                kind: "research_brief",
                published_at: publishedAt,
              }))}
              label={`${citations.length} src`}
              className="shrink-0"
            />
          )}
        </div>
        {showSummary && summary && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-500">
            {summary}
          </p>
        )}
      </div>
      {capability && (
        <span
          className="shrink-0 rounded-sm border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400"
          title={`capability: ${capability.key}`}
        >
          {capability.label}
        </span>
      )}
      {time && (
        <span className="shrink-0 text-[10px] text-neutral-500 tabular-nums">{time}</span>
      )}
      {deltaComposite != null && (
        <span
          className="shrink-0 font-mono text-xs tabular-nums"
          style={{ color: deltaColor }}
          title={`composite delta: ${deltaComposite > 0 ? "+" : ""}${deltaComposite.toFixed(1)}`}
        >
          {deltaSign} {deltaComposite > 0 ? "+" : ""}
          {deltaComposite.toFixed(1)}
        </span>
      )}
    </div>
  );
}
