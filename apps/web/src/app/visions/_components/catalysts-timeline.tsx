"use client";

import { useMemo, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { SourceList } from "@platform/ui";

import type { Catalyst } from "../_types";

const SIDE_TONE: Record<Catalyst["side"], string> = {
  bull: "border-emerald-700/50 bg-emerald-950/30 text-emerald-200",
  bear: "border-rose-700/50 bg-rose-950/30 text-rose-200",
  neutral: "border-neutral-700 bg-neutral-900 text-neutral-300",
};

const SIDE_DOT: Record<Catalyst["side"], string> = {
  bull: "bg-emerald-500",
  bear: "bg-rose-500",
  neutral: "bg-neutral-500",
};

const SIDE_LABEL_KO: Record<Catalyst["side"], string> = {
  bull: "Bull",
  bear: "Bear",
  neutral: "양방향",
};

const SIDE_LABEL_EN: Record<Catalyst["side"], string> = {
  bull: "Bull",
  bear: "Bear",
  neutral: "Either way",
};

function daysFromNow(iso: string): number {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return 0;
  return Math.round((target - Date.now()) / 86_400_000);
}

type RangeKey = "latest" | "1m" | "3m" | "6m" | "1y";

interface RangeDef {
  key: RangeKey;
  label_ko: string;
  label_en: string;
  /** True if the catalyst should be visible under this range. */
  match: (days: number) => boolean;
}

const RANGES: RangeDef[] = [
  {
    key: "latest",
    label_ko: "최신",
    label_en: "Latest",
    // Upcoming + the last 7 days — the "what's happening right now" view.
    match: (d) => d >= -7,
  },
  {
    key: "1m",
    label_ko: "1개월",
    label_en: "1m",
    match: (d) => Math.abs(d) <= 30,
  },
  {
    key: "3m",
    label_ko: "3개월",
    label_en: "3m",
    match: (d) => Math.abs(d) <= 90,
  },
  {
    key: "6m",
    label_ko: "6개월",
    label_en: "6m",
    match: (d) => Math.abs(d) <= 180,
  },
  {
    key: "1y",
    label_ko: "1년",
    label_en: "1y",
    match: (d) => Math.abs(d) <= 365,
  },
];

interface Props {
  catalysts: Catalyst[] | null | undefined;
  locale: "ko" | "en";
  /** Initial range selection. Default "6m" matches the prior fixed view. */
  defaultRange?: RangeKey;
}

/**
 * Forward-looking event track — segmented control filters by time
 * window relative to today (Latest · 1m · 3m · 6m · 1y). Refresh
 * triggers `router.refresh()` so the parent RSC re-fetches; while the
 * fixture path is static today, the same component lights up once M50
 * lands the bot-pushed catalysts and `vision.getOverview` returns live
 * data.
 *
 * Empty-state collapses gracefully so visions without curated
 * catalysts still get a thin "no upcoming catalysts" stub.
 */
export function CatalystsTimeline({
  catalysts,
  locale,
  defaultRange = "6m",
}: Props) {
  const t = (ko: string, en: string) => (locale === "ko" ? ko : en);
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  // Sort ascending so the timeline reads top-to-bottom in chronological
  // order even after filtering.
  const sorted = useMemo(
    () =>
      (catalysts ?? [])
        .slice()
        .sort((a, b) => (a.expected_at < b.expected_at ? -1 : 1)),
    [catalysts],
  );

  const rangeDef = RANGES.find((r) => r.key === range) ?? RANGES[3]!;
  const filtered = sorted.filter((c) =>
    rangeDef.match(daysFromNow(c.expected_at)),
  );

  if (!catalysts || catalysts.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-5 py-5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("향후 catalysts", "Catalysts ahead")}
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          {t(
            "예정된 catalyst 가 정리되어 있지 않습니다.",
            "No upcoming catalysts curated for this vision yet.",
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("향후 catalysts", "Catalysts ahead")}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-600">
            {t(
              `${filtered.length} / 총 ${sorted.length}건`,
              `${filtered.length} of ${sorted.length}`,
            )}
          </span>
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={isRefreshing}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-800 bg-neutral-900/60 text-neutral-400 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
            aria-label={t("새로고침", "Refresh")}
            title={t("새로고침", "Refresh")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label={t("기간 필터", "Time range")}
        className="mb-4 inline-flex rounded-md border border-neutral-800 bg-neutral-900/40 p-0.5"
      >
        {RANGES.map((r) => {
          const active = r.key === range;
          return (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setRange(r.key)}
              className={`rounded px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                active
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {locale === "ko" ? r.label_ko : r.label_en}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 text-xs text-neutral-500">
          {t(
            "선택한 기간 내 catalyst 가 없습니다.",
            "No catalysts in the selected window.",
          )}
        </p>
      ) : (
        <ol className="relative space-y-3 border-l border-neutral-800 pl-5">
          {filtered.map((c) => {
            const days = daysFromNow(c.expected_at);
            const dateFmt = new Date(c.expected_at).toLocaleDateString(
              locale === "ko" ? "ko-KR" : "en-US",
              { year: "numeric", month: "short", day: "numeric" },
            );
            const hasSources = c.sources && c.sources.length > 0;
            return (
              <li key={c.id} className="relative">
                <span
                  className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-neutral-950 ${SIDE_DOT[c.side]}`}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono tabular-nums text-neutral-300">
                    {dateFmt}
                  </span>
                  <span className="text-[10px] text-neutral-600">
                    {days >= 0
                      ? `D-${days}`
                      : t(`${Math.abs(days)}일 전`, `${Math.abs(days)}d ago`)}
                  </span>
                  <span
                    className={`ml-auto rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${SIDE_TONE[c.side]}`}
                  >
                    {locale === "ko"
                      ? SIDE_LABEL_KO[c.side]
                      : SIDE_LABEL_EN[c.side]}
                  </span>
                  {c.capability_key && (
                    <span className="font-mono text-[10px] text-neutral-500">
                      {c.capability_key}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm font-medium text-neutral-100">
                  {c.source_url && !hasSources ? (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-cyan-300"
                    >
                      {c.label}
                    </a>
                  ) : (
                    <span>{c.label}</span>
                  )}
                  {hasSources && <SourceList sources={c.sources!} />}
                </div>
                {c.note && (
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
                    {c.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
