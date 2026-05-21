"use client";

/**
 * Compact read-only renderer for a prediction's linked scenario +
 * AI-generated rationale analysis. Used in my-predictions list,
 * equity detail predictions section, and community hub cards.
 */

import Link from "next/link";
import { useState } from "react";

import type { RationaleAnalysis } from "@/lib/sim-client";

interface Props {
  rationale: string | null;
  rationaleAnalysis: RationaleAnalysis | null;
  scenario: {
    id: string;
    name: string;
    override_count: number;
  } | null;
  sectorSlug: string;
  // When false, render the analysis collapsed (chip only) — used in
  // dense lists where 4-5 predictions stack.
  defaultExpanded?: boolean;
}

const CONFIDENCE_LABEL: Record<RationaleAnalysis["confidence"], string> = {
  low: "낮음",
  med: "보통",
  high: "높음",
};

const CONFIDENCE_TONE: Record<RationaleAnalysis["confidence"], string> = {
  low: "border-rose-900/60 bg-rose-950/40 text-rose-300",
  med: "border-amber-900/60 bg-amber-950/40 text-amber-300",
  high: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
};

export function PredictionRationale({
  rationale,
  rationaleAnalysis,
  scenario,
  sectorSlug,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasContent = !!(rationale || rationaleAnalysis || scenario);
  if (!hasContent) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Linked scenario chip — always visible */}
      {scenario && (
        <Link
          href={`/sectors/${sectorSlug}?scenario=${scenario.id}`}
          className="inline-flex items-baseline gap-2 self-start rounded-full border border-cyan-900/60 bg-cyan-950/30 px-2.5 py-1 text-[10px] text-cyan-200 hover:bg-cyan-900/40"
        >
          <span aria-hidden>🛠</span>
          <span>{scenario.name}</span>
          <span className="text-cyan-400">· {scenario.override_count}개 가정</span>
        </Link>
      )}

      {/* Analysis chip — expandable */}
      {rationaleAnalysis ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-baseline gap-2 self-start rounded-full border border-violet-900/60 bg-violet-950/30 px-2.5 py-1 text-[10px] text-violet-200 hover:bg-violet-900/40"
          aria-expanded={expanded}
        >
          <span aria-hidden>🤖</span>
          <span>AI 분석</span>
          <span
            className={`rounded px-1 py-0.5 text-[9px] ${CONFIDENCE_TONE[rationaleAnalysis.confidence]}`}
          >
            확신도 {CONFIDENCE_LABEL[rationaleAnalysis.confidence]}
          </span>
          {rationaleAnalysis.edited_by_user && (
            <span className="rounded bg-neutral-800 px-1 py-0.5 text-[9px] text-neutral-400">
              ✏️
            </span>
          )}
          <span className="text-violet-400">{expanded ? "▾" : "▸"}</span>
        </button>
      ) : null}

      {/* Free-form rationale (always visible if no analysis; folded under analysis if both) */}
      {rationale && !rationaleAnalysis && (
        <p className="text-[11px] leading-relaxed text-neutral-400">{rationale}</p>
      )}

      {/* Expanded analysis */}
      {expanded && rationaleAnalysis && (
        <div className="rounded-lg border border-violet-900/60 bg-violet-950/20 p-3 text-[11px]">
          <div className="mb-2">
            <p className="mb-0.5 text-[9px] uppercase tracking-wider text-violet-300">
              핵심 가설
            </p>
            <p className="text-neutral-100">{rationaleAnalysis.thesis_summary}</p>
          </div>
          {rationaleAnalysis.supporting_factors.length > 0 && (
            <div className="mb-2">
              <p className="mb-0.5 text-[9px] uppercase tracking-wider text-emerald-400">
                🟢 우호 요인
              </p>
              <ul className="space-y-1">
                {rationaleAnalysis.supporting_factors.slice(0, 3).map((f, i) => (
                  <li key={i}>
                    <span className="font-medium text-neutral-100">{f.title}</span>
                    {f.detail && (
                      <span className="ml-1 text-neutral-400">— {f.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rationaleAnalysis.risk_factors.length > 0 && (
            <div className="mb-1">
              <p className="mb-0.5 text-[9px] uppercase tracking-wider text-rose-400">
                🔴 리스크 요인
              </p>
              <ul className="space-y-1">
                {rationaleAnalysis.risk_factors.slice(0, 3).map((f, i) => (
                  <li key={i}>
                    <span className="font-medium text-neutral-100">{f.title}</span>
                    {f.detail && (
                      <span className="ml-1 text-neutral-400">— {f.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rationale && (
            <details className="mt-2 text-[10px] text-neutral-500">
              <summary className="cursor-pointer hover:text-neutral-300">
                원본 근거 텍스트
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-neutral-400">
                {rationale}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
