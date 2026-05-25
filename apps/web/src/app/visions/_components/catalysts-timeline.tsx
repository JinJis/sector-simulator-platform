import type { Catalyst } from "../_fixtures";

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

interface Props {
  catalysts: Catalyst[] | null | undefined;
  locale: "ko" | "en";
}

/**
 * Forward-looking event track — 6-month horizon. Sorted by
 * `expected_at`. Each catalyst chip carries side (bull / bear /
 * neutral), capability impacted, and an optional analyst note.
 *
 * Empty-state collapses gracefully so visions without curated
 * catalysts still get a thin "no upcoming catalysts" stub instead
 * of an empty section.
 */
export function CatalystsTimeline({ catalysts, locale }: Props) {
  const t = (ko: string, en: string) => (locale === "ko" ? ko : en);

  if (!catalysts || catalysts.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-5 py-5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("향후 6개월 catalysts", "Catalysts ahead (6mo)")}
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

  // Sort ascending by expected_at; client view can later flip to past/future split.
  const sorted = [...catalysts].sort((a, b) =>
    a.expected_at < b.expected_at ? -1 : 1,
  );

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("향후 6개월 catalysts", "Catalysts ahead (6mo)")}
        </div>
        <span className="text-[10px] text-neutral-600">
          {t(`총 ${sorted.length}건`, `${sorted.length} events`)}
        </span>
      </header>

      <ol className="relative space-y-3 border-l border-neutral-800 pl-5">
        {sorted.map((c) => {
          const days = daysFromNow(c.expected_at);
          const dateFmt = new Date(c.expected_at).toLocaleDateString(
            locale === "ko" ? "ko-KR" : "en-US",
            { year: "numeric", month: "short", day: "numeric" },
          );
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
              <div className="mt-1 text-sm font-medium text-neutral-100">
                {c.source_url ? (
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyan-300"
                  >
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
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
    </section>
  );
}
