import { Breadcrumbs } from "@platform/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchPrediction, type PredictionRow } from "@/lib/sim-client";

import { PredictionRationale } from "../../community/prediction-rationale";
import { SharePermalinkButton } from "./share-button";

// Forced dynamic — the resolution state of a prediction changes when
// the data-pipeline cron runs, and we want the latest score the moment
// it lands. Cache shouldn't hold a "채점 대기" view past resolution.
export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { id } = await params;
  const row = await safeFetch(id);
  if (!row) {
    return { title: "예측을 찾을 수 없습니다 — Sector Simulator" };
  }
  const sign = row.predicted_pct >= 0 ? "+" : "";
  const horizonKo =
    row.horizon === "1d" ? "1일" : row.horizon === "1w" ? "1주" : "1달";
  const status = row.resolved && row.result
    ? `채점 완료 · ${row.result.score.toFixed(0)}점`
    : "채점 대기 중";
  const title = `${row.equity.ticker} ${horizonKo} ${sign}${row.predicted_pct.toFixed(1)}% — ${row.user_label}의 예측`;
  const description = `${row.equity.company_name_local ?? row.equity.company_name} · ${status}`;
  return {
    title: `${title} — Sector Simulator`,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
  };
}

// Used by both `generateMetadata` and the page render so we only hit
// the API once per request when Next.js dedupes.
async function safeFetch(id: string): Promise<PredictionRow | null> {
  try {
    return await fetchPrediction(id);
  } catch {
    return null;
  }
}

export default async function PredictionPermalinkPage({ params }: RouteProps) {
  const { id } = await params;
  const p = await fetchPrediction(id);
  if (!p) {
    notFound();
  }

  const positive = p.predicted_pct >= 0;
  const horizonKo =
    p.horizon === "1d" ? "1일" : p.horizon === "1w" ? "1주" : "1달";
  const flag = p.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
  const anchorIso = new Date(p.anchor_at).toISOString().slice(0, 10);
  const targetIso = new Date(p.target_date).toISOString().slice(0, 10);

  // Resolution state — three buckets: not yet due, due but no price
  // yet (cron hasn't seen quote data), or resolved with a score.
  const dueAt = new Date(p.target_date).getTime();
  const isPastDue = dueAt <= Date.now();
  const isResolved = p.resolved && p.result != null;

  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "커뮤니티", href: "/community" },
          { label: "예측" },
        ]}
      />

      <header className="mb-4">
        <h1 className="text-2xl font-semibold leading-tight text-neutral-50">
          <span aria-hidden className="mr-2">
            {flag}
          </span>
          <Link
            href={`/sectors/${p.equity.sector_slug}/equities/${encodeURIComponent(p.equity.ticker)}`}
            className="font-mono hover:text-cyan-300"
          >
            {p.equity.ticker}
          </Link>{" "}
          <span className="text-neutral-400">{horizonKo}</span>{" "}
          <span
            className={`font-mono tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}
          >
            {positive ? "+" : ""}
            {p.predicted_pct.toFixed(1)}%
          </span>
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          {p.equity.company_name_local ?? p.equity.company_name} ·{" "}
          <Link
            href={`/sectors/${p.equity.sector_slug}`}
            className="text-cyan-400 hover:text-cyan-300"
          >
            {p.equity.sector_slug}
          </Link>
        </p>
      </header>

      <section className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="grid grid-cols-3 gap-3 text-[12px]">
          <Stat label="등록일" value={anchorIso} />
          <Stat label="목표일" value={targetIso} />
          <Stat label="예측자" value={p.user_label} />
          <Stat
            label="기준가"
            value={`${p.anchor_close.toLocaleString()} ${p.equity.currency ?? ""}`}
            mono
          />
          <Stat
            label="예측가"
            value={`${p.predicted_close.toLocaleString()} ${p.equity.currency ?? ""}`}
            mono
          />
          <Stat
            label="예측 변동"
            value={`${positive ? "+" : ""}${p.predicted_pct.toFixed(1)}%`}
            mono
            tone={positive ? "emerald" : "rose"}
          />
        </div>
      </section>

      {/* Resolution card. Three states: resolved | overdue-no-price | pending. */}
      {isResolved && p.result ? (
        <ResolvedCard prediction={p} />
      ) : isPastDue ? (
        <PendingCard tone="overdue" horizonKo={horizonKo} targetIso={targetIso} />
      ) : (
        <PendingCard tone="upcoming" horizonKo={horizonKo} targetIso={targetIso} />
      )}

      <section className="mt-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          예측 근거
        </p>
        <PredictionRationale
          rationale={p.rationale}
          rationaleAnalysis={p.rationale_analysis}
          scenario={p.scenario}
          sectorSlug={p.equity.sector_slug}
          defaultExpanded
        />
        {!p.rationale && !p.rationale_analysis && !p.scenario && (
          <p className="rounded border border-dashed border-neutral-800 p-3 text-[11px] text-neutral-500">
            이 예측에는 근거가 첨부되지 않았습니다.
          </p>
        )}
      </section>

      <footer className="mt-6 flex flex-col gap-3 border-t border-neutral-900 pt-4 text-[12px] sm:flex-row sm:items-center sm:justify-between">
        <SharePermalinkButton predictionId={p.id} />
        <Link
          href="/community/predict"
          className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-center text-xs font-medium text-cyan-200 hover:bg-cyan-800/60"
        >
          나도 예측 등록하기 →
        </Link>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "emerald" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "rose"
        ? "text-rose-400"
        : "text-neutral-100";
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-0.5 ${mono ? "font-mono tabular-nums" : ""} ${toneClass}`}
      >
        {value}
      </p>
    </div>
  );
}

function ResolvedCard({ prediction }: { prediction: PredictionRow }) {
  const r = prediction.result!;
  const hit = r.score >= 50;
  const actualPositive = r.actual_pct >= 0;
  return (
    <section
      className={`rounded-lg border p-4 ${hit ? "border-emerald-800/80 bg-emerald-950/30" : "border-rose-900/60 bg-rose-950/20"}`}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${hit ? "bg-emerald-700 text-emerald-50" : "bg-rose-800 text-rose-100"}`}
        >
          {hit ? "적중" : "빗나감"}
        </span>
        <span className="font-mono text-3xl font-bold tabular-nums text-neutral-50">
          {r.score.toFixed(0)}
        </span>
        <span className="text-[11px] text-neutral-400">/ 100</span>
        <span className="ml-auto text-[10px] text-neutral-500">
          채점 {new Date(r.resolved_at).toISOString().slice(0, 10)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
        <Stat
          label="실제 변동"
          value={`${actualPositive ? "+" : ""}${r.actual_pct.toFixed(1)}%`}
          mono
          tone={actualPositive ? "emerald" : "rose"}
        />
        <Stat
          label="실제 종가"
          value={`${r.actual_close.toLocaleString()} ${prediction.equity.currency ?? ""}`}
          mono
        />
        <Stat label="오차" value={`${r.abs_error.toFixed(1)}pp`} mono />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-neutral-500">
        점수 = max(0, 100 − 오차 × 5). 오차 0pp = 100점, 10pp = 50점, 20pp 이상 = 0점.
        50점 이상이면 적중.
      </p>
    </section>
  );
}

function PendingCard({
  tone,
  horizonKo,
  targetIso,
}: {
  tone: "upcoming" | "overdue";
  horizonKo: string;
  targetIso: string;
}) {
  if (tone === "upcoming") {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <p className="text-sm text-neutral-300">
          <span className="font-mono text-cyan-400">{targetIso}</span> 까지 대기
          중 — 목표일({horizonKo}) 이후 자동 채점됩니다.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4">
      <p className="text-sm text-amber-200">
        목표일({targetIso})은 지났지만 아직 시세 데이터가 적재되지 않아 채점
        대기 중입니다. 다음 데이터 갱신 후 자동으로 채점됩니다.
      </p>
    </section>
  );
}
