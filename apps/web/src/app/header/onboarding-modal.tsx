"use client";

/**
 * M23 onboarding — 3-step value demo.
 *
 * Old (M20) version was a 5-step navigation tour. The user feedback
 * was that it taught the app's layout instead of the app's *value*.
 * This rewrite picks a sector, shows its thesis in one paragraph,
 * then drops the user into a one-slider demo — so the first 90
 * seconds proves the product can answer the question they came with.
 *
 * Storage key bumped to `_v2` so existing users get re-shown the new
 * onboarding once. `?onboard=1` forces re-open (used by /settings
 * 다시 보기 button + by signup redirect).
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "sss_onboard_v2";

interface SectorOption {
  slug: string;
  name: string;
  oneLiner: string;
  emoji: string;
  /** Plain-Korean growth thesis paragraph used on step 2. */
  thesis: string;
  /** The single driver shown on step 3. */
  demoDriver: {
    name: string;
    label: string;
    /** Plain explanation of what the slider represents. */
    blurb: string;
  };
  /** The 2-3 tickers whose impact gets highlighted in step 3. */
  demoEquities: string[];
}

const SECTORS: SectorOption[] = [
  {
    slug: "memory-semi",
    name: "메모리 반도체",
    oneLiner: "AI 슈퍼사이클의 가장 강한 수혜처",
    emoji: "💾",
    thesis:
      "AI 학습·추론 워크로드가 폭증하면서 HBM(고대역폭 메모리) 수요가 매년 40%+ 성장 중. DRAM 가격 강세 + HBM 프리미엄 유지 시 메모리 3사의 영업이익이 사상 최대 수준을 노립니다.",
    demoDriver: {
      name: "ai_dram_demand_pb_y0",
      label: "AI DRAM 수요",
      blurb:
        "AI 학습용 메모리 수요 (페타바이트). 이 값이 늘면 메모리 회사의 매출이 커집니다.",
    },
    demoEquities: ["005930", "000660", "NVDA"],
  },
  {
    slug: "space-data-center",
    name: "우주 데이터센터",
    oneLiner: "발사 비용 하락이 만드는 새 컴퓨팅 인프라",
    emoji: "🛰️",
    thesis:
      "Starship 시대의 발사 비용(<$1k/kg) + 솔라/방열 기술 진보로 우주 데이터센터의 LCOE가 지상과 경쟁 가능 영역에 진입. 위성·발사·페이로드 공급망 전체가 동시 수혜를 받는 구조입니다.",
    demoDriver: {
      name: "launch_cost_usd_per_kg",
      label: "발사 비용",
      blurb:
        "kg당 발사 비용 ($). 이 값이 떨어질수록 우주 데이터센터의 경제성이 좋아집니다.",
    },
    demoEquities: ["RKLB", "ASTS"],
  },
  {
    slug: "sofc",
    name: "연료전지 (SOFC)",
    oneLiner: "데이터센터 백업 + 분산발전의 주역",
    emoji: "⚡",
    thesis:
      "AI 데이터센터의 전력 수요 폭증 + 탄소 가격 상승으로 SOFC(고체산화물 연료전지)의 도입이 가속. 발전 효율 60%+ 검증 시 가스 터빈 대비 단위 발전 단가가 경쟁 가능 영역에 진입합니다.",
    demoDriver: {
      name: "system_efficiency_pct_lhv",
      label: "전기 발전 효율",
      blurb:
        "스택 효율 (%). 이 값이 높아질수록 SOFC 시스템의 경제성이 좋아져 도입이 가속됩니다.",
    },
    demoEquities: ["BE", "PLUG"],
  },
];

export function OnboardingModal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams?.get("onboard") === "1";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<SectorOption | null>(null);

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

  function pick(sector: SectorOption) {
    setSelected(sector);
    setStep(2);
  }

  function goSimulate() {
    if (!selected) return;
    close(true);
    router.push(`/sectors/${selected.slug}/simulate`);
  }

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
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl">
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
            3분 가이드
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-neutral-500">{step} / 3</span>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-[11px] text-neutral-500 hover:text-neutral-200"
            >
              건너뛰기
            </button>
          </div>
        </header>

        {step === 1 && (
          <Step1Pick onPick={pick} />
        )}
        {step === 2 && selected && (
          <Step2Thesis sector={selected} onBack={() => setStep(1)} onNext={() => setStep(3)} />
        )}
        {step === 3 && selected && (
          <Step3Demo
            sector={selected}
            onBack={() => setStep(2)}
            onFinish={goSimulate}
          />
        )}
      </div>
    </div>
  );
}

function Step1Pick({ onPick }: { onPick: (s: SectorOption) => void }) {
  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        어떤 산업이 가장 궁금하신가요?
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        한 가지 골라주시면, 이 플랫폼이 어떻게 작동하는지 그 섹터로 보여드립니다.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {SECTORS.map((s) => (
          <li key={s.slug}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="group flex h-full w-full flex-col items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-cyan-700 hover:bg-neutral-900"
            >
              <span className="text-3xl">{s.emoji}</span>
              <span className="text-sm font-semibold text-neutral-100 group-hover:text-cyan-200">
                {s.name}
              </span>
              <span className="text-[11px] leading-relaxed text-neutral-500">
                {s.oneLiner}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step2Thesis({
  sector,
  onBack,
  onNext,
}: {
  sector: SectorOption;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="px-6 py-6">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-2xl">{sector.emoji}</span>
        <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
          {sector.name} — 왜 성장할까요?
        </h2>
      </div>
      <div className="rounded-lg border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950 to-neutral-950 p-5">
        <p className="text-sm leading-relaxed text-neutral-100">
          {sector.thesis}
        </p>
      </div>
      <p className="mt-4 text-sm text-neutral-400">
        이 플랫폼은 위와 같은 산업의 성장 가설을, 실제 가정을 하나하나 조정해보면서
        검증할 수 있게 해줍니다. 다음 화면에서 직접 슬라이더를 움직여 보세요.
      </p>
      <footer className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200"
        >
          ← 다른 섹터
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
        >
          한번 움직여 볼까요 →
        </button>
      </footer>
    </div>
  );
}

function Step3Demo({
  sector,
  onBack,
  onFinish,
}: {
  sector: SectorOption;
  onBack: () => void;
  onFinish: () => void;
}) {
  // Demo state — driver value 0..100 maps to "이 슬라이더가 얼마나 떠 있는가".
  // We don't run a live sim from inside the modal; instead, we render an
  // animated mock that captures the *feel* of moving a driver. Real
  // numbers happen on the next page after they click "시작하기".
  const [pct, setPct] = useState(50);
  const delta = ((pct - 50) / 50) * 30; // -30% .. +30% projected stock move
  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        {sector.demoDriver.label} 이 바뀌면 종목은 어떻게 움직일까요?
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        {sector.demoDriver.blurb}
      </p>

      <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-neutral-400">기본값보다 낮게</span>
          <span className="text-neutral-200">슬라이더를 움직여 보세요</span>
          <span className="text-neutral-400">기본값보다 높게</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
        <div className="mt-1 text-center text-[11px] text-neutral-500 tabular-nums">
          현재 가정: 기본값 대비{" "}
          <span
            className={
              Math.abs(pct - 50) < 2
                ? "text-neutral-400"
                : pct > 50
                  ? "font-semibold text-emerald-400"
                  : "font-semibold text-rose-400"
            }
          >
            {pct > 50 ? "+" : ""}
            {((pct - 50) * 1.6).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-neutral-500">
          예상되는 종목 변동 (30일)
        </p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {sector.demoEquities.map((ticker, i) => {
            // Each ticker gets a different sensitivity weight, so they
            // diverge visually as the slider moves — gives a feel for
            // "different stocks respond differently".
            const sens = [1.0, 0.7, 0.55][i] ?? 0.5;
            const stockDelta = delta * sens;
            const positive = stockDelta >= 0;
            return (
              <li
                key={ticker}
                className="rounded border border-neutral-800 bg-neutral-950/60 p-3"
              >
                <div className="font-mono text-sm font-semibold text-neutral-100">
                  {ticker}
                </div>
                <div
                  className={`mt-1 text-lg font-semibold tabular-nums ${
                    Math.abs(stockDelta) < 0.3
                      ? "text-neutral-500"
                      : positive
                        ? "text-emerald-400"
                        : "text-rose-400"
                  }`}
                >
                  {positive ? "+" : ""}
                  {stockDelta.toFixed(1)}%
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">
        실제 플랫폼에서는 위와 같이 슬라이더 하나를 움직이면, 그 섹터에 묶인{" "}
        <span className="text-neutral-300">모든 종목의 30일 예상 변동이
        실시간으로 갱신</span>됩니다. "왜 이 종목이 이만큼 움직이는가" 의 근거도
        한 클릭에 펼쳐볼 수 있습니다.
      </p>

      <footer className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200"
        >
          ← 가설 다시 보기
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
        >
          시작하기 →
        </button>
      </footer>
    </div>
  );
}
