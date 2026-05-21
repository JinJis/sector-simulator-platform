import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  fetchMe,
  fetchMyPredictions,
  type PredictionRow,
} from "@/lib/sim-client";

import { PredictionRationale } from "../prediction-rationale";

export const dynamic = "force-dynamic";

export default async function MyPredictionsPage() {
  const user = await fetchMe();
  if (!user) {
    redirect("/login?redirect=/community/my-predictions");
  }
  let rows: PredictionRow[];
  try {
    rows = await fetchMyPredictions(100);
  } catch (err) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-neutral-50">내 예측 기록</h1>
        <p className="mt-4 text-sm text-red-400">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-6 pb-16 pt-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "커뮤니티", href: "/community" },
          { label: "내 예측 기록" },
        ]}
      />
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-50">내 예측 기록</h1>
        <Link
          href="/community/predict"
          className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-800/60"
        >
          + 새 예측
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          아직 등록된 예측이 없습니다.{" "}
          <Link href="/community/predict" className="text-cyan-400 hover:text-cyan-300">
            첫 예측 등록하기 →
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => {
            const positive = p.predicted_pct >= 0;
            const horizonKo =
              p.horizon === "1d" ? "1일" : p.horizon === "1w" ? "1주" : "1달";
            const flag = p.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            const targetIso = new Date(p.target_date).toISOString().slice(0, 10);
            return (
              <li
                key={p.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span aria-hidden>{flag}</span>
                  <Link
                    href={`/sectors/${p.equity.sector_slug}/equities/${encodeURIComponent(p.equity.ticker)}`}
                    className="font-mono text-sm font-semibold text-neutral-100 hover:text-cyan-300"
                  >
                    {p.equity.ticker}
                  </Link>
                  <span className="text-[11px] text-neutral-400">
                    {p.equity.company_name_local ?? p.equity.company_name}
                  </span>
                  <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">
                    {horizonKo}
                  </span>
                  <span
                    className={`ml-2 font-mono tabular-nums text-sm font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}
                  >
                    {positive ? "+" : ""}
                    {p.predicted_pct.toFixed(1)}%
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-500">
                    target {targetIso}
                  </span>
                </div>
                <PredictionRationale
                  rationale={p.rationale}
                  rationaleAnalysis={p.rationale_analysis}
                  scenario={p.scenario}
                  sectorSlug={p.equity.sector_slug}
                />
                <div className="mt-2 text-[10px] text-neutral-600">
                  {p.resolved && p.result
                    ? `채점 완료 · 점수 ${p.result.score.toFixed(0)} (실제 ${p.result.actual_pct >= 0 ? "+" : ""}${p.result.actual_pct.toFixed(1)}%, 오차 ${p.result.abs_error.toFixed(1)}pp)`
                    : `채점 대기 — 등록 후 ${horizonKo} 뒤에 자동 채점`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
