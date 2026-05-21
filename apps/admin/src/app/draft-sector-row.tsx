"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  activateSector,
  archiveSector,
  sectorToDraft,
  type SectorRow,
} from "@/lib/sim-client";

const STATUS_TONE: Record<string, string> = {
  live: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
  draft: "border-cyan-900/60 bg-cyan-950/40 text-cyan-300",
  archived: "border-neutral-800 bg-neutral-950 text-neutral-500",
};

export function DraftSectorRow({ sector }: { sector: SectorRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"activate" | "archive" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    label: "activate" | "archive" | "draft",
    op: () => Promise<unknown>,
  ) {
    setBusy(label);
    setError(null);
    try {
      await op();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  const tone = STATUS_TONE[sector.status] ?? STATUS_TONE.draft;

  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
        >
          {sector.status}
        </span>
        <span className="text-sm font-medium text-neutral-100">{sector.name}</span>
        <code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
          {sector.slug}
        </code>
        {sector.agent_workflow_id && (
          <a
            href={`/agent-runs/${sector.agent_workflow_id}`}
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
            title="원본 agent workflow 보기"
          >
            ← agent run
          </a>
        )}
        <span className="ml-auto text-[10px] text-neutral-600">
          {new Date(sector.created_at).toISOString().slice(0, 10)}
        </span>
      </div>
      {sector.description && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
          {sector.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={`/sectors/${sector.slug}`}
          className="text-[10px] text-neutral-400 hover:text-cyan-300"
        >
          상세 →
        </a>
        {sector.status === "draft" && (
          <>
            <Button
              tone="emerald"
              onClick={() =>
                run("activate", () => activateSector(sector.slug))
              }
              busy={busy === "activate"}
              title="user app 카탈로그에 노출 — Python sim 가 있어야 simulate 가능"
            >
              ✓ Activate
            </Button>
            <Button
              tone="neutral"
              onClick={() => run("archive", () => archiveSector(sector.slug))}
              busy={busy === "archive"}
            >
              ✕ Archive
            </Button>
          </>
        )}
        {sector.status === "live" && (
          <>
            <Button
              tone="neutral"
              onClick={() => run("draft", () => sectorToDraft(sector.slug))}
              busy={busy === "draft"}
              title="다시 draft 로 (user app에서 숨김)"
            >
              ↩ Demote to draft
            </Button>
            <Button
              tone="neutral"
              onClick={() => run("archive", () => archiveSector(sector.slug))}
              busy={busy === "archive"}
            >
              ✕ Archive
            </Button>
          </>
        )}
        {sector.status === "archived" && (
          <Button
            tone="cyan"
            onClick={() => run("draft", () => sectorToDraft(sector.slug))}
            busy={busy === "draft"}
            title="draft 로 복귀 — 활성화 전까지 user app에는 보이지 않음"
          >
            ↩ Restore to draft
          </Button>
        )}
        {error && <span className="text-[10px] text-rose-400">{error}</span>}
      </div>
    </li>
  );
}

function Button({
  children,
  onClick,
  busy,
  tone,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  tone: "emerald" | "cyan" | "neutral";
  title?: string;
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/60"
      : tone === "cyan"
        ? "border-cyan-700 bg-cyan-900/40 text-cyan-200 hover:bg-cyan-800/60"
        : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`rounded border px-2 py-0.5 text-[10px] transition disabled:opacity-50 ${cls}`}
    >
      {busy ? "…" : children}
    </button>
  );
}
