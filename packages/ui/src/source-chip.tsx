"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Source-link primitives (MP1).
 *
 * Used by SignalRow, RiskRow, InvestmentThesisPanel, CatalystsTimeline,
 * actor detail, and economics datapoints to attach a small clickable
 * "where did this come from?" chip to any score, claim, or event.
 *
 * Two flavors:
 *   - `SourceChip`  — one source. The whole chip is a link. Hover
 *                     shows kind · title · published_at.
 *   - `SourceList`  — N sources tied to one claim (thesis bullet, risk
 *                     line). Hover reveals a popover list; each item
 *                     is its own link.
 *
 * Design notes:
 *   - No JS state. Hover-open uses Tailwind `group-hover` so the
 *     popover Just Works on touch-via-keyboard (Tab) AND mouse.
 *   - Color is derived from `source_kind` so users learn the taxonomy
 *     by sight (Bloomberg-terminal vibe).
 *   - The chip itself is small (12px icon + ~2px padding) so it lives
 *     comfortably inline next to any text without dominating it.
 */

export type SourceKind =
  | "paper"
  | "patent"
  | "news"
  | "filing"
  | "gov_report"
  | "vendor_doc"
  | "dataset"
  | "social"
  | "research_brief"
  | "analyst_report"
  | "press"
  | "other";

export interface SourceRef {
  url: string;
  /** Optional short label — falls back to a human form of `kind`. */
  title?: string | null;
  /** Source taxonomy. Drives the color tag in the popover. */
  kind?: SourceKind | string | null;
  /** ISO date string or Date. Rendered as "3d ago" in the popover. */
  published_at?: string | Date | null;
}

const KIND_LABEL: Record<string, string> = {
  paper: "Paper",
  patent: "Patent",
  news: "News",
  filing: "Filing",
  gov_report: "Gov report",
  vendor_doc: "Vendor doc",
  dataset: "Dataset",
  social: "Social",
  research_brief: "Research brief",
  analyst_report: "Analyst report",
  press: "Press",
  other: "Source",
};

const KIND_COLOR: Record<string, { dot: string; text: string }> = {
  paper: { dot: "bg-cyan-400", text: "text-cyan-300" },
  patent: { dot: "bg-violet-400", text: "text-violet-300" },
  news: { dot: "bg-amber-400", text: "text-amber-300" },
  filing: { dot: "bg-blue-400", text: "text-blue-300" },
  gov_report: { dot: "bg-rose-400", text: "text-rose-300" },
  vendor_doc: { dot: "bg-emerald-400", text: "text-emerald-300" },
  dataset: { dot: "bg-indigo-400", text: "text-indigo-300" },
  social: { dot: "bg-pink-400", text: "text-pink-300" },
  research_brief: { dot: "bg-teal-400", text: "text-teal-300" },
  analyst_report: { dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
  press: { dot: "bg-orange-400", text: "text-orange-300" },
  other: { dot: "bg-neutral-400", text: "text-neutral-300" },
};

const FALLBACK_LABEL = "Source";
const FALLBACK_COLOR = { dot: "bg-neutral-400", text: "text-neutral-300" };

function kindLabel(kind?: string | null): string {
  if (!kind) return FALLBACK_LABEL;
  return KIND_LABEL[kind] ?? kind;
}

function kindColor(kind?: string | null): { dot: string; text: string } {
  if (!kind) return FALLBACK_COLOR;
  return KIND_COLOR[kind] ?? FALLBACK_COLOR;
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (Number.isNaN(sec)) return "";
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

function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return d;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function LinkIcon({ className }: { className?: string }) {
  // 12px inline SVG. Outline only so it inherits currentColor.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-3 w-3"}
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// --------------------------------------------------------------------------
// SourceChip — one source. The chip itself is the link.
// --------------------------------------------------------------------------

export interface SourceChipProps {
  source: SourceRef;
  /** Compact (icon-only) or with the kind label inline. Default: compact. */
  variant?: "compact" | "labeled";
  /** Direction the popover opens. Default: "below". */
  popoverPlacement?: "below" | "above";
  className?: string;
  style?: CSSProperties;
}

export function SourceChip({
  source,
  variant = "compact",
  popoverPlacement = "below",
  className,
  style,
}: SourceChipProps) {
  const color = kindColor(source.kind);
  const label = kindLabel(source.kind);
  const t = toDate(source.published_at);
  const time = t ? relativeTime(t) : null;
  const popoverPos =
    popoverPlacement === "below" ? "top-full mt-1" : "bottom-full mb-1";

  return (
    <span
      className={`group relative inline-flex items-center ${className ?? ""}`}
      style={style}
    >
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900/60 px-1.5 py-0.5 text-[10px] leading-none transition-colors hover:border-neutral-600 hover:bg-neutral-800 ${color.text}`}
        aria-label={`Open ${label}: ${source.title ?? source.url}`}
      >
        <LinkIcon className="h-2.5 w-2.5" />
        {variant === "labeled" && (
          <span className="font-mono uppercase tracking-wide">{label}</span>
        )}
      </a>
      <span
        className={`pointer-events-none absolute left-0 ${popoverPos} z-50 hidden min-w-[220px] max-w-[320px] rounded-md border border-neutral-800 bg-neutral-950 p-2 text-left shadow-xl group-hover:block group-focus-within:block`}
      >
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
          <span
            className={`font-mono text-[10px] uppercase tracking-wide ${color.text}`}
          >
            {label}
          </span>
          {time && (
            <span className="ml-auto text-[10px] text-neutral-500 tabular-nums">
              {time}
            </span>
          )}
        </span>
        {source.title && (
          <span className="mt-1 block text-xs leading-snug text-neutral-200">
            {source.title}
          </span>
        )}
        <span className="mt-1 block truncate text-[10px] text-neutral-500">
          {source.url}
        </span>
      </span>
    </span>
  );
}

// --------------------------------------------------------------------------
// SourceList — N sources. Trigger is a button-like chip; each list item
// in the popover is its own clickable anchor.
// --------------------------------------------------------------------------

export interface SourceListProps {
  sources: SourceRef[];
  /** Inline label rendered next to the count, e.g. "Sources". */
  label?: ReactNode;
  /** Direction the popover opens. Default: "below". */
  popoverPlacement?: "below" | "above";
  className?: string;
  style?: CSSProperties;
}

export function SourceList({
  sources,
  label,
  popoverPlacement = "below",
  className,
  style,
}: SourceListProps) {
  if (!sources || sources.length === 0) return null;
  // Single source: degrade to a SourceChip so the UX stays one link
  // (no need to open a popover to click one item).
  const only = sources[0];
  if (sources.length === 1 && only) {
    return (
      <SourceChip
        source={only}
        variant="compact"
        popoverPlacement={popoverPlacement}
        className={className}
        style={style}
      />
    );
  }

  const popoverPos =
    popoverPlacement === "below" ? "top-full mt-1" : "bottom-full mb-1";

  return (
    <span
      className={`group relative inline-flex items-center ${className ?? ""}`}
      style={style}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900/60 px-1.5 py-0.5 text-[10px] leading-none text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800"
        aria-label={`Show ${sources.length} sources`}
      >
        <LinkIcon className="h-2.5 w-2.5" />
        <span className="font-mono tabular-nums">{sources.length}</span>
        {label && <span className="ml-1">{label}</span>}
      </button>
      <span
        className={`absolute left-0 ${popoverPos} z-50 hidden min-w-[260px] max-w-[360px] flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-2 text-left shadow-xl group-hover:flex group-focus-within:flex`}
      >
        <span className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        {sources.map((s, i) => {
          const color = kindColor(s.kind);
          const lbl = kindLabel(s.kind);
          const t = toDate(s.published_at);
          const time = t ? relativeTime(t) : null;
          return (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded border border-transparent px-1.5 py-1 hover:border-neutral-700 hover:bg-neutral-900"
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide ${color.text}`}
                >
                  {lbl}
                </span>
                {time && (
                  <span className="ml-auto text-[10px] text-neutral-500 tabular-nums">
                    {time}
                  </span>
                )}
              </span>
              {s.title && (
                <span className="mt-0.5 block truncate text-xs leading-snug text-neutral-200">
                  {s.title}
                </span>
              )}
              <span className="mt-0.5 block truncate text-[10px] text-neutral-500">
                {s.url}
              </span>
            </a>
          );
        })}
      </span>
    </span>
  );
}
