"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { proposeSectorFromAgent, type AgentDecomposition } from "@/lib/sim-client";

interface Props {
  workflowId: string;
  decomp: AgentDecomposition;
  /** From M22a propose_sector workflows; 0 for decomposition-only kind. */
  edgeCount?: number;
}

export function PromoteToDraftButton({ workflowId, decomp, edgeCount = 0 }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(decomp.slug);
  const [name, setName] = useState(decomp.name);
  const [description, setDescription] = useState(decomp.description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; edges: number } | null>(null);

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await proposeSectorFromAgent({
        workflow_id: workflowId,
        slug: slug.trim() || undefined,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      });
      setDone({ slug: result.sector.slug, edges: result.edge_count });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "promote failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-4">
        <p className="text-sm text-emerald-200">
          ✓ Draft sector <code className="font-mono text-emerald-300">{done.slug}</code>{" "}
          등록됨{done.edges > 0 ? ` (${done.edges} edges 포함)` : ""}. 검토 후 활성화하세요.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <a
            href="/"
            className="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-emerald-200 hover:bg-emerald-800/60"
          >
            Sectors 목록으로 →
          </a>
          <a
            href={`/sectors/${done.slug}`}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            상세 보기
          </a>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-cyan-200">
              Draft sector로 등록하시겠습니까?
            </p>
            <p className="mt-1 text-[11px] text-cyan-300/80">
              `sectors.status = "draft"` 로 저장되며 user app 의 카탈로그에는 보이지 않습니다.
              graph_nodes에 {decomp.drivers.length} drivers + {decomp.intermediates.length}{" "}
              intermediates + {decomp.outputs.length} outputs
              {edgeCount > 0
                ? `, graph_edges 에 ${edgeCount}개 agent-inferred edges (weight=1.0 / origin=agent)`
                : ""}
              가 생성됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-cyan-700 bg-cyan-900/50 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
          >
            + Draft 등록
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-4">
      <h3 className="mb-3 text-sm font-medium text-cyan-200">
        Draft 등록 — 메타데이터 확인
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Slug"
          value={slug}
          onChange={setSlug}
          hint="a-z 0-9 - 만 허용"
        />
        <Field label="Name" value={name} onChange={setName} />
      </div>
      <Field
        label="Description"
        value={description}
        onChange={setDescription}
        multiline
      />
      {error && (
        <p className="mt-3 rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || !slug.trim() || !name.trim()}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "등록 중…" : "확인 · 등록"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <label className="mt-3 flex flex-col gap-1 text-[11px] uppercase tracking-wider text-neutral-500">
      <span className="flex items-baseline gap-2">
        {label}
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      )}
    </label>
  );
}
