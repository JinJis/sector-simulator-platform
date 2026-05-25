"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  placePrediction,
  quotePrediction,
  type PredictionQuoteResult,
} from "@/lib/prediction2-client";

type Horizon = "1d" | "1w" | "1m";

interface EquityChoice {
  id: string;
  ticker: string;
  exchange: string;
  company_name: string;
  last_close_local: number | null;
}

interface Props {
  sectorChoices: { slug: string; name: string }[];
  initialSector: string;
  initialEquityChoices: EquityChoice[];
  initialEquityId: string;
}

const HORIZON_LABELS: Record<Horizon, string> = {
  "1d": "1 day",
  "1w": "1 week",
  "1m": "1 month",
};

const QUICK_SPREADS = [2, 5, 10, 20]; // % total spread quick-pick chips

export function PlacePredictionForm({
  sectorChoices,
  initialSector,
  initialEquityChoices,
  initialEquityId,
}: Props) {
  const router = useRouter();
  const [sectorSlug, setSectorSlug] = useState(initialSector);
  const [equityChoices, setEquityChoices] =
    useState<EquityChoice[]>(initialEquityChoices);
  const [equityId, setEquityId] = useState(initialEquityId);
  const [horizon, setHorizon] = useState<Horizon>("1m");
  // Spread is captured as percent; min/max derive from anchor × spread.
  const [spreadPct, setSpreadPct] = useState<number>(5);
  // Optional directional offset — moves the midpoint by N% above (positive)
  // or below (negative) the anchor. 0 = neutral band.
  const [offsetPct, setOffsetPct] = useState<number>(0);
  const [rationale, setRationale] = useState("");
  const [quote, setQuote] = useState<PredictionQuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // When sector changes, reload its equities.
  useEffect(() => {
    if (!sectorSlug) {
      setEquityChoices([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sim/trpc/equity.listForSector?input=${encodeURIComponent(
            JSON.stringify({ sector_slug: sectorSlug }),
          )}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled) return;
        const list = (json?.result?.data ?? []) as EquityChoice[];
        setEquityChoices(list);
        if (list.length > 0 && !list.find((e) => e.id === equityId)) {
          setEquityId(list[0]?.id ?? "");
        }
      } catch {
        // Silent — keep prior list.
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude `equityId` from deps; selecting a new
    // equity shouldn't refetch the equity list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorSlug]);

  // Live-quote the tier whenever inputs change. Debounced to 200ms so
  // sliding through spread doesn't hammer the API.
  useEffect(() => {
    if (!equityId) {
      setQuote(null);
      return;
    }
    const chosen = equityChoices.find((e) => e.id === equityId);
    const anchor = chosen?.last_close_local;
    if (!anchor) {
      setQuote(null);
      return;
    }
    const mid = anchor * (1 + offsetPct / 100);
    const half = (mid * spreadPct) / 100 / 2;
    const min = Math.max(0.01, mid - half);
    const max = mid + half;
    if (max <= min) return;

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const t = setTimeout(() => {
      quotePrediction({
        equity_id: equityId,
        horizon,
        expected_price_min: min,
        expected_price_max: max,
      })
        .then((q) => {
          if (cancelled) return;
          setQuote(q);
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
  }, [equityId, equityChoices, horizon, spreadPct, offsetPct]);

  const chosen = equityChoices.find((e) => e.id === equityId);
  const anchor = chosen?.last_close_local ?? null;
  const mid = anchor ? anchor * (1 + offsetPct / 100) : null;
  const half = mid ? (mid * spreadPct) / 100 / 2 : null;
  const expectedMin = mid && half ? Math.max(0.01, mid - half) : null;
  const expectedMax = mid && half ? mid + half : null;

  const canSubmit =
    !!equityId && !!expectedMin && !!expectedMax && expectedMax > expectedMin;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || expectedMin === null || expectedMax === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const out = await placePrediction({
        equity_id: equityId,
        horizon,
        expected_price_min: expectedMin,
        expected_price_max: expectedMax,
        rationale: rationale.trim() || null,
      });
      router.push(`/community/predictions/${out.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Sector">
          <select
            value={sectorSlug}
            onChange={(e) => setSectorSlug(e.target.value)}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
          >
            {sectorChoices.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stock">
          <select
            value={equityId}
            onChange={(e) => setEquityId(e.target.value)}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
            disabled={equityChoices.length === 0}
          >
            {equityChoices.length === 0 && (
              <option value="">(no equities in this sector)</option>
            )}
            {equityChoices.map((e) => (
              <option key={e.id} value={e.id}>
                {e.ticker} — {e.company_name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Horizon">
        <div className="flex gap-2">
          {(["1d", "1w", "1m"] as Horizon[]).map((h) => {
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`flex-1 rounded border px-3 py-2 text-sm transition ${
                  active
                    ? "border-cyan-600 bg-cyan-900/40 text-cyan-100"
                    : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                }`}
              >
                {HORIZON_LABELS[h]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Band width (% spread)"
        hint={`Tight (±1%) → Hard. Wide (±10%) → Easy on low-vol names. Total = ${spreadPct}%`}
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={30}
            step={0.5}
            value={spreadPct}
            onChange={(e) => setSpreadPct(Number(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <span className="w-12 text-right font-mono text-sm text-neutral-200">
            {spreadPct}%
          </span>
        </div>
        <div className="mt-1 flex gap-1.5">
          {QUICK_SPREADS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpreadPct(s)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                spreadPct === s
                  ? "bg-cyan-900 text-cyan-100"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              ±{s / 2}%
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Directional offset"
        hint={`Move the midpoint by ${offsetPct}% from current price. 0 = neutral band around anchor.`}
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-20}
            max={20}
            step={0.5}
            value={offsetPct}
            onChange={(e) => setOffsetPct(Number(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <span
            className={`w-14 text-right font-mono text-sm ${
              offsetPct > 0
                ? "text-emerald-300"
                : offsetPct < 0
                  ? "text-rose-300"
                  : "text-neutral-400"
            }`}
          >
            {offsetPct > 0 ? "+" : ""}
            {offsetPct}%
          </span>
        </div>
      </Field>

      <Field label="Rationale (optional)">
        <textarea
          rows={3}
          maxLength={2000}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Quick note on why — earnings beat, supply chain news, technical setup, …"
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <QuotePreview
        quote={quote}
        loading={quoteLoading}
        error={quoteError}
        anchor={anchor}
        expectedMin={expectedMin}
        expectedMax={expectedMax}
      />

      {submitError && (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="rounded border border-cyan-700 bg-cyan-900/40 px-5 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Placing…" : "Place prediction →"}
        </button>
      </div>
    </form>
  );
}

function QuotePreview({
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
  if (error) {
    return (
      <p className="rounded border border-amber-900/60 bg-amber-950/40 p-2 text-[11px] text-amber-200">
        Tier preview failed: {error}
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Difficulty + Reward
        </p>
        {loading && (
          <span className="flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            computing…
          </span>
        )}
      </div>
      {quote ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-4">
          <TierBadge tier={quote.tier} />
          <div className="text-[12px] text-neutral-300">
            max reward{" "}
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
      ) : (
        <p className="mt-2 text-[11px] text-neutral-500">
          Pick a stock + horizon to see tier preview.
        </p>
      )}
      {quote && (
        <p className="mt-2 text-[11px] text-neutral-400">
          {quote.tier_explanation}
        </p>
      )}
      {anchor !== null && expectedMin !== null && expectedMax !== null && (
        <p className="mt-3 border-t border-neutral-900 pt-2 text-[11px] text-neutral-400">
          Anchor{" "}
          <span className="font-mono text-neutral-200">{anchor.toFixed(2)}</span>{" "}
          → band{" "}
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[10px] text-neutral-600">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
