"use client";

/**
 * /propose — beginner-friendly agent-driven sector creation flow.
 *
 * Four steps, each one screen:
 *
 *   1. Prompt    — big textarea with examples to seed the agent run
 *   2. Working   — friendly Korean progress while the workflow polls
 *   3. Result    — drivers / outputs / DAG / assumptions in plain Korean
 *   4. Activate  — "내 시뮬레이터로 만들기" promotes to a live sector
 *
 * The agent itself does the heavy lifting (DecompositionWorkflow +
 * EdgeInferenceWorkflow chained via ProposeSectorWorkflow — M22a).
 * This file is purely about UX wrapping that workflow.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  activateSector,
  cancelAgentWorkflow,
  getAgentWorkflow,
  proposeSectorFromAgent,
  startProposeSector,
  type AgentProposeSectorResult,
  type AgentWorkflow,
  type CurrentUser,
} from "@/lib/sim-client";

const EXAMPLE_PROMPTS = [
  {
    title: "🍔 K-Food / 식품",
    body:
      "한국 음식 글로벌화 (라면, K-snack, HMR). 주요 수출 시장 (미국, 동남아, 유럽) 의 성장률, 환율, 원재료 가격, 인플레이션이 매출과 마진에 미치는 영향. 농심 / CJ제일제당 / 오리온 등 주요 종목.",
  },
  {
    title: "🚗 자율주행 / 모빌리티",
    body:
      "자율주행 레벨 4-5 상용화 시나리오. ADAS 칩 수요, 차량용 LiDAR 가격 하락, 라이드헤일링 침투율, 보험사 책임 모델 변화가 OEM·반도체·소프트웨어 회사들에 미치는 영향.",
  },
  {
    title: "🏥 비만 치료제 (GLP-1)",
    body:
      "GLP-1 작용제 (오젬픽 / 위고비 / 마운자로) 시장의 환자 모수 침투율, 보험 커버리지 변화, 경쟁 제네릭 진입, 제조 capacity 병목이 Novo Nordisk · Lilly · 제조 위탁 회사들에 미치는 영향.",
  },
];

type StageId =
  | "prompt"
  | "working"
  | "result"
  | "activated"
  | "error";

export function ProposeFlow({ user }: { user: CurrentUser | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<StageId>("prompt");
  const [description, setDescription] = useState("");
  const [referenceData, setReferenceData] = useState("");
  const [workflow, setWorkflow] = useState<AgentWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll the workflow until terminal.
  const poll = useCallback(async (id: string) => {
    try {
      const next = await getAgentWorkflow(id);
      setWorkflow(next);
      if (next.status === "succeeded") {
        setStage("result");
      } else if (next.status === "failed" || next.status === "cancelled") {
        setError(next.error ?? "워크플로가 중단되었습니다.");
        setStage("error");
      } else {
        pollRef.current = setTimeout(() => poll(id), 1500);
      }
    } catch {
      // Transient — retry on the next tick.
      pollRef.current = setTimeout(() => poll(id), 1500);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function start() {
    if (!user) {
      const redirect = encodeURIComponent("/propose");
      window.location.href = `/login?redirect=${redirect}`;
      return;
    }
    setError(null);
    setStage("working");
    try {
      const wf = await startProposeSector({
        description: description.trim(),
        reference_data: referenceData.trim() || undefined,
      });
      setWorkflow(wf);
      void poll(wf.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "워크플로 시작 실패");
      setStage("error");
    }
  }

  async function cancel() {
    if (!workflow) return;
    try {
      await cancelAgentWorkflow(workflow.id);
    } catch {
      // ignore
    }
    if (pollRef.current) clearTimeout(pollRef.current);
    setStage("prompt");
    setWorkflow(null);
  }

  async function activate() {
    if (!workflow || workflow.status !== "succeeded") return;
    setActivating(true);
    setError(null);
    try {
      const proposed = await proposeSectorFromAgent({ workflow_id: workflow.id });
      // Auto-activate so the user lands on a usable sector.
      const live = await activateSector(proposed.sector.slug);
      // Hand-off — drop the user into their new sector's Overview.
      router.push(`/sectors/${live.slug}`);
      router.refresh();
      setStage("activated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "활성화 실패");
      setActivating(false);
    }
  }

  if (stage === "prompt") {
    return (
      <PromptStep
        description={description}
        setDescription={setDescription}
        referenceData={referenceData}
        setReferenceData={setReferenceData}
        onSubmit={start}
        user={user}
      />
    );
  }
  if (stage === "working") {
    return <WorkingStep workflow={workflow} onCancel={cancel} />;
  }
  if (stage === "result") {
    const result = extractResult(workflow);
    return (
      <ResultStep
        workflow={workflow!}
        result={result}
        activating={activating}
        onActivate={activate}
        onStartOver={() => {
          setWorkflow(null);
          setStage("prompt");
        }}
        error={error}
      />
    );
  }
  if (stage === "activated") {
    return (
      <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-6 text-center">
        <p className="text-sm text-emerald-200">✓ 활성화 완료, 페이지 이동 중...</p>
      </div>
    );
  }
  // error
  return (
    <ErrorStep
      error={error}
      onRetry={() => setStage("prompt")}
    />
  );
}

// ---------- Step 1: Prompt ----------

function PromptStep({
  description,
  setDescription,
  referenceData,
  setReferenceData,
  onSubmit,
  user,
}: {
  description: string;
  setDescription: (s: string) => void;
  referenceData: string;
  setReferenceData: (s: string) => void;
  onSubmit: () => void;
  user: CurrentUser | null;
}) {
  const tooShort = description.trim().length < 20;
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <label
          htmlFor="propose-desc"
          className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-300"
        >
          어떤 산업을 시뮬레이터로 만들어 볼까요?
        </label>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          1-3 문장이면 충분합니다. 산업이 무엇인지, 어떤 변수가 중요한지,
          어떤 종목이 영향을 받을지 — 떠오르는 대로 적어주세요.
        </p>
        <textarea
          id="propose-desc"
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="예: K-Food 글로벌화. 한국 음식의 미국·동남아 시장 침투율, 환율, 원재료 가격이 농심·CJ제일제당의 매출과 마진에 미치는 영향."
          className="mt-3 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-neutral-600">
          {description.trim().length}자 · 최소 20자 이상
        </p>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          예시로 시작해보세요
        </p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {EXAMPLE_PROMPTS.map((ex) => (
            <li key={ex.title}>
              <button
                type="button"
                onClick={() => setDescription(ex.body)}
                className="group h-full w-full rounded border border-neutral-800 bg-neutral-900/40 p-3 text-left transition hover:border-cyan-700 hover:bg-neutral-900"
              >
                <div className="text-xs font-semibold text-neutral-200 group-hover:text-cyan-200">
                  {ex.title}
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-neutral-500">
                  {ex.body}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
        <label
          htmlFor="propose-ref"
          className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-300"
        >
          추가 컨텍스트 <span className="text-neutral-600">(선택)</span>
        </label>
        <p className="mt-1 text-[11px] text-neutral-500">
          분석가 노트, 리서치 발췌, 알고 있는 핵심 수치 등을 붙여 넣으면
          에이전트가 더 정확한 기본값을 잡습니다.
        </p>
        <textarea
          id="propose-ref"
          rows={4}
          value={referenceData}
          onChange={(e) => setReferenceData(e.target.value)}
          placeholder="예: 농심 신라면 수출 비중 2025년 32% (전사 매출의 18%). 미국 시장 CAGR +12%/yr."
          className="mt-3 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs leading-relaxed text-neutral-200 placeholder:text-neutral-700 focus:border-cyan-700 focus:outline-none"
        />
      </section>

      <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200">
        <p>
          🤖 에이전트는 <strong>Claude Opus 4.7</strong> 을 두 번 호출합니다
          (드라이버 구성 → 인과 그래프 + 수식). 보통 1-3 분 소요, 비용은 평균
          $0.20-0.60. {" "}
          <span className="text-amber-100">
            가입 사용자에게 무료로 풀려있는 베타 기능이며, 정식 출시 후에는
            ★ Premium 구독자에게만 제공됩니다.
          </span>
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="text-[11px] text-neutral-500 hover:text-neutral-200"
        >
          ← 돌아가기
        </Link>
        <button
          type="button"
          disabled={tooShort}
          onClick={onSubmit}
          className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {user ? "시뮬레이터 만들기 시작 →" : "로그인 후 시작 →"}
        </button>
      </div>
    </div>
  );
}

// ---------- Step 2: Working ----------

const STAGE_HINTS = [
  {
    threshold_seconds: 0,
    title: "산업의 핵심 변수를 찾고 있어요…",
    body:
      "어떤 드라이버가 이 산업의 매출 · 마진 · 종목 가격에 영향을 미치는지, 에이전트가 정리 중입니다.",
  },
  {
    threshold_seconds: 30,
    title: "변수들 사이의 인과 관계를 그리고 있어요…",
    body:
      "각 드라이버가 어떤 중간 계산을 거쳐 출력으로 흘러가는지, 그리고 어떤 가정을 깔아야 하는지를 정리 중입니다.",
  },
  {
    threshold_seconds: 90,
    title: "수식을 검증하고 마무리하는 중…",
    body:
      "단위 일관성과 가정의 정합성을 점검하고, 결과를 정리하는 단계입니다.",
  },
];

function WorkingStep({
  workflow,
  onCancel,
}: {
  workflow: AgentWorkflow | null;
  onCancel: () => void;
}) {
  // Tick a counter so the hint message advances over time. Not tied
  // to the actual workflow stage (the workflow record doesn't expose
  // sub-step progress today) — purely a UX comfort signal.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const hint =
    [...STAGE_HINTS].reverse().find((h) => elapsed >= h.threshold_seconds) ??
    STAGE_HINTS[0]!;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950 to-neutral-950 p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-3 w-3 animate-pulse rounded-full bg-cyan-400"
        />
        <h2 className="text-base font-semibold text-cyan-100">{hint.title}</h2>
      </div>
      <p className="text-sm leading-relaxed text-neutral-300">{hint.body}</p>
      <div className="rounded border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-[11px] text-neutral-500">
        <div>workflow id: {workflow?.id ?? "—"}</div>
        <div>경과 시간: {elapsed}s</div>
        <div>상태: {workflow?.status ?? "queued"}</div>
        {workflow?.cost_usd ? (
          <div>비용: ${workflow.cost_usd.toFixed(4)}</div>
        ) : null}
      </div>
      <p className="text-[11px] text-neutral-500">
        이 화면은 자동으로 갱신됩니다. 다른 페이지로 이동해도 워크플로는
        계속 실행되며, 헤더 우측 메뉴의 "내가 만든 시뮬레이터" 에서 진행
        상황을 다시 볼 수 있습니다.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-neutral-500 hover:text-rose-400"
        >
          취소
        </button>
      </div>
    </div>
  );
}

// ---------- Step 3: Result ----------

function ResultStep({
  workflow,
  result,
  activating,
  onActivate,
  onStartOver,
  error,
}: {
  workflow: AgentWorkflow;
  result: AgentProposeSectorResult | null;
  activating: boolean;
  onActivate: () => void;
  onStartOver: () => void;
  error: string | null;
}) {
  if (!result) {
    return (
      <ErrorStep
        error="에이전트가 결과를 만들었지만 구조를 해석할 수 없습니다. 다른 표현으로 다시 시도해보세요."
        onRetry={onStartOver}
      />
    );
  }
  const { decomposition, edge_inference } = result;
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[11px] text-emerald-400">✓ 에이전트가 시뮬레이터 구성을 완료했어요</p>
            <h2 className="mt-1 text-xl font-semibold text-emerald-100">
              {decomposition.name}
            </h2>
            <p className="mt-1 text-[11px] text-emerald-400">
              slug: <code className="font-mono">{decomposition.slug}</code> ·
              시뮬레이션 기간 {decomposition.horizon_years}년 · 비용{" "}
              ${workflow.cost_usd.toFixed(4)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-emerald-100/90">
          {decomposition.description}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Tile
          label="드라이버"
          count={decomposition.drivers.length}
          sub="시뮬레이션에서 직접 조정할 변수"
        />
        <Tile
          label="중간 계산"
          count={decomposition.intermediates.length}
          sub="드라이버 → 출력의 연결고리"
        />
        <Tile
          label="출력"
          count={decomposition.outputs.length}
          sub="매출 · 비용 · NPV 등"
        />
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          이 시뮬레이터의 드라이버 ({decomposition.drivers.length})
        </h3>
        <ul className="flex flex-col gap-2 text-xs">
          {decomposition.drivers.slice(0, 8).map((d) => (
            <li
              key={d.name}
              className="rounded border border-neutral-800 bg-neutral-950/60 p-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-neutral-200">{d.name}</span>
                <span className="font-mono tabular-nums text-neutral-500">
                  기본 {d.default} {d.unit} · {d.min}–{d.max}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                {d.description}
              </p>
            </li>
          ))}
          {decomposition.drivers.length > 8 && (
            <li className="text-[10px] text-neutral-600">
              + {decomposition.drivers.length - 8}개 더 — 활성화하면 전체
              조정 가능
            </li>
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          출력 ({decomposition.outputs.length})
        </h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {decomposition.outputs.map((o) => (
            <li
              key={o.name}
              className="rounded border border-neutral-800 bg-neutral-950/60 p-2.5 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-neutral-200">{o.name}</span>
                <span className="rounded border border-neutral-800 px-1 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">
                  {o.kind}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                {o.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          인과 관계 ({edge_inference.edges.length} edges, {edge_inference.intermediates.length} 중간 수식)
        </h3>
        <p className="mb-3 text-[11px] text-neutral-500">
          예: 입력 변수 X 가 중간 계산 Y 를 거쳐 출력 Z 에 영향을 줍니다.
          상세 그래프는 활성화 후 인과 그래프 탭에서 시각화됩니다.
        </p>
        <ul className="grid gap-1.5 text-[11px] sm:grid-cols-2">
          {edge_inference.edges.slice(0, 8).map((e, i) => (
            <li
              key={i}
              className="flex items-baseline gap-2 rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1"
            >
              <span className="truncate font-mono text-cyan-300">
                {e.source}
              </span>
              <span aria-hidden className="text-neutral-600">
                →
              </span>
              <span className="truncate font-mono text-amber-300">
                {e.target}
              </span>
              {e.label && (
                <span className="ml-auto truncate text-neutral-500">
                  {e.label}
                </span>
              )}
            </li>
          ))}
        </ul>
        {edge_inference.edges.length > 8 && (
          <p className="mt-2 text-[10px] text-neutral-600">
            + {edge_inference.edges.length - 8}개 edge 더
          </p>
        )}
      </section>

      {edge_inference.assumptions.length > 0 && (
        <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
          <h3 className="mb-2 text-sm font-semibold text-amber-200">
            에이전트가 가정한 것 ({edge_inference.assumptions.length})
          </h3>
          <p className="mb-2 text-[11px] text-amber-100/80">
            아래 가정에 동의하기 어렵다면 활성화 후 인과 그래프 / 전체
            슬라이더에서 수정할 수 있습니다.
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-amber-100">
            {edge_inference.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden>·</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-cyan-900/40 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onStartOver}
          disabled={activating}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
        >
          ← 다시 만들기
        </button>
        <button
          type="button"
          onClick={onActivate}
          disabled={activating}
          className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {activating ? "활성화 중…" : "내 시뮬레이터로 만들기 →"}
        </button>
      </div>
    </div>
  );
}

function Tile({
  label,
  count,
  sub,
}: {
  label: string;
  count: number;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-100">
        {count}
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">{sub}</p>
    </div>
  );
}

// ---------- Step 4: Error ----------

function ErrorStep({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-6">
      <h2 className="text-base font-semibold text-rose-200">
        에이전트 실행 실패
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-rose-100/90">
        {error ?? "알 수 없는 오류가 발생했습니다."}
      </p>
      <p className="mt-2 text-xs text-rose-300/70">
        설명을 더 구체적으로 다시 적어주시면 다시 시도해볼 수 있습니다.
        문제가 반복되면 관리자에게 알려주세요.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded border border-rose-700 bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-800/60"
      >
        다시 시도
      </button>
    </div>
  );
}

function extractResult(wf: AgentWorkflow | null): AgentProposeSectorResult | null {
  if (!wf || wf.status !== "succeeded" || !wf.output) return null;
  if (wf.kind !== "propose_sector") return null;
  return wf.output as unknown as AgentProposeSectorResult;
}
