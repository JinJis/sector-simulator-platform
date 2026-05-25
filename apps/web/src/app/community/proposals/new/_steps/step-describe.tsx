"use client";

import { useT } from "@/lib/i18n/provider";
import type { ProposalTargetKind } from "@/lib/community-proposal-client";

export function StepDescribe({
  targetKind,
  title,
  body,
  targetRef,
  onChange,
}: {
  targetKind: ProposalTargetKind;
  title: string;
  body: string;
  targetRef: string;
  onChange: (patch: { title?: string; body?: string; targetRef?: string }) => void;
}) {
  const t = useT();
  const needsTargetRef = targetKind === "edit";
  const titlePlaceholder: Record<ProposalTargetKind, string> = {
    add_driver: "Add radiation-hardened chip yield driver",
    add_equity: "Add TSMC (2330.TW) to memory-semi",
    add_capability: "Add quantum error correction capability",
    add_risk: "ITAR export controls — rad-hard chips",
    add_actor: "Add JPL to space-data-center",
    add_signal_source: "\"solid-state battery\" keyword set",
    edit: "Fix Samsung's blurb to reflect HBM4 announcement",
    other: "Suggest a new vision frame",
  };

  const titleOk = title.trim().length >= 5;
  const bodyOk = body.trim().length >= 20;

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          {t("proposal.describe.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("proposal.describe.subheading")}
        </p>
      </header>

      {needsTargetRef && (
        <Field
          label={t("proposal.describe.targetRef")}
          hint={t("proposal.describe.targetRefHint")}
        >
          <input
            value={targetRef}
            onChange={(e) => onChange({ targetRef: e.target.value })}
            placeholder="e.g. rad_hard_compute"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
          />
        </Field>
      )}

      <Field
        label={t("proposal.describe.title")}
        hint={`${title.length}/160`}
        error={title.length > 0 && !titleOk ? t("proposal.describe.titleMinErr") : null}
      >
        <input
          required
          maxLength={160}
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={titlePlaceholder[targetKind]}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <Field
        label={t("proposal.describe.body")}
        hint={`${body.length}/8000`}
        error={body.length > 0 && !bodyOk ? t("proposal.describe.bodyMinErr") : null}
      >
        <textarea
          required
          rows={6}
          maxLength={8000}
          value={body}
          onChange={(e) => onChange({ body: e.target.value })}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm leading-relaxed text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
          {label}
        </label>
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}
