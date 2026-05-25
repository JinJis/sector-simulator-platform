"use client";

/**
 * Shared wizard progress bar. Pure presentational — the parent
 * wizard owns step state and passes `currentStep` (1-indexed) + the
 * step list to render.
 */

export interface WizardStep {
  /** 1-indexed for display. */
  id: number;
  label: string;
  /** Short subtitle / hint shown under the chip on the current step. */
  hint?: string;
}

export function WizardProgress({
  steps,
  currentStep,
  onJump,
}: {
  steps: WizardStep[];
  currentStep: number;
  /** Optional — when provided, prior steps become clickable for jump-back. */
  onJump?: (step: number) => void;
}) {
  return (
    <ol className="flex w-full items-center gap-1 sm:gap-2">
      {steps.map((s, i) => {
        const status: "done" | "active" | "todo" =
          s.id < currentStep ? "done" : s.id === currentStep ? "active" : "todo";
        const clickable = !!onJump && s.id < currentStep;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump?.(s.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition ${
                status === "active"
                  ? "border-cyan-600 bg-cyan-900/40 text-cyan-100"
                  : status === "done"
                    ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  status === "active"
                    ? "bg-cyan-500 text-neutral-900"
                    : status === "done"
                      ? "bg-emerald-500 text-neutral-900"
                      : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {status === "done" ? "✓" : s.id}
              </span>
              <span className="hidden font-medium sm:inline">{s.label}</span>
            </button>
            {i < steps.length - 1 && (
              <span
                className={`h-px flex-1 ${
                  s.id < currentStep ? "bg-emerald-700/60" : "bg-neutral-800"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
