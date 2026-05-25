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

import { useT } from "@/lib/i18n/provider";

import { useFocusTrap } from "./use-focus-trap";

const STORAGE_KEY = "sss_onboard_v3";

interface VisionOption {
  slug: string;
  name: string;
  emoji: string;
  /** Picker-card tagline (translation key). */
  taglineKey: string;
  /** Step 2 framing question — kept English for analytical clarity. */
  question: string;
  /** Step 2 paragraph context (translation key). */
  briefKey: string;
  /** Step 3 headline values. */
  preview: {
    composite: number;
    delta90d: number;
    etaYear: number;
    /** Translation key OR literal English string. */
    bindingKey: string;
    bindingLiteral?: boolean;
  };
}

const VISIONS: VisionOption[] = [
  {
    slug: "space-data-center",
    name: "Space Data Centers",
    emoji: "🛰️",
    taglineKey: "vision.space-data-center.tagline",
    question: "By when will compute in orbit be commercially viable?",
    briefKey: "vision.space-data-center.brief",
    preview: {
      composite: 73,
      delta90d: 8,
      etaYear: 2034,
      bindingKey: "Radiation-hard compute",
      bindingLiteral: true,
    },
  },
  {
    slug: "memory-semi",
    name: "AI Memory Supercycle",
    emoji: "💾",
    taglineKey: "vision.memory-semi.tagline",
    question: "Does the AI HBM cycle hold for the next 5 years?",
    briefKey: "vision.memory-semi.brief",
    preview: {
      composite: 64,
      delta90d: 3,
      etaYear: 2030,
      bindingKey: "vision.binding.tbd",
    },
  },
  {
    slug: "sofc",
    name: "Solid Oxide Fuel Cells at Grid Scale",
    emoji: "⚡",
    taglineKey: "vision.sofc.tagline",
    question: "Can SOFCs deliver grid-parity LCOE by 2035?",
    briefKey: "vision.sofc.brief",
    preview: {
      composite: 42,
      delta90d: 1,
      etaYear: 2038,
      bindingKey: "vision.binding.tbd",
    },
  },
];

export function OnboardingModal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams?.get("onboard") === "1";
  const t = useT();

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
            {t("onboarding.guideLabel")}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-neutral-500">{step} / 3</span>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              {t("onboarding.skip")}
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
  const t = useT();
  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        {t("onboarding.step1.heading")}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        {t("onboarding.step1.sub")}
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {VISIONS.map((v) => {
          const tagline = t(v.taglineKey);
          return (
            <li key={v.slug}>
              <button
                type="button"
                onClick={() => onPick(v)}
                className="group flex h-full w-full flex-col items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-left transition hover:border-cyan-700 hover:bg-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                aria-label={`${v.name} — ${tagline}`}
              >
                <span className="text-3xl" aria-hidden="true">
                  {v.emoji}
                </span>
                <span className="text-sm font-semibold text-neutral-100 group-hover:text-cyan-200">
                  {v.name}
                </span>
                <span className="text-[11px] leading-relaxed text-neutral-500">
                  {tagline}
                </span>
              </button>
            </li>
          );
        })}
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
  const t = useT();
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
          {t("onboarding.step2.question")}
        </p>
        <p className="mt-2 text-lg italic leading-relaxed text-neutral-100">
          &ldquo;{vision.question}&rdquo;
        </p>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-neutral-400">
        {t(vision.briefKey)}
      </p>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        {t("onboarding.step2.context")}
      </p>
      <footer className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          {t("onboarding.step2.back")}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {t("onboarding.step2.next")}
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
  const t = useT();
  const { composite, delta90d, etaYear, bindingKey, bindingLiteral } = vision.preview;
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

  const bindingText = bindingLiteral ? bindingKey : t(bindingKey);

  return (
    <div className="px-6 py-6">
      <h2 id="onboarding-title" className="text-lg font-semibold text-neutral-50">
        {t("onboarding.step3.heading")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        {t("onboarding.step3.sub")}
      </p>

      <div
        className="mt-5 grid gap-3 sm:grid-cols-3"
        role="group"
        aria-label="Hero headline metrics"
      >
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            {t("onboarding.step3.feasibility")}
          </p>
          <p
            className={`mt-2 font-mono text-4xl font-semibold leading-none tabular-nums ${compositeColor}`}
          >
            {composite}
          </p>
          <p className="mt-1 text-[10px] text-neutral-500">/ 100</p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            {t("onboarding.step3.feasibilityHint")}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            {t("onboarding.step3.delta")}
          </p>
          <p
            className={`mt-2 font-mono text-4xl font-semibold leading-none tabular-nums ${deltaColor}`}
          >
            {deltaSign}
            {Math.abs(delta90d)}
          </p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            {t("onboarding.step3.deltaHint")}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            {t("onboarding.step3.eta")}
          </p>
          <p className="mt-2 font-mono text-4xl font-semibold leading-none tabular-nums text-neutral-100">
            {etaYear}
          </p>
          <p className="mt-3 text-[11px] leading-snug text-neutral-400">
            {t("onboarding.step3.etaHint")}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/10 p-3">
        <p className="text-[11px] text-amber-300">
          <span aria-hidden="true">⚠</span>{" "}
          {t("onboarding.step3.binding")}: <span className="font-medium">{bindingText}</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-amber-200/70">
          {t("onboarding.step3.bindingHint")}
        </p>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">
        {t("onboarding.step3.full")}
      </p>

      <footer className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          {t("onboarding.step3.back")}
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {t("onboarding.step3.finishPrefix")}{vision.name}{t("onboarding.step3.finishSuffix")}
        </button>
      </footer>
    </div>
  );
}
