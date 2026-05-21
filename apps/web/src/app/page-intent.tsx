"use client";

/**
 * <PageIntent> — small collapsible "왜 보는가 / 무엇을 찾는가" card
 * that lands at the top of every sector subpage and the standalone
 * /compare route. Uses `<details>` so the keyboard + screen-reader
 * experience is native; defaults open so first-time visitors see
 * the purpose immediately.
 *
 * Centralized content in `page-intents.ts`. This file is just the
 * presentation layer.
 */

import type { PageIntent as PageIntentData } from "./page-intents";

interface Props {
  intent: PageIntentData;
  /** Override the default-open behavior — set false to land collapsed. */
  defaultOpen?: boolean;
}

export function PageIntent({ intent, defaultOpen = true }: Props) {
  return (
    <details
      open={defaultOpen}
      className="group mb-4 rounded-lg border border-neutral-800 bg-neutral-900/30 open:bg-neutral-900/50"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 transition hover:bg-neutral-900/60">
        <span className="mt-0.5 select-none text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
          Why
        </span>
        <span className="flex-1 text-sm leading-relaxed text-neutral-200">
          {intent.pitch}
        </span>
        <span className="select-none text-[10px] text-neutral-600 transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="grid gap-4 border-t border-neutral-800 px-4 py-3 md:grid-cols-2">
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            왜 보는가
          </h3>
          <ul className="space-y-1 text-xs leading-relaxed text-neutral-300">
            {intent.why.map((line, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-neutral-700">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            무엇을 찾는가
          </h3>
          <ul className="space-y-1 text-xs leading-relaxed text-neutral-300">
            {intent.lookFor.map((line, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-neutral-700">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
