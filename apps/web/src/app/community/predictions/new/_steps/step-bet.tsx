"use client";

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n/provider";
import {
  quotePrediction,
  type PredictionQuoteResult,
} from "@/lib/prediction2-client";

import type { EquityChoice, Horizon } from "./types";

const HORIZONS: Horizon[] = ["1d", "1w", "1m"];
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
  const t = useT();
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
          {t("prediction.bet.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("prediction.bet.subheading")}
        </p>
      </header>

      <section>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          {t("prediction.bet.horizon")}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {HORIZONS.map((h) => {
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => onChange({ horizon: h })}
                className={`rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-cyan-600 bg-cyan-900/30 shadow-lg shadow-cyan-900/30"
                    : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
                }`}
              >
                <p className="text-base font-semibold text-neutral-100">
                  {t(`prediction.bet.horizon.${h}.label`)}
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {t(`prediction.bet.horizon.${h}.sub`)}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-wider">
          <span className="text-neutral-500">{t("prediction.bet.spread")}</span>
          <span className="font-mono text-neutral-300">
            ±{(spread_pct / 2).toFixed(1)}% · {spread_pct}%
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
          <span className="text-neutral-500">{t("prediction.bet.offset")}</span>
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
            {offset_pct}%
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
          {t("prediction.bet.offsetHint")}
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
  const t = useT();
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wider text-neutral-400">
          {t("prediction.bet.previewTitle")}
        </p>
        {loading && (
          <span className="flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            {t("prediction.bet.previewComputing")}
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
              {t("prediction.bet.previewMaxReward")}{" "}
              <span className="font-mono text-cyan-300">
                +{Math.round(quote.multiplier * 10)}p
              </span>
            </div>
            <div className="text-[11px] text-neutral-500">
              {t("prediction.bet.previewVol")}{" "}
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
          {t("prediction.bet.previewEmpty")}
        </p>
      ) : null}
      {anchor != null && expectedMin != null && expectedMax != null && (
        <p className="mt-3 border-t border-neutral-900 pt-2 text-[11px] text-neutral-400">
          {t("prediction.review.anchor")}{" "}
          <span className="font-mono text-neutral-200">
            {anchor.toFixed(2)}
          </span>{" "}
          →{" "}
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
