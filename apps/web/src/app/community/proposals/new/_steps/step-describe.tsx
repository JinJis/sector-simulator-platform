"use client";

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
          제안 내용을 설명해주세요
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          제목은 한 줄로 핵심을, 본문은 왜 이게 중요한지를 설명합니다.
        </p>
      </header>

      {needsTargetRef && (
        <Field
          label="수정 대상 키"
          hint="Driver 이름 · ticker · capability key 등 기존 항목의 식별자"
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
        label="제목"
        hint={`${title.length}/160 · 최소 5자`}
        error={title.length > 0 && !titleOk ? "조금 더 길게 적어주세요" : null}
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
        label="본문 — 왜 이게 중요한가요?"
        hint={`${body.length}/8000 · 최소 20자`}
        error={body.length > 0 && !bodyOk ? "조금 더 길게 설명해 주세요" : null}
      >
        <textarea
          required
          rows={6}
          maxLength={8000}
          value={body}
          onChange={(e) => onChange({ body: e.target.value })}
          placeholder="이 변경이 왜 섹터의 정확도를 높이는지, 어떤 사용 시나리오를 해결하는지를 적어주세요. 마크다운 렌더링은 추후 추가됩니다."
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
