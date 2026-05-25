"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createProposal,
  type ProposalCreateEvidence,
  type ProposalTargetKind,
} from "@/lib/community-proposal-client";
import { useT } from "@/lib/i18n/provider";
import { WizardProgress, type WizardStep } from "@/lib/wizard/progress";

import { StepDescribe } from "./_steps/step-describe";
import { StepEvidenceReview } from "./_steps/step-evidence-review";
import { StepKind } from "./_steps/step-kind";
import { StepPayload } from "./_steps/step-payload";
import { StepSector, type SectorChoice } from "./_steps/step-sector";
import { EMPTY_DRAFT, type ProposalDraft } from "./_steps/types";

interface Props {
  sectorChoices: SectorChoice[];
  defaultSector?: string;
}

export function ProposalWizard({ sectorChoices, defaultSector }: Props) {
  const router = useRouter();
  const t = useT();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProposalDraft>({
    ...EMPTY_DRAFT,
    sector_slug: defaultSector ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STEPS: WizardStep[] = [
    { id: 1, label: t("proposal.steps.kind") },
    { id: 2, label: t("proposal.steps.sector") },
    { id: 3, label: t("proposal.steps.describe") },
    { id: 4, label: t("proposal.steps.details") },
    { id: 5, label: t("proposal.steps.evidence") },
  ];

  function setKind(kind: ProposalTargetKind) {
    setDraft({ ...draft, target_kind: kind, payload: {} });
    setStep(2);
  }
  function setSector(slug: string) {
    setDraft({ ...draft, sector_slug: slug });
  }
  function patchDescribe(p: {
    title?: string;
    body?: string;
    targetRef?: string;
  }) {
    setDraft({
      ...draft,
      ...(p.title !== undefined ? { title: p.title } : {}),
      ...(p.body !== undefined ? { body: p.body } : {}),
      ...(p.targetRef !== undefined ? { target_ref: p.targetRef } : {}),
    });
  }
  function setPayload(next: Record<string, unknown>) {
    setDraft({ ...draft, payload: next });
  }
  function setEvidence(next: ProposalDraft["evidence"]) {
    setDraft({ ...draft, evidence: next });
  }

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return draft.target_kind !== null;
      case 2:
        return draft.sector_slug.length > 0;
      case 3:
        return (
          draft.title.trim().length >= 5 &&
          draft.body.trim().length >= 20 &&
          (draft.target_kind !== "edit" || draft.target_ref.trim().length > 0)
        );
      case 4:
        return true; // payload fields all optional; admin can fill gaps
      case 5:
        return true;
      default:
        return false;
    }
  })();

  async function handleSubmit() {
    if (!draft.target_kind) return;
    setError(null);
    setSubmitting(true);
    try {
      const evidence: ProposalCreateEvidence[] = draft.evidence
        .map((e): ProposalCreateEvidence | null => {
          const trimmed = e.content.trim();
          if (!trimmed) return null;
          if (e.kind === "url") return { kind: "url", content: trimmed };
          return { kind: "text", content: trimmed };
        })
        .filter((e): e is ProposalCreateEvidence => e !== null);
      const { id } = await createProposal({
        sector_slug: draft.sector_slug,
        target_kind: draft.target_kind,
        target_ref: draft.target_ref.trim() || null,
        title: draft.title.trim(),
        body: draft.body.trim(),
        proposed_payload: draft.payload,
        evidence,
      });
      router.push(`/community/proposals/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <WizardProgress
        steps={STEPS}
        currentStep={step}
        onJump={(s) => s < step && setStep(s)}
      />

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6">
        {step === 1 && (
          <StepKind value={draft.target_kind} onChange={setKind} />
        )}
        {step === 2 && (
          <StepSector
            choices={sectorChoices}
            value={draft.sector_slug}
            onChange={setSector}
          />
        )}
        {step === 3 && draft.target_kind && (
          <StepDescribe
            targetKind={draft.target_kind}
            title={draft.title}
            body={draft.body}
            targetRef={draft.target_ref}
            onChange={patchDescribe}
          />
        )}
        {step === 4 && draft.target_kind && (
          <StepPayload
            targetKind={draft.target_kind}
            payload={draft.payload}
            onChange={setPayload}
          />
        )}
        {step === 5 && draft.target_kind && (
          <StepEvidenceReview
            targetKind={draft.target_kind}
            sectorSlug={draft.sector_slug}
            title={draft.title}
            body={draft.body}
            payload={draft.payload}
            evidence={draft.evidence}
            onChangeEvidence={setEvidence}
          />
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] text-rose-300">
          {error}
        </p>
      )}

      <nav className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("wizard.back")}
        </button>
        <p className="text-[10px] text-neutral-500">
          {t("wizard.step")} {step} / {STEPS.length}
        </p>
        {step < STEPS.length ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
            disabled={!canAdvance}
            className="rounded-lg border border-cyan-700 bg-cyan-900/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("wizard.next")}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg border border-emerald-600 bg-emerald-800 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {submitting ? t("wizard.publishing") : t("proposal.review.publishCta")}
          </button>
        )}
      </nav>
    </div>
  );
}
