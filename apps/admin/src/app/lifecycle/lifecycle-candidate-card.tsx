"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  reviewLifecycleCandidate,
  type LifecycleCandidate,
} from "@/lib/sim-client";

interface Props {
  candidate: LifecycleCandidate;
}

const CATEGORY_LABEL: Record<LifecycleCandidate["category"], string> = {
  "equity.stale_price": "Stale equity",
  "graph_node.orphan": "Orphan node",
  "graph_edge.neutral": "Neutral edge",
  "sector.cold": "Cold sector",
};

const CATEGORY_TONE: Record<LifecycleCandidate["category"], string> = {
  "equity.stale_price": "border-amber-900/60 bg-amber-950/40 text-amber-300",
  "graph_node.orphan": "border-violet-900/60 bg-violet-950/40 text-violet-300",
  "graph_edge.neutral": "border-cyan-900/60 bg-cyan-950/40 text-cyan-300",
  "sector.cold": "border-rose-900/60 bg-rose-950/40 text-rose-300",
};

const DEPRECATE_LABEL: Record<LifecycleCandidate["category"], string> = {
  "equity.stale_price": "Deprecate (log only)",
  "graph_node.orphan": "Deprecate (log only)",
  "graph_edge.neutral": "Approve · delete edge",
  "sector.cold": "Deprecate (log only)",
};

export function LifecycleCandidateCard({ candidate }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [deferDays, setDeferDays] = useState("30");

  async function submit(action: "keep" | "defer" | "approve_deprecate") {
    setStatus("submitting");
    setStatusText("저장 중…");
    try {
      const payload: Parameters<typeof reviewLifecycleCandidate>[0] = {
        category: candidate.category,
        ref_id: candidate.ref_id,
        sector_slug: candidate.sector_slug,
        action,
        reason: reason || undefined,
      };
      if (action === "defer") {
        const days = parseInt(deferDays, 10) || 30;
        const until = new Date();
        until.setUTCDate(until.getUTCDate() + days);
        payload.defer_until = until.toISOString();
      }
      const result = await reviewLifecycleCandidate(payload);
      setStatus("done");
      setStatusText(
        result.applied_change
          ? `✓ 적용됨 (audit ${result.audit_id.slice(0, 8)})`
          : `✓ 기록됨 (audit ${result.audit_id.slice(0, 8)})`,
      );
      // Refresh the server-rendered list so the resolved candidate
      // disappears (or stays, if "keep").
      router.refresh();
    } catch (e) {
      setStatus("error");
      setStatusText(e instanceof Error ? e.message : "실패");
    }
  }

  const tone = CATEGORY_TONE[candidate.category];
  const detailEntries = Object.entries(candidate.detail).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
        >
          {CATEGORY_LABEL[candidate.category]}
        </span>
        <span className="text-sm font-medium text-neutral-100">
          {candidate.label}
        </span>
        {candidate.sector_slug && (
          <span className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
            {candidate.sector_slug}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-neutral-400">
        {candidate.reason}
      </p>

      {detailEntries.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {detailEntries.map(([k, v]) => (
            <li
              key={k}
              className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-500"
            >
              <span className="text-neutral-600">{k}:</span>{" "}
              <span className="text-neutral-300">{String(v)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="사유 (선택)"
          className="flex-1 min-w-[160px] rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600"
          disabled={status === "submitting"}
        />
        <input
          type="number"
          min="1"
          max="365"
          value={deferDays}
          onChange={(e) => setDeferDays(e.target.value)}
          className="w-20 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          title="Defer 일수"
          disabled={status === "submitting"}
        />
        <span className="text-[10px] text-neutral-600">일</span>
        <div className="flex gap-1">
          <Button
            onClick={() => submit("keep")}
            disabled={status === "submitting"}
            tone="neutral"
            title="현 상태 유지를 기록"
          >
            Keep
          </Button>
          <Button
            onClick={() => submit("defer")}
            disabled={status === "submitting"}
            tone="amber"
            title="N일 동안 후보 목록에서 제외"
          >
            Defer
          </Button>
          <Button
            onClick={() => submit("approve_deprecate")}
            disabled={status === "submitting"}
            tone="rose"
            title={DEPRECATE_LABEL[candidate.category]}
          >
            Approve deprecate
          </Button>
        </div>
      </div>

      {statusText && (
        <p
          className={`mt-2 text-[11px] ${
            status === "error"
              ? "text-rose-400"
              : status === "done"
                ? "text-emerald-400"
                : "text-neutral-500"
          }`}
        >
          {statusText}
        </p>
      )}
    </li>
  );
}

function Button({
  children,
  onClick,
  disabled,
  tone,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "neutral" | "amber" | "rose";
  title?: string;
}) {
  const cls =
    tone === "rose"
      ? "border-rose-800/60 bg-rose-950/40 text-rose-300 hover:bg-rose-950/60"
      : tone === "amber"
        ? "border-amber-800/60 bg-amber-950/40 text-amber-300 hover:bg-amber-950/60"
        : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2 py-1 text-[11px] transition disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
