"use client";

/**
 * First-visit onboarding tour. Tracks completion in localStorage
 * (`sss_onboard_v1`) so signed-out users don't get hassled twice.
 * Surfaces automatically on first visit; signup also forces it via
 * `?onboard=1` in the redirect URL. Manual reopen lives on the
 * Settings page.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "sss_onboard_v1";

interface Step {
  title: string;
  body: string;
  href: string | null;
  ctaLabel: string | null;
}

const STEPS: Step[] = [
  {
    title: "Sector Simulator에 오신 것을 환영합니다",
    body:
      "산업을 시뮬레이션 가능한 인과 그래프로 변환하고, 실시간 데이터로 미래를 검증하는 분석 플랫폼입니다. 3-4개 페이지를 둘러보면 핵심 기능이 모두 보입니다.",
    href: null,
    ctaLabel: null,
  },
  {
    title: "1. 섹터 둘러보기",
    body:
      "등록된 섹터 카탈로그에서 관심 사이클을 고르세요. 메모리 반도체 · 우주 데이터센터 · SOFC 연료전지 — 3개 섹터로 시작합니다.",
    href: "/sectors",
    ctaLabel: "Sectors 보기",
  },
  {
    title: "2. Manual 탭에서 가설 테스트",
    body:
      "슬라이더로 드라이버 값을 바꾸면 시뮬레이션 출력 + 종목 30일 projection이 실시간으로 갱신됩니다. \"AI 슈퍼 사이클\" 같은 시나리오를 직접 만들어 보세요.",
    href: "/sectors/memory-semi/manual",
    ctaLabel: "Manual 열기",
  },
  {
    title: "3. Graph로 인과 구조 보기",
    body:
      "드라이버 → 중간 계산 → 산출물 → 종목으로 흐르는 인과 그래프. Edge weight를 클릭으로 조정하면 모델 가정이 바뀌고 즉시 결과에 반영됩니다.",
    href: "/sectors/memory-semi/graph",
    ctaLabel: "Graph 열기",
  },
  {
    title: "4. Narrative로 결론 확인",
    body:
      "현재 드라이버 상태가 함의하는 섹터 thesis + 종목별 upside/downside. 종목을 클릭하면 \"왜 이 숫자인가\" 분해까지 볼 수 있습니다.",
    href: "/sectors/memory-semi/narrative",
    ctaLabel: "Narrative 열기",
  },
];

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams?.get("onboard") === "1";

  useEffect(() => {
    // Suppress on auth pages so the form is what greets the user.
    if (pathname === "/login" || pathname === "/signup") return;
    if (forced) {
      setStep(0);
      setOpen(true);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setOpen(true);
      }
    } catch {
      // localStorage blocked (private mode) — quietly skip.
    }
  }, [forced, pathname]);

  function close(complete: boolean) {
    setOpen(false);
    if (complete) {
      try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      } catch {
        // ignore
      }
    }
    if (forced) {
      // Strip ?onboard=1 so refreshes don't re-trigger.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("onboard");
      router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }

  if (!open) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl">
        <div className="border-b border-neutral-800 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
              Welcome
            </span>
            <span className="text-[11px] text-neutral-500">
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <h2
            id="onboarding-title"
            className="mt-2 text-base font-semibold text-neutral-50"
          >
            {current.title}
          </h2>
        </div>
        <div className="px-5 py-4 text-sm leading-relaxed text-neutral-300">
          {current.body}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-neutral-800 bg-neutral-900/40 px-5 py-3">
          <button
            type="button"
            onClick={() => close(true)}
            className="text-[11px] text-neutral-500 hover:text-neutral-200"
          >
            건너뛰기
          </button>
          <div className="flex items-center gap-2">
            {current.href && current.ctaLabel && (
              <Link
                href={current.href}
                onClick={() => close(true)}
                className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200 hover:border-cyan-700 hover:text-cyan-200"
              >
                {current.ctaLabel}
              </Link>
            )}
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-700"
              >
                이전
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                onClick={() => close(true)}
                className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
              >
                시작하기
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
              >
                다음 →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
