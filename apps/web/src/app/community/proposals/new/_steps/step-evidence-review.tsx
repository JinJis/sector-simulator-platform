"use client";

import type { ProposalTargetKind } from "@/lib/community-proposal-client";

import type { EvidenceRow } from "./types";

const KIND_LABEL: Record<ProposalTargetKind, string> = {
  add_driver: "Add driver",
  add_equity: "Add equity",
  add_capability: "Add capability",
  add_risk: "Add risk",
  add_actor: "Add actor",
  add_signal_source: "Add signal source",
  edit: "Edit existing",
  other: "Freeform",
};

export function StepEvidenceReview({
  targetKind,
  sectorSlug,
  title,
  body,
  payload,
  evidence,
  onChangeEvidence,
}: {
  targetKind: ProposalTargetKind;
  sectorSlug: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  evidence: EvidenceRow[];
  onChangeEvidence: (next: EvidenceRow[]) => void;
}) {
  function add(kind: "text" | "url") {
    onChangeEvidence([...evidence, { kind, content: "" }]);
  }
  function update(i: number, patch: Partial<EvidenceRow>) {
    onChangeEvidence(evidence.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function remove(i: number) {
    onChangeEvidence(evidence.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          근거 자료 + 최종 확인
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          근거가 풍부할수록 빨리 채택됩니다. URL · 자유글 모두 가능
          (이미지/PDF 업로드는 추후 추가).
        </p>
      </header>

      {/* Evidence editor */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200">
            근거 자료
          </h3>
          <div className="flex gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => add("url")}
              className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1 text-cyan-100 hover:bg-cyan-800/60"
            >
              + URL
            </button>
            <button
              type="button"
              onClick={() => add("text")}
              className="rounded border border-neutral-700 px-3 py-1 text-neutral-300 hover:border-neutral-500"
            >
              + 자유글
            </button>
          </div>
        </div>
        {evidence.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-4 text-center text-[11px] text-neutral-500">
            아직 근거가 없습니다. URL 또는 자유글로 보탬을 추가하세요.
          </p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((e, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-2"
              >
                <span className="shrink-0 self-start rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                  {e.kind === "url" ? "🔗 URL" : "📝 Note"}
                </span>
                {e.kind === "url" ? (
                  <input
                    type="url"
                    value={e.content}
                    onChange={(ev) => update(i, { content: ev.target.value })}
                    placeholder="https://..."
                    className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
                  />
                ) : (
                  <textarea
                    rows={2}
                    value={e.content}
                    onChange={(ev) => update(i, { content: ev.target.value })}
                    placeholder="자유 형식 근거 한 단락"
                    className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
                  />
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 self-start rounded text-[14px] text-neutral-600 hover:text-rose-400"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Review */}
      <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-4">
        <h3 className="text-sm font-semibold text-emerald-200">제출 전 확인</h3>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
          <Row label="종류" value={KIND_LABEL[targetKind]} />
          <Row label="섹터" value={sectorSlug} mono />
          <Row label="제목" value={title} wide />
          <Row label="근거" value={`${evidence.length}건`} />
        </dl>
        <details className="mt-3 rounded border border-emerald-900/30 bg-neutral-950/40">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-emerald-300">
            본문 + payload 미리보기
          </summary>
          <div className="space-y-3 border-t border-emerald-900/30 p-3 text-[11px]">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-500">
                본문
              </p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-300">{body}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-neutral-500">
                Proposed payload
              </p>
              <pre className="mt-1 max-h-48 overflow-auto rounded border border-neutral-900 bg-neutral-950 p-2 text-[10px] text-neutral-400">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[9px] uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 ${mono ? "font-mono text-[11px] text-cyan-300" : "text-neutral-200"}`}
      >
        {value || <span className="italic text-neutral-600">(empty)</span>}
      </dd>
    </div>
  );
}
