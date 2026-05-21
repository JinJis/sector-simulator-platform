"use client";

/**
 * Per-page contextual tour — M24c.
 *
 * Floating "도움말" button bottom-right. On click, opens a modal
 * that walks through 3-5 sections of the current page in plain
 * Korean. Different content per route (overview / equities /
 * simulate / equity-detail / watchlist / compare-stocks).
 *
 * Opt-in only — no auto-popup. The first-visit onboarding already
 * runs once via `<OnboardingModal>`; this button is for "remind me
 * what this page is for" moments.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PAGE_TOURS, type PageTourEntry } from "./page-tour-content";
import { useFocusTrap } from "./use-focus-trap";

export function PageTour() {
  const pathname = usePathname() ?? "";
  const entry = resolveTour(pathname);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Reset to step 0 every time the modal opens.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Restore focus on close.
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
    } else if (lastFocusedRef.current) {
      lastFocusedRef.current.focus();
    }
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // No tour content for this page → don't render the button at all.
  // Auth pages and admin pages deliberately have no tour.
  if (!entry) return null;

  const total = entry.steps.length;
  const current = entry.steps[step]!;
  const isLast = step === total - 1;
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1 rounded-full border border-cyan-700 bg-cyan-950/80 px-3 py-2 text-xs font-medium text-cyan-200 shadow-lg backdrop-blur transition hover:bg-cyan-900/80"
        title="이 페이지 둘러보기"
        aria-label="이 페이지 둘러보기"
      >
        <span aria-hidden>📍</span>
        <span className="hidden sm:inline">이 페이지 둘러보기</span>
        <span className="sm:hidden">도움말</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="page-tour-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={trapRef}
            tabIndex={-1}
            className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-3">
              <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                {entry.label}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-neutral-500">
                  {step + 1} / {total}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-200"
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>
            </header>
            <div className="px-5 py-4">
              <h2
                id="page-tour-title"
                className="text-base font-semibold text-neutral-50"
              >
                {current.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                {current.body}
              </p>
              {current.tip && (
                <div className="mt-3 rounded border border-cyan-900/40 bg-cyan-950/20 p-3 text-xs leading-relaxed text-cyan-200">
                  💡 {current.tip}
                </div>
              )}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-900/40 px-5 py-3">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-700 disabled:opacity-50"
              >
                이전
              </button>
              {isLast ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
                >
                  닫기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                  className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
                >
                  다음 →
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function resolveTour(pathname: string): PageTourEntry | null {
  // Sort entries by match-key length so more-specific patterns
  // (`/sectors/[slug]/equities/[ticker]`) win over generic ones
  // (`/sectors/[slug]/equities`).
  const keys = Object.keys(PAGE_TOURS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (matches(pathname, key)) return PAGE_TOURS[key]!;
  }
  return null;
}

function matches(pathname: string, pattern: string): boolean {
  // Pattern format: literal segments + `:slug` placeholder. Anchored.
  const segs = pattern.split("/").filter(Boolean);
  const parts = pathname.split("/").filter(Boolean);
  if (segs.length !== parts.length) return false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.startsWith(":")) continue;
    if (s !== parts[i]) return false;
  }
  return true;
}
