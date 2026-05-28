import { SourceList } from "@platform/ui";

import type {
  InvestmentThesis,
  ThesisBullet,
  ThesisBulletInput,
} from "../_types";

const CONVICTION_TONE: Record<InvestmentThesis["conviction"], string> = {
  high: "border-emerald-700/60 bg-emerald-950/40 text-emerald-200",
  medium: "border-cyan-700/60 bg-cyan-950/40 text-cyan-200",
  low: "border-amber-700/60 bg-amber-950/40 text-amber-200",
  exploratory: "border-neutral-700 bg-neutral-900 text-neutral-300",
};

const CONVICTION_LABEL_EN: Record<InvestmentThesis["conviction"], string> = {
  high: "High conviction",
  medium: "Medium conviction",
  low: "Low conviction",
  exploratory: "Exploratory",
};

const CONVICTION_LABEL_KO: Record<InvestmentThesis["conviction"], string> = {
  high: "확신 높음",
  medium: "확신 중간",
  low: "확신 낮음",
  exploratory: "탐색적",
};

interface Props {
  thesis: InvestmentThesis | null | undefined;
  locale: "ko" | "en";
}

/**
 * Investor-facing thesis card — sits at the top of Overview, just below
 * the gauge. Three blocks: the bet (one line), bull case (2-4 bullets),
 * bear case (2-4 bullets). Conviction pill colours the border + a
 * "last reviewed" footnote keeps the editorial signal honest.
 *
 * MP2: each bullet can carry `sources[]`. When non-empty, a `SourceList`
 * chip renders inline; hover lists the supporting URLs, click opens the
 * actual source. Plain-string bullets (legacy) render unchanged.
 *
 * When the fixture doesn't carry a thesis yet, renders an empty-state
 * card pointing at the raw data tabs rather than disappearing.
 */
export function InvestmentThesisPanel({ thesis, locale }: Props) {
  const t = (ko: string, en: string) => (locale === "ko" ? ko : en);

  if (!thesis) {
    return (
      <section className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-5 py-6">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("투자 thesis", "Investment thesis")}
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          {t(
            "이 비전의 투자 thesis는 아직 정리되지 않았습니다.",
            "No investment thesis curated for this vision yet.",
          )}
        </p>
        <p className="mt-1 text-[11px] text-neutral-500">
          {t(
            "원자료 (capabilities · actors · risks · economics) 는 위 탭에서 직접 확인할 수 있습니다.",
            "The raw data (capabilities · actors · risks · economics) is available in the tabs above.",
          )}
        </p>
      </section>
    );
  }

  const reviewedFmt = new Date(thesis.last_reviewed).toLocaleDateString(
    locale === "ko" ? "ko-KR" : "en-US",
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-5 py-5 shadow-lg">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("투자 thesis", "Investment thesis")}
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${CONVICTION_TONE[thesis.conviction]}`}
        >
          {locale === "ko"
            ? CONVICTION_LABEL_KO[thesis.conviction]
            : CONVICTION_LABEL_EN[thesis.conviction]}
        </span>
      </header>

      <p className="mb-5 text-base leading-relaxed text-neutral-100">
        <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {t("THE BET", "THE BET")}
        </span>
        {thesis.the_bet}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <ThesisColumn
          tone="bull"
          title={t("Bull case (잘 풀리면)", "Bull case (if it works)")}
          bullets={thesis.bull_case}
        />
        <ThesisColumn
          tone="bear"
          title={t("Bear case (틀리면)", "Bear case (if we're wrong)")}
          bullets={thesis.bear_case}
        />
      </div>

      <p className="mt-5 text-[10px] text-neutral-600">
        {t("최근 리뷰", "Last reviewed")}: {reviewedFmt}
        <span className="ml-2 text-neutral-700">·</span>
        <span className="ml-2 italic">
          {t(
            "에디토리얼 콘텐츠 — capabilities · actors · risks · economics 로부터 사람이 정리",
            "Editorial — curated from capabilities · actors · risks · economics by a human reviewer",
          )}
        </span>
      </p>
    </section>
  );
}

function normalize(b: ThesisBulletInput): ThesisBullet {
  return typeof b === "string" ? { text: b } : b;
}

function ThesisColumn({
  tone,
  title,
  bullets,
}: {
  tone: "bull" | "bear";
  title: string;
  bullets: ThesisBulletInput[];
}) {
  const accent =
    tone === "bull"
      ? "border-emerald-900/50 bg-emerald-950/20"
      : "border-rose-900/50 bg-rose-950/20";
  const dot = tone === "bull" ? "bg-emerald-500" : "bg-rose-500";

  return (
    <div className={`rounded-xl border ${accent} px-4 py-3`}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
        {title}
      </div>
      <ul className="flex flex-col gap-2">
        {bullets.map((raw, i) => {
          const b = normalize(raw);
          const hasSources = b.sources && b.sources.length > 0;
          return (
            <li
              key={i}
              className="flex gap-2 text-[13px] leading-relaxed text-neutral-200"
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
              />
              <span className="min-w-0 flex-1">
                {b.text}
                {hasSources && (
                  <span className="ml-1.5 inline-flex align-middle">
                    <SourceList sources={b.sources!} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
