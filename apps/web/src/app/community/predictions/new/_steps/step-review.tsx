"use client";

import type { PredictionQuoteResult } from "@/lib/prediction2-client";

import type { EquityChoice, Horizon } from "./types";

interface Props {
  equity: EquityChoice;
  horizon: Horizon;
  expectedMin: number;
  expectedMax: number;
  quote: PredictionQuoteResult | null;
  rationale: string;
  onChangeRationale: (s: string) => void;
}

export function StepReview({
  equity,
  horizon,
  expectedMin,
  expectedMax,
  quote,
  rationale,
  onChangeRationale,
}: Props) {
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          확인 후 베팅을 등록하세요
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          한 번 등록한 베팅은 마감일까지 수정/취소되지 않습니다.
        </p>
      </header>

      <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-100">
              {equity.company_name}
            </p>
            <p className="font-mono text-[11px] text-neutral-500">
              {equity.ticker} · {equity.exchange}
            </p>
          </div>
          {quote && <TierBadge tier={quote.tier} />}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <Stat label="Horizon" value={horizon} />
          <Stat
            label="Anchor"
            value={equity.last_close_local?.toFixed(2) ?? "—"}
          />
          <Stat label="Band min" value={expectedMin.toFixed(2)} accent="cyan" />
          <Stat label="Band max" value={expectedMax.toFixed(2)} accent="cyan" />
          {quote && (
            <Stat
              label="Max reward"
              value={`+${Math.round(quote.multiplier * 10)}p`}
              accent="emerald"
            />
          )}
          {quote && quote.annualized_vol_pct != null && (
            <Stat
              label="σ /yr"
              value={`${quote.annualized_vol_pct.toFixed(0)}%`}
            />
          )}
        </dl>
        {quote && (
          <p className="mt-3 border-t border-emerald-900/30 pt-3 text-[11px] text-neutral-400">
            {quote.tier_explanation}
          </p>
        )}
      </section>

      <section>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          근거 (선택)
        </label>
        <p className="mt-0.5 text-[10px] text-neutral-600">
          왜 이 베팅이 합리적인지 한두 줄 — earnings 발표, 가격 setup, 뉴스 등.
        </p>
        <textarea
          rows={3}
          maxLength={2000}
          value={rationale}
          onChange={(e) => onChangeRationale(e.target.value)}
          placeholder="예: TSMC 11월 매출 가이드 상향 + 차세대 노드 양산. 7일 이내 +5% 가능."
          className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "cyan" | "emerald";
}) {
  const cls =
    accent === "cyan"
      ? "text-cyan-300"
      : accent === "emerald"
        ? "text-emerald-300"
        : "text-neutral-200";
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${cls}`}>
        {value}
      </dd>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === "hard"
      ? "border-rose-700 text-rose-200 bg-rose-950/40"
      : tier === "medium"
        ? "border-amber-700 text-amber-200 bg-amber-950/40"
        : "border-emerald-700 text-emerald-200 bg-emerald-950/40";
  const emoji = tier === "hard" ? "🔴" : tier === "medium" ? "🟡" : "🟢";
  return (
    <span
      className={`rounded border px-2 py-1 text-[12px] font-medium uppercase tracking-wider ${cls}`}
    >
      {emoji} {tier}
    </span>
  );
}
