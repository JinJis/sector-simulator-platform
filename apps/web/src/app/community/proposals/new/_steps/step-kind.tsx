"use client";

import type { ProposalTargetKind } from "@/lib/community-proposal-client";

const KIND_CARDS: Array<{
  kind: ProposalTargetKind;
  emoji: string;
  title: string;
  blurb: string;
  example: string;
}> = [
  {
    kind: "add_driver",
    emoji: "🎚",
    title: "Add driver",
    blurb: "New slider on the simulator",
    example: "e.g. rad-hard chip yield %",
  },
  {
    kind: "add_equity",
    emoji: "📈",
    title: "Add equity",
    blurb: "New listed company on a sector",
    example: "e.g. add TSMC to memory-semi",
  },
  {
    kind: "add_capability",
    emoji: "🎯",
    title: "Add capability",
    blurb: "New vision capability + score",
    example: "e.g. quantum error correction",
  },
  {
    kind: "add_risk",
    emoji: "⚠️",
    title: "Add risk",
    blurb: "External / political / supply",
    example: "e.g. ITAR export controls",
  },
  {
    kind: "add_actor",
    emoji: "👥",
    title: "Add actor",
    blurb: "Company · lab · gov body",
    example: "e.g. add JPL to space-data-center",
  },
  {
    kind: "add_signal_source",
    emoji: "📡",
    title: "Add signal source",
    blurb: "New keyword set for ingest",
    example: "e.g. \"solid-state battery\" for arXiv",
  },
  {
    kind: "edit",
    emoji: "✏️",
    title: "Edit existing",
    blurb: "Fix / refine an existing row",
    example: "e.g. update Samsung's blurb",
  },
  {
    kind: "other",
    emoji: "📝",
    title: "Freeform",
    blurb: "Anything else — admin reviews",
    example: "Won't auto-apply",
  },
];

export function StepKind({
  value,
  onChange,
}: {
  value: ProposalTargetKind | null;
  onChange: (kind: ProposalTargetKind) => void;
}) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          무엇을 제안하시나요?
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          섹터의 어떤 요소를 더하거나 고치고 싶은지 골라주세요. 각 카드를
          클릭하면 다음 단계로 넘어갑니다.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KIND_CARDS.map((c) => {
          const active = value === c.kind;
          return (
            <button
              key={c.kind}
              type="button"
              onClick={() => onChange(c.kind)}
              className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition ${
                active
                  ? "border-cyan-600 bg-cyan-900/30 shadow-lg shadow-cyan-900/30"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
              }`}
            >
              <div className="flex w-full items-baseline justify-between">
                <span className="text-2xl">{c.emoji}</span>
                {active && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                    selected
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-neutral-100">
                {c.title}
              </h3>
              <p className="text-[11px] leading-snug text-neutral-400">
                {c.blurb}
              </p>
              <p className="mt-1 text-[10px] italic text-neutral-600">
                {c.example}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
