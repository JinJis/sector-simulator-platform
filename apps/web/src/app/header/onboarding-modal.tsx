"use client";

/**
 * M37 onboarding — 3-step Vision Feasibility Monitor intro.
 *
 * Replaces M23's investment-tool onboarding (sector → slider → "예상
 * 주가 변동"). The pivot needed a flow that teaches the *new* product:
 *   Step 1: pick a vision
 *   Step 2: anchor the framing question + the feasibility brief
 *   Step 3: read the three Hero headline numbers (composite / 90d delta
 *           / ETA) — a 5-second comprehension drill
 *
 * STORAGE_KEY bumped to `_v3` so existing users see the new flow once.
 * `?onboard=1` query forces re-open (used by /settings 다시 보기 +
 * post-signup redirect).
 *
 * The route at finish goes to the Hero page (`/visions/[slug]`), not
 * the Playground — the Hero is the canonical 5-second view; Playground
 * is the optional drill-down.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useFocusTrap } from "./use-focus-trap";

const STORAGE_KEY = "sss_onboard_v3";

interface VisionOption {
  slug: string;
  name: string;
  emoji: string;
  /** Picker-card tagline (one short line). */
  tagline: string;
  /** Step 2 framing question — italicized in the modal. */
  question: string;
  /** Step 2 paragraph context. */
  brief: string;
  /** Step 3 headline values (curated to mirror the live fixture). */
  preview: {
    composite: number;
    delta90d: number;
    etaYear: number;
    binding: string;
  };
}

const VISIONS: VisionOption[] = [
  {
    slug: "space-data-center",
    name: "Space Data Centers",
    emoji: "🛰️",
    tagline: "궤도에 컴퓨트가 떠 있는 시점",
    question: "By when will compute in orbit be commercially viable?",
    brief:
      "발사 비용 하락 + 광학 다운링크 + 우주 방사선에 견디는 칩이 동시에 ready 되어야 가능. 지금은 라드-하드 칩이 가장 큰 병목.",
    preview: {
      composite: 73,
      delta90d: 8,
      etaYear: 2034,
      binding: "Radiation-hard compute",
    },
  },
  {
    slug: "memory-semi",
    name: "AI Memory Supercycle",
    emoji: "💾",
    tagline: "HBM 사이클이 멈추지 않는다면",
    question: "Does the AI HBM cycle hold for the next 5 years?",
    brief:
      "AI 학습/추론 수요가 메모리 capex를 끌고 가는 구조가 얼마나 지속되는가. 가격 · 점유 · 신규 capa가 동시에 변수.",
    preview: {
      composite: 64,
      delta90d: 3,
      etaYear: 2030,
      binding: "TBD (M38 seed)",
    },
  },
  {
    slug: "sofc",
    name: "Solid Oxide Fuel Cells at Grid Scale",
    emoji: "⚡",
    tagline: "SOFC가 그리드 패리티에 도달하는 시점",
    question: "Can SOFCs deliver grid-parity LCOE by 2035?",
    brief:
      "AI 데이터센터의 전력 수요 + 탄소 가격 상승이 SOFC 경제성을 끌어올리지만, 스택 수명과 양산 비용이 여전히 큰 변수.",
    preview: {
      composite: 42,
      delta90d: 1,
      etaYear: 2038,
      binding: "TBD (M38 seed)",
    },
  },
];

export function OnboardingModal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams?.get("onboard") === "1";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<VisionOption | null>(null);

  // Suppress on auth pages so the form is what greets the user.
  useEffect(() => {
    if (pathname === "/login" || pathname === "/signup") return;
    if (forced) {
      setStep(1);
      setSelected(null);
      setOpen(true);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      if (!seen) setOpen(true);
    } catch {
      // localStorage blocked — silently skip
    }
  }, [forced, pathname]);

  function close(markSeen: boolean) {
    setOpen(false);
    if (markSeen) {
      try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      } catch {
        // ignore
      }
    }
    if (forced) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("onboard");
      router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }

  function pick(vision: VisionOption) {
    setSelected(vision);
    setStep(2);
  }

  function goVision() {
    if (!selected) return;
    close(true);
    router.push(`/visions/${selected.slug}`);
  }

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div
        ref={trapRef}
        tabIndex={-1}
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
            Vision Monitor — 3분 가이드
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-neutral-500">{step} / 3</span>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              건너뛰기
            </button>
          </div>
        </header>

        {step === 1 && <Step1Pick onPick={pick} />}
        {step === 2 && selected && (
          <Step2Question
            vision={selected}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && selected && (
          <Step3Preview
            vision={selected}
            onBack={() => setStep(2)}
            onFinish={goVision}
          />
        )}
      </div>
    </div>
  );
}

function Step1Pick({ onPick }: { onPick: (v: VisionOption) => void }) {
  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        어떤 기술 비전이 가장 궁금하신가요?
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        하나 고르면, 이 플랫폼이 그 비전의 실현 가능성을 어떻게 추적하는지 함께 보여드릴게요.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {VISIONS.map((v) => (
          <li key={v.slug}>
            <button
              type="button"
              onClick={() => onPick(v)}
              className="group flex h-full w-full flex-col items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-cyan-700 hover:bg-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              aria-label={`${v.name} — ${v.tagline}`}
            >
              <span className="text-3xl" aria-hidden="true">
                {v.emoji}
              </span>
              <span className="text-sm font-semibold text-neutral-100 group-hover:text-cyan-200">
                {v.name}
              </span>
              <span className="text-[11px] leading-relaxed text-neutral-500">
                {v.tagline}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step2Question({
  vision,
  onBack,
  onNext,
}: {
  vision: VisionOption;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="px-6 py-6">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-2xl" aria-hidden="true">
          {vision.emoji}
        </span>
        <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
          {vision.name}
        </h2>
      </div>
      <div className="rounded-lg border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950 to-neutral-950 p-5">
        <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-300">
          The question
        </p>
        <p className="mt-2 text-lg italic leading-relaxed text-neutral-100">
          &ldquo;{vision.question}&rdquo;
        </p>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-neutral-400">
        {vision.brief}
      </p>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        이 비전은 ~10개의 capability(기술 / 경제 / 규제 / 공급)로 쪼개지고, 각 capability는
        매일 들어오는 신호(논문 · 특허 · 뉴스 · 공시)에 의해 score가 업데이트됩니다. 다음 화면에서
        현재 상태를 5초 만에 읽는 법을 보여드릴게요.
      </p>
      <footer className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          ← 다른 비전
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          5초 만에 읽는 법 →
        </button>
      </footer>
    </div>
  );
}

function Step3Preview({
  vision,
  onBack,
  onFinish,
}: {
  vision: VisionOption;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { composite, delta90d, etaYear, binding } = vision.preview;
  const compositeColor =
    composite < 30
      ? "text-rose-400"
      : composite < 60
        ? "text-amber-400"
        : "text-emerald-400";

  const deltaSign = delta90d > 0 ? "▲ +" : delta90d < 0 ? "▼ " : "─ ";
  const deltaColor =
    delta90d > 0
      ? "text-emerald-400"
      : delta90d < 0
        ? "text-rose-400"
        : "text-neutral-300";

  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        5초 만에 읽는 법
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        각 비전의 Hero 페이지 맨 위에는 세 가지 숫자가 있어요. 그것만 봐도 80%는 이해됩니다.
      </p>

      <div
        className="mt-5 grid gap-3 sm:grid-cols-3"
        role="group"
        aria-label="Hero headline metrics"
      >
        {/* Feasibility */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            Feasibility
          </p>
          <p
            className={`mt-2 font-mono text-4xl font-semibold leading-none tabular-nums ${compositeColor}`}
          >
            {composite}
          </p>
          <p className="mt-1 text-[10px] text-neutral-500">/ 100</p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            지금 얼마나 가까운지. 0 = 불가능, 100 = 상용화.
          </p>
        </div>
        {/* 90d delta */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            90-day Δ
          </p>
          <p
            className={`mt-2 font-mono text-4xl font-semibold leading-none tabular-nums ${deltaColor}`}
          >
            {deltaSign}
            {Math.abs(delta90d)}
          </p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            지난 90일 동안 점수가 어디로 움직였는지.
          </p>
        </div>
        {/* ETA */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            ETA (median)
          </p>
          <p className="mt-2 font-mono text-4xl font-semibold leading-none tabular-nums text-neutral-100">
            {etaYear}
          </p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            현재 추세가 이어진다면 도달 예상 연도.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/10 p-3">
        <p className="text-[11px] text-amber-300">
          <span aria-hidden="true">⚠</span>{" "}
          Binding: <span className="font-medium">{binding}</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-amber-200/70">
          비전 점수의 천장을 결정하는 capability. 이걸 끌어올리는 신호가 가장 큰 영향을 줍니다.
        </p>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">
        Hero 페이지에는 이 외에도 capability 카드(4-차원 막대), 리스크 보드, 최근 24h 신호 feed,
        경제성 곡선이 함께 표시됩니다. Playground 탭에서 직접 가정을 조정해볼 수도 있어요.
      </p>

      <footer className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          ← 질문 다시 보기
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {vision.name} 직접 보기 →
        </button>
      </footer>
    </div>
  );
}
