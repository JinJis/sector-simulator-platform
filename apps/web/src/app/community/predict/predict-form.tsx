"use client";

/**
 * M33 predict form rework.
 *
 * Five steps, ordered for natural cognitive flow:
 *   1. 종목 — sector + equity picker
 *   2. 기간 — 1d / 1w (default) / 1m with explanatory chips. 1w is
 *      now the default because sector-level theses don't usually
 *      resolve in 1 day; 1d stays for retention (quick scoring).
 *   3. 변동률 — slider with live target-price preview
 *   4. 근거 — THE centerpiece:
 *      (a) Link a saved scenario from this sector (or, if none exist,
 *          a friendly CTA to /sectors/[slug]/simulate)
 *      (b) Free-form text for additional context
 *      (c) "🤖 AI로 분석하기" → Claude Sonnet → structured cards
 *          (thesis / supporting factors / risk factors / confidence)
 *          editable inline
 *   5. 등록
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  analyzeRationale as analyzeRationaleCall,
  createPrediction,
  fetchEquities,
  fetchEquityByTicker,
  fetchScenarios,
  fetchSims,
  type Equity,
  type RationaleAnalysis,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

type Horizon = "1d" | "1w" | "1m";

interface HorizonInfo {
  label: string;
  hint: string;
  badge?: { tone: "cyan" | "amber"; text: string };
}

const HORIZON_META: Record<Horizon, HorizonInfo> = {
  "1d": {
    label: "1일 뒤",
    hint: "내일 종가",
    badge: { tone: "amber", text: "🎯 빠른 채점 (감 잡기)" },
  },
  "1w": {
    label: "1주 뒤",
    hint: "다음 주 종가",
    badge: { tone: "cyan", text: "📅 권장 (섹터 시나리오 검증)" },
  },
  "1m": {
    label: "1달 뒤",
    hint: "한 달 뒤 종가",
  },
};

interface Props {
  initialTicker: string | null;
  initialSectorSlug: string | null;
}

export function PredictForm({ initialTicker, initialSectorSlug }: Props) {
  const router = useRouter();
  const [sims, setSims] = useState<SimMetadata[]>([]);
  const [sectorSlug, setSectorSlug] = useState<string>(initialSectorSlug ?? "");
  const [equities, setEquities] = useState<Equity[]>([]);
  const [equity, setEquity] = useState<Equity | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("1w");
  const [pct, setPct] = useState(2);
  const [rationale, setRationale] = useState("");

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<RationaleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sectorSlug) return;
    let cancelled = false;
    setEquities([]);
    setEquity(null);
    fetchEquities(sectorSlug)
      .then((eqs) => {
        if (cancelled) return;
        setEquities(eqs);
        if (initialTicker) {
          const match = eqs.find(
            (e) => e.ticker.toLowerCase() === initialTicker.toLowerCase(),
          );
          if (match) setEquity(match);
          else {
            void fetchEquityByTicker({ sectorSlug, ticker: initialTicker })
              .then((e) => {
                if (!cancelled) setEquity(e);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sectorSlug, initialTicker]);

  useEffect(() => {
    if (!sectorSlug) {
      setScenarios([]);
      setScenarioId(null);
      return;
    }
    let cancelled = false;
    fetchScenarios(sectorSlug)
      .then((list) => {
        if (cancelled) return;
        setScenarios(list);
        if (list.length > 0) {
          setScenarioId((prev) => prev ?? list[0]!.id);
        } else {
          setScenarioId(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sectorSlug]);

  const anchor = equity?.last_close_local ?? null;
  const targetPrice = useMemo(() => {
    if (anchor === null || anchor === undefined) return null;
    return anchor * (1 + pct / 100);
  }, [anchor, pct]);

  const selectedScenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId) ?? null,
    [scenarios, scenarioId],
  );

  async function onAnalyze() {
    if (!equity) {
      setAnalyzeError("먼저 종목을 선택해 주세요.");
      return;
    }
    if (!rationale.trim() && !scenarioId) {
      setAnalyzeError("근거 텍스트 또는 시나리오 중 하나는 필요합니다.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await analyzeRationaleCall({
        equity_id: equity.id,
        horizon,
        predicted_pct: pct,
        rationale: rationale.trim() || "(없음)",
        scenario_id: scenarioId ?? undefined,
      });
      setAnalysis(result);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setAnalyzing(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!equity) {
      setSubmitError("종목을 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createPrediction({
        equity_id: equity.id,
        horizon,
        predicted_pct: pct,
        rationale: rationale.trim() || undefined,
        scenario_id: scenarioId ?? undefined,
        rationale_analysis: analysis ?? undefined,
      });
      router.push("/community");
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "등록 실패");
      setSubmitting(false);
    }
  }

  const positive = pct >= 0;
  const sectorOpt = sims.find((s) => s.slug === sectorSlug);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
    >
      <FormStep number={1} title="어떤 종목?">
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={sectorSlug}
            onChange={(e) => {
              setSectorSlug(e.target.value);
              setEquity(null);
              setScenarioId(null);
              setAnalysis(null);
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
              setAnalysis(null);
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
            현재 가격:{" "}
            <span className="font-mono text-neutral-200">{fmtPrice(anchor)}</span>{" "}
            {equity.currency ?? ""}
          </p>
        )}
      </FormStep>

      <FormStep number={2} title="언제까지의 변동을 예측?">
        <div className="grid grid-cols-3 gap-2">
          {(["1d", "1w", "1m"] as const).map((h) => {
            const active = horizon === h;
            const meta = HORIZON_META[h];
            return (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setHorizon(h);
                  setAnalysis(null);
                }}
                className={`rounded border px-3 py-2 text-left transition ${
                  active
                    ? "border-cyan-700 bg-cyan-950/40 text-cyan-200"
                    : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700"
                }`}
              >
                <div className="text-sm font-medium">{meta.label}</div>
                <div className="text-[10px] text-neutral-500">{meta.hint}</div>
                {meta.badge && (
                  <div
                    className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-medium ${
                      meta.badge.tone === "cyan"
                        ? "bg-cyan-900/50 text-cyan-200"
                        : "bg-amber-900/50 text-amber-200"
                    }`}
                  >
                    {meta.badge.text}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-neutral-600">
          섹터 단위 가설 (드라이버 변동, 수요 변화 등) 은 보통 1주 이상에
          걸쳐 드러납니다. 1일 예측은 단기 모멘텀 / 뉴스 베팅에 적합합니다.
        </p>
      </FormStep>

      <FormStep number={3} title="얼마나 움직일 것 같나요?">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            예상 변동
          </span>
          <span
            className={`text-2xl font-bold tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}
          >
            {positive ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        </div>
        <input
          type="range"
          min={-30}
          max={30}
          step={0.5}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-neutral-600">
          <span>-30% 폭락</span>
          <span>기본 0%</span>
          <span>+30% 폭등</span>
        </div>
        {targetPrice !== null && equity && (
          <p className="mt-2 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-300">
            {HORIZON_META[horizon].label} 예상 가격 ={" "}
            <span
              className={`font-mono font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}
            >
              {fmtPrice(targetPrice)} {equity.currency ?? ""}
            </span>
          </p>
        )}
      </FormStep>

      <FormStep number={4} title="근거를 만들어 보세요">
        {/* 4a — Linked scenario */}
        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500">
            🛠 시나리오 연결{" "}
            <span className="normal-case text-neutral-600">
              (어떤 가정으로 이 예측을 하는가)
            </span>
          </label>
          {scenarios.length > 0 ? (
            <>
              <select
                value={scenarioId ?? ""}
                onChange={(e) => {
                  setScenarioId(e.target.value || null);
                  setAnalysis(null);
                }}
                className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
              >
                <option value="">(연결하지 않음)</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {Object.keys(s.driver_overrides).length}개 가정
                  </option>
                ))}
              </select>
              {selectedScenario && <ScenarioPreview scenario={selectedScenario} />}
            </>
          ) : (
            <EmptyScenarioCta sectorSlug={sectorSlug} sectorName={sectorOpt?.name} />
          )}
        </div>

        {/* 4b — Free-form text */}
        <div className="mb-3">
          <label
            htmlFor="rationale"
            className="block text-[10px] uppercase tracking-wider text-neutral-500"
          >
            📝 추가 설명{" "}
            <span className="normal-case text-neutral-600">
              (왜 이 가정이 옳다고 보는지)
            </span>
          </label>
          <textarea
            id="rationale"
            rows={3}
            value={rationale}
            onChange={(e) => {
              setRationale(e.target.value);
              setAnalysis(null);
            }}
            placeholder="예: HBM 출하 가이드가 시장 컨센서스를 상회할 것으로 봄. 다음 주 컨퍼런스 콜에서 capex 가이드 강세 예상."
            className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-cyan-700 focus:outline-none"
          />
        </div>

        {/* 4c — AI analysis */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] text-neutral-500">
              🤖 시나리오와 근거를 AI 가 정리해서 thesis · 우호 요인 · 리스크
              요인으로 분해해 줍니다.
            </p>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={
                analyzing || !equity || (!rationale.trim() && !scenarioId)
              }
              className="rounded border border-violet-700 bg-violet-900/40 px-3 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing
                ? "분석 중…"
                : analysis
                  ? "다시 분석"
                  : "🤖 AI로 분석하기"}
            </button>
          </div>
          {analyzeError && (
            <p className="mt-2 rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-300">
              {analyzeError}
            </p>
          )}
          {analysis && (
            <AnalysisCard
              analysis={analysis}
              onChange={(next) =>
                setAnalysis({ ...next, edited_by_user: true })
              }
            />
          )}
        </div>
      </FormStep>

      {submitError && (
        <p className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {submitError}
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

function FormStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-neutral-800 bg-neutral-950/40 p-4">
      <h3 className="mb-3 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
        <span className="rounded-full bg-cyan-900/60 px-2 py-0.5 text-cyan-200">
          {number}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyScenarioCta({
  sectorSlug,
  sectorName,
}: {
  sectorSlug: string;
  sectorName?: string;
}) {
  return (
    <div className="mt-2 rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4">
      <p className="text-sm font-medium text-cyan-200">
        💡 {sectorName ?? "이 섹터"} 에 저장된 시나리오가 아직 없네요.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-cyan-100/80">
        예측의 근거는 \"내가 어떤 가정을 깔고 있는가\" 입니다. 시뮬레이션
        탭에서 드라이버를 조정하고 시나리오로 저장하면, 그 가정 위에서 이
        예측이 평가됩니다.
      </p>
      <a
        href={`/sectors/${sectorSlug}/simulate`}
        className="mt-3 inline-block rounded border border-cyan-700 bg-cyan-900/40 px-2.5 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-800/60"
      >
        시뮬레이션 탭으로 가서 시나리오 만들기 →
      </a>
      <p className="mt-2 text-[10px] text-cyan-300/70">
        시나리오 없이도 자유 텍스트만으로 등록 가능하지만, 시나리오를 연결하면
        AI 분석과 향후 채점 비교가 훨씬 풍부해집니다.
      </p>
    </div>
  );
}

function ScenarioPreview({ scenario }: { scenario: Scenario }) {
  const overrides = Object.entries(scenario.driver_overrides).slice(0, 5);
  return (
    <div className="mt-2 rounded border border-cyan-900/60 bg-cyan-950/20 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-cyan-200">✓ {scenario.name}</p>
        <span className="text-[10px] text-cyan-400">
          {Object.keys(scenario.driver_overrides).length}개 가정
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-[11px]">
        {overrides.map(([k, v]) => (
          <li key={k} className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-neutral-400">{k}</span>
            <span className="font-mono tabular-nums text-cyan-200">
              {String(v)}
            </span>
          </li>
        ))}
        {Object.keys(scenario.driver_overrides).length > 5 && (
          <li className="text-[10px] text-neutral-600">
            + {Object.keys(scenario.driver_overrides).length - 5}개 더
          </li>
        )}
      </ul>
      {scenario.notes && (
        <p className="mt-2 text-[11px] leading-relaxed text-cyan-100/80">
          {scenario.notes}
        </p>
      )}
    </div>
  );
}

function AnalysisCard({
  analysis,
  onChange,
}: {
  analysis: RationaleAnalysis;
  onChange: (next: RationaleAnalysis) => void;
}) {
  const [editing, setEditing] = useState(false);

  const confidenceLabel: Record<RationaleAnalysis["confidence"], string> = {
    low: "낮음",
    med: "보통",
    high: "높음",
  };
  const confidenceTone: Record<RationaleAnalysis["confidence"], string> = {
    low: "border-rose-900/60 bg-rose-950/40 text-rose-300",
    med: "border-amber-900/60 bg-amber-950/40 text-amber-300",
    high: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
  };

  return (
    <div className="mt-3 rounded-lg border border-violet-900/60 bg-violet-950/20 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-violet-300">
            🤖 AI 분석
          </span>
          {analysis.edited_by_user && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">
              ✏️ 편집됨
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${confidenceTone[analysis.confidence]}`}
          >
            확신도: {confidenceLabel[analysis.confidence]}
          </span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-[10px] text-violet-300 hover:text-violet-100"
          >
            {editing ? "완료" : "편집"}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-violet-300">
          핵심 가설
        </p>
        {editing ? (
          <textarea
            value={analysis.thesis_summary}
            onChange={(e) =>
              onChange({ ...analysis, thesis_summary: e.target.value })
            }
            rows={2}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          />
        ) : (
          <p className="text-sm leading-relaxed text-neutral-100">
            {analysis.thesis_summary}
          </p>
        )}
      </div>

      <div className="mb-3">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">
          🟢 우호 요인 ({analysis.supporting_factors.length})
        </p>
        <FactorList
          items={analysis.supporting_factors}
          editing={editing}
          onChange={(items) =>
            onChange({ ...analysis, supporting_factors: items })
          }
        />
      </div>

      <div className="mb-2">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-rose-400">
          🔴 리스크 요인 ({analysis.risk_factors.length})
        </p>
        <FactorList
          items={analysis.risk_factors}
          editing={editing}
          onChange={(items) => onChange({ ...analysis, risk_factors: items })}
        />
      </div>

      {editing && (
        <div className="mt-3 flex items-baseline gap-2 text-[10px]">
          <span className="text-neutral-500">확신도</span>
          {(["low", "med", "high"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...analysis, confidence: c })}
              className={`rounded border px-2 py-0.5 ${
                analysis.confidence === c
                  ? confidenceTone[c]
                  : "border-neutral-800 text-neutral-500 hover:text-neutral-200"
              }`}
            >
              {confidenceLabel[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FactorList({
  items,
  editing,
  onChange,
}: {
  items: { title: string; detail: string }[];
  editing: boolean;
  onChange: (items: { title: string; detail: string }[]) => void;
}) {
  if (items.length === 0) {
    return <p className="text-[11px] text-neutral-600">(없음)</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="rounded border border-neutral-800 bg-neutral-950/40 p-2"
        >
          {editing ? (
            <>
              <input
                type="text"
                value={item.title}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...item, title: e.target.value };
                  onChange(next);
                }}
                className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs font-medium text-neutral-200"
              />
              <textarea
                value={item.detail}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...item, detail: e.target.value };
                  onChange(next);
                }}
                rows={2}
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-300"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="mt-1 text-[10px] text-rose-400 hover:text-rose-300"
              >
                삭제
              </button>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-neutral-100">{item.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-400">
                {item.detail}
              </p>
            </>
          )}
        </li>
      ))}
      {editing && (
        <li>
          <button
            type="button"
            onClick={() =>
              onChange([...items, { title: "새 요인", detail: "" }])
            }
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            + 추가
          </button>
        </li>
      )}
    </ul>
  );
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
