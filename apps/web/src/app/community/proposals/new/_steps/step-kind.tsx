"use client";

import { useT } from "@/lib/i18n/provider";
import type { ProposalTargetKind } from "@/lib/community-proposal-client";

const KIND_DATA: Array<{
  kind: ProposalTargetKind;
  emoji: string;
}> = [
  { kind: "add_driver", emoji: "🎚" },
  { kind: "add_equity", emoji: "📈" },
  { kind: "add_capability", emoji: "🎯" },
  { kind: "add_risk", emoji: "⚠️" },
  { kind: "add_actor", emoji: "👥" },
  { kind: "add_signal_source", emoji: "📡" },
  { kind: "edit", emoji: "✏️" },
  { kind: "other", emoji: "📝" },
];

export function StepKind({
  value,
  onChange,
}: {
  value: ProposalTargetKind | null;
  onChange: (kind: ProposalTargetKind) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          {t("proposal.kind.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("proposal.kind.subheading")}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KIND_DATA.map((c) => {
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
                    {t("proposal.kind.selected")}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-neutral-100">
                {t(`proposal.kind.${c.kind}.title`)}
              </h3>
              <p className="text-[11px] leading-snug text-neutral-400">
                {t(`proposal.kind.${c.kind}.blurb`)}
              </p>
              <p className="mt-1 text-[10px] italic text-neutral-600">
                {t(`proposal.kind.${c.kind}.example`)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
