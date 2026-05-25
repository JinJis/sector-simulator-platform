"use client";

import { useEffect, useState } from "react";

import {
  quotePrediction,
  type PredictionQuoteResult,
} from "@/lib/prediction2-client";

import type { EquityChoice, Horizon } from "./types";

const HORIZON_CARDS: Array<{ value: Horizon; label: string; subtitle: string }> = [
  { value: "1d", label: "1 day", subtitle: "내일 종가 기준 (Hard)" },
  { value: "1w", label: "1 week", subtitle: "7일 안에" },
  { value: "1m", label: "1 month", subtitle: "30일 안에" },
];

const QUICK_SPREADS = [2, 5, 10, 20];

interface Props {
  equity: EquityChoice;
  horizon: Horizon;
  spread_pct: number;
  offset_pct: number;
  onChange: (patch: {
    horizon?: Horizon;
    spread_pct?: number;
    offset_pct?: number;
  }) => void;
  onQuote: (quote: PredictionQuoteResult | null) => void;
}

export function StepBet({
  equity,
  horizon,
  spread_pct,
  offset_pct,
  onChange,
  onQuote,
}: Props) {
  const [quote, setQuote] = useState<PredictionQuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const anchor = equity.last_close_local;
  const mid = anchor != null ? anchor * (1 + offset_pct / 100) : null;
  const half = mid != null ? (mid * spread_pct) / 100 / 2 : null;
  const expectedMin =
    mid != null && half != null ? Math.max(0.01, mid - half) : null;
  const expectedMax = mid != null && half != null ? mid + half : null;

  // Debounced tier preview on input change.
  useEffect(() => {
    if (expectedMin == null || expectedMax == null || expectedMax <= expectedMin) {
      setQuote(null);
      onQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const t = setTimeout(() => {
      quotePrediction({
        equity_id: equity.id,
        horizon,
        expected_price_min: expectedMin,
        expected_price_max: expectedMax,
      })
        .then((q) => {
          if (cancelled) return;
          setQuote(q);
          onQuote(q);
          setQuoteLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setQuoteError(e instanceof Error ? e.message : String(e));
          setQuoteLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // We intentionally exclude onQuote from deps — it's a stable
    // callback the parent sets once. Re-fetching on every render
    // would create a request storm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equity.id, horizon, spread_pct, offset_pct, expectedMin, expectedMax]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          베팅 조건을 정하세요
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          기간 + 가격 밴드를 설정하면 난이도(Easy / Medium / Hard)가 자동
          산정되고 예상 보상도 미리 보입니다.
        </p>
      </header>

      <section>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          기간
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {HORIZON_CARDS.map((h) => {
            const active = horizon === h.value;
            return (
              <button
                key={h.value}
                type="button"
                onClick={() => onChange({ horizon: h.value })}
                className={`rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-cyan-600 bg-cyan-900/30 shadow-lg shadow-cyan-900/30"
                    : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
                }`}
              >
                <p className="text-base font-semibold text-neutral-100">
                  {h.label}
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {h.subtitle}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wider">
          <span className="text-neutral-500">밴드 폭</span>
          <span className="font-mono text-neutral-300">
            ±{(spread_pct / 2).toFixed(1)}% (총 {spread_pct}%)
          </span>
        </p>
        <input
          type="range"
          min={1}
          max={30}
          step={0.5}
          value={spread_pct}
          onChange={(e) =>
            onChange({ spread_pct: Number(e.target.value) })
          }
          className="w-full accent-cyan-400"
        />
        <div className="mt-2 flex gap-1.5">
          {QUICK_SPREADS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ spread_pct: s })}
              className={`rounded px-2 py-0.5 text-[10px] ${
                spread_pct === s
                  ? "bg-cyan-900 text-cyan-100"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              ±{s / 2}%
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wider">
          <span className="text-neutral-500">방향성 (offset)</span>
          <span
            className={`font-mono ${
              offset_pct > 0
                ? "text-emerald-400"
                : offset_pct < 0
                  ? "text-rose-400"
                  : "text-neutral-400"
            }`}
          >
            {offset_pct > 0 ? "+" : ""}
            {offset_pct}% 중심
          </span>
        </p>
        <input
          type="range"
          min={-20}
          max={20}
          step={0.5}
          value={offset_pct}
          onChange={(e) =>
            onChange({ offset_pct: Number(e.target.value) })
          }
          className="w-full accent-cyan-400"
        />
        <p className="mt-1 text-[10px] text-neutral-600">
          0% = 현재가 주변. + 값은 상승 예측, − 값은 하락 예측.
        </p>
      </section>

      <TierPreview
        quote={quote}
        loading={quoteLoading}
        error={quoteError}
        anchor={anchor ?? null}
        expectedMin={expectedMin}
        expectedMax={expectedMax}
      />
    </div>
  );
}

function TierPreview({
  quote,
  loading,
  error,
  anchor,
  expectedMin,
  expectedMax,
}: {
  quote: PredictionQuoteResult | null;
  loading: boolean;
  error: string | null;
  anchor: number | null;
  expectedMin: number | null;
  expectedMax: number | null;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wider text-neutral-400">
          난이도 + 보상 미리보기
        </p>
        {loading && (
          <span className="flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            computing…
          </span>
        )}
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-rose-400">{error}</p>
      )}
      {quote ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-4">
            <TierBadge tier={quote.tier} />
            <div className="text-[13px] text-neutral-300">
              max{" "}
              <span className="font-mono text-cyan-300">
                +{Math.round(quote.multiplier * 10)}p
              </span>
            </div>
            <div className="text-[11px] text-neutral-500">
              σ{" "}
              {quote.annualized_vol_pct === null
                ? "—"
                : `${quote.annualized_vol_pct.toFixed(0)}%/yr`}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            {quote.tier_explanation}
          </p>
        </>
      ) : !loading && !error ? (
        <p className="mt-2 text-[11px] text-neutral-500">
          밴드를 조정해주세요.
        </p>
      ) : null}
      {anchor != null && expectedMin != null && expectedMax != null && (
        <p className="mt-3 border-t border-neutral-900 pt-2 text-[11px] text-neutral-400">
          Anchor{" "}
          <span className="font-mono text-neutral-200">
            {anchor.toFixed(2)}
          </span>{" "}
          → 밴드{" "}
          <span className="font-mono text-cyan-300">
            {expectedMin.toFixed(2)}
          </span>
          –
          <span className="font-mono text-cyan-300">
            {expectedMax.toFixed(2)}
          </span>
        </p>
      )}
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
