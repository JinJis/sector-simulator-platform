"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  placePrediction,
  type PredictionQuoteResult,
} from "@/lib/prediction2-client";
import { WizardProgress, type WizardStep } from "@/lib/wizard/progress";

import { StepBet } from "./_steps/step-bet";
import { StepReview } from "./_steps/step-review";
import { StepStock, type SectorChoice } from "./_steps/step-stock";
import { EMPTY_PREDICTION, type EquityChoice, type PredictionDraft } from "./_steps/types";

const STEPS: WizardStep[] = [
  { id: 1, label: "Stock" },
  { id: 2, label: "Bet" },
  { id: 3, label: "Review" },
];

interface Props {
  sectorChoices: SectorChoice[];
  initialSector: string;
  initialEquityChoices: EquityChoice[];
  initialEquityId: string;
}

export function PredictionWizard({
  sectorChoices,
  initialSector,
  initialEquityChoices,
  initialEquityId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [equityChoices, setEquityChoices] = useState<EquityChoice[]>(
    initialEquityChoices,
  );
  const [draft, setDraft] = useState<PredictionDraft>({
    ...EMPTY_PREDICTION,
    sector_slug: initialSector,
    equity_id: initialEquityId,
  });
  const [quote, setQuote] = useState<PredictionQuoteResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh equity list when sector changes.
  useEffect(() => {
    if (!draft.sector_slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sim/trpc/equity.listForSector?input=${encodeURIComponent(
            JSON.stringify({ sector_slug: draft.sector_slug }),
          )}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled) return;
        const list = (json?.result?.data ?? []) as EquityChoice[];
        setEquityChoices(list);
        if (list.length > 0 && !list.find((e) => e.id === draft.equity_id)) {
          setDraft((prev) => ({ ...prev, equity_id: list[0]?.id ?? "" }));
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.sector_slug]);

  const equity = equityChoices.find((e) => e.id === draft.equity_id);
  const anchor = equity?.last_close_local ?? null;
  const mid = anchor != null ? anchor * (1 + draft.offset_pct / 100) : null;
  const half = mid != null ? (mid * draft.spread_pct) / 100 / 2 : null;
  const expectedMin =
    mid != null && half != null ? Math.max(0.01, mid - half) : null;
  const expectedMax = mid != null && half != null ? mid + half : null;

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return !!equity && equity.last_close_local != null;
      case 2:
        return (
          expectedMin != null && expectedMax != null && expectedMax > expectedMin
        );
      case 3:
        return true;
      default:
        return false;
    }
  })();

  async function handleSubmit() {
    if (!equity || expectedMin == null || expectedMax == null) return;
    setError(null);
    setSubmitting(true);
    try {
      const out = await placePrediction({
        equity_id: equity.id,
        horizon: draft.horizon,
        expected_price_min: expectedMin,
        expected_price_max: expectedMax,
        rationale: draft.rationale.trim() || null,
      });
      router.push(`/community/predictions/${out.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <WizardProgress
        steps={STEPS}
        currentStep={step}
        onJump={(s) => s < step && setStep(s)}
      />

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
        {step === 1 && (
          <StepStock
            sectorChoices={sectorChoices}
            sectorSlug={draft.sector_slug}
            equityChoices={equityChoices}
            equityId={draft.equity_id}
            onPickSector={(slug) =>
              setDraft({ ...draft, sector_slug: slug, equity_id: "" })
            }
            onPickEquity={(id) => setDraft({ ...draft, equity_id: id })}
          />
        )}
        {step === 2 && equity && (
          <StepBet
            equity={equity}
            horizon={draft.horizon}
            spread_pct={draft.spread_pct}
            offset_pct={draft.offset_pct}
            onChange={(p) => setDraft({ ...draft, ...p })}
            onQuote={setQuote}
          />
        )}
        {step === 3 && equity && expectedMin != null && expectedMax != null && (
          <StepReview
            equity={equity}
            horizon={draft.horizon}
            expectedMin={expectedMin}
            expectedMax={expectedMax}
            quote={quote}
            rationale={draft.rationale}
            onChangeRationale={(s) => setDraft({ ...draft, rationale: s })}
          />
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] text-rose-300">
          {error}
        </p>
      )}

      <nav className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 이전
        </button>
        <p className="text-[10px] text-neutral-500">
          Step {step} / {STEPS.length}
        </p>
        {step < STEPS.length ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
            disabled={!canAdvance}
            className="rounded-lg border border-cyan-700 bg-cyan-900/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음 →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg border border-emerald-600 bg-emerald-800 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {submitting ? "Placing…" : "🎯 베팅 등록 →"}
          </button>
        )}
      </nav>
    </div>
  );
}
