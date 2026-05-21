"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  createPrediction,
  fetchEquities,
  fetchEquityByTicker,
  fetchSims,
  type Equity,
  type SimMetadata,
} from "@/lib/sim-client";

type Horizon = "1d" | "1w" | "1m";

const HORIZON_LABEL: Record<Horizon, { label: string; hint: string }> = {
  "1d": { label: "1일 뒤", hint: "내일 종가" },
  "1w": { label: "1주 뒤", hint: "다음 주 종가" },
  "1m": { label: "1달 뒤", hint: "한 달 뒤 종가" },
};

interface Props {
  initialTicker: string | null;
  initialSectorSlug: string | null;
}

export function PredictForm({
  initialTicker,
  initialSectorSlug,
}: Props) {
  const router = useRouter();
  const [sims, setSims] = useState<SimMetadata[]>([]);
  const [sectorSlug, setSectorSlug] = useState<string>(initialSectorSlug ?? "");
  const [equities, setEquities] = useState<Equity[]>([]);
  const [equity, setEquity] = useState<Equity | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("1w");
  const [pct, setPct] = useState(2);
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1) Resolve sector list once.
  useEffect(() => {
    let cancelled = false;
    fetchSims()
      .then((s) => {
        if (cancelled) return;
        const userFacing = s.filter((x) => x.slug !== "placeholder");
        setSims(userFacing);
        if (!sectorSlug && userFacing.length > 0) {
          setSectorSlug(userFacing[0]!.slug);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // initial-load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Load equities when sector changes.
  useEffect(() => {
    if (!sectorSlug) return;
    let cancelled = false;
    setEquities([]);
    fetchEquities(sectorSlug)
      .then((eqs) => {
        if (cancelled) return;
        setEquities(eqs);
        // If we have an initialTicker requested via query, resolve it.
        if (initialTicker && !equity) {
          const match = eqs.find(
            (e) => e.ticker.toLowerCase() === initialTicker.toLowerCase(),
          );
          if (match) setEquity(match);
          else {
            void fetchEquityByTicker({
              sectorSlug,
              ticker: initialTicker,
            }).then((e) => {
              if (!cancelled) setEquity(e);
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sectorSlug, initialTicker, equity]);

  const anchor = equity?.last_close_local ?? null;
  const targetPrice = useMemo(() => {
    if (anchor === null || anchor === undefined) return null;
    return anchor * (1 + pct / 100);
  }, [anchor, pct]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!equity) {
      setError("종목을 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createPrediction({
        equity_id: equity.id,
        horizon,
        predicted_pct: pct,
        rationale: rationale.trim() || undefined,
      });
      router.push("/community");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
      setSubmitting(false);
    }
  }

  const positive = pct >= 0;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
    >
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          1. 어떤 섹터의 어떤 종목?
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select
            value={sectorSlug}
            onChange={(e) => {
              setSectorSlug(e.target.value);
              setEquity(null);
            }}
            className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
          >
            {sims.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={equity?.id ?? ""}
            onChange={(e) => {
              const next = equities.find((x) => x.id === e.target.value) ?? null;
              setEquity(next);
            }}
            disabled={equities.length === 0}
            className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none disabled:opacity-50"
          >
            <option value="">— 종목 선택 —</option>
            {equities.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.iso_country === "KR" ? "🇰🇷" : "🇺🇸"} {eq.ticker} ·{" "}
                {eq.company_name_local ?? eq.company_name}
              </option>
            ))}
          </select>
        </div>
        {equity && anchor !== null && (
          <p className="mt-2 text-[11px] text-neutral-500">
            현재 가격: <span className="font-mono text-neutral-200">{fmtPrice(anchor)}</span>{" "}
            {equity.currency ?? ""}
          </p>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          2. 언제까지의 변동을 예측?
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["1d", "1w", "1m"] as const).map((h) => {
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`rounded border px-3 py-2 text-left transition ${
                  active
                    ? "border-cyan-700 bg-cyan-950/40 text-cyan-200"
                    : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700"
                }`}
              >
                <div className="text-sm font-medium">{HORIZON_LABEL[h].label}</div>
                <div className="text-[10px] text-neutral-500">
                  {HORIZON_LABEL[h].hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          <span>3. 얼마나 움직일 것 같나요?</span>
          <span
            className={`text-base font-bold tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}
          >
            {positive ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        </label>
        <input
          type="range"
          min={-30}
          max={30}
          step={0.5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="mt-3 w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-neutral-600">
          <span>-30% 폭락</span>
          <span>기본 0%</span>
          <span>+30% 폭등</span>
        </div>
        {targetPrice !== null && equity && (
          <p className="mt-2 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-300">
            {HORIZON_LABEL[horizon].label} 예상 가격 ={" "}
            <span className={`font-mono font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
              {fmtPrice(targetPrice)} {equity.currency ?? ""}
            </span>
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="rationale"
          className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
        >
          4. 근거 (선택)
        </label>
        <textarea
          id="rationale"
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="예: 다음 주 실적 발표에서 HBM 출하량 가이드가 시장 컨센서스를 상회할 것이라 봅니다."
          className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-cyan-700 focus:outline-none"
        />
      </div>

      <div className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
        🏆 채점: {HORIZON_LABEL[horizon].label} 실제 가격이 발표되면 자동으로
        채점됩니다. 정확도가 높을수록 더 많은 포인트 (만점 100점) 를 받습니다.
        연속 적중 (50점 이상) 시 streak 보너스 적용 예정.
      </div>

      {error && (
        <p className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={submitting || !equity}
          className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "등록 중…" : "예측 등록"}
        </button>
      </div>
    </form>
  );
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
