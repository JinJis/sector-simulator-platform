"use client";

/**
 * /my-sectors table — lists the current user's agent-generated
 * sectors with status badges + lifecycle actions (view + delete).
 *
 * Activation isn't exposed here on purpose: the propose flow auto-
 * activates on "내 시뮬레이터로 만들기 →". Users who want to demote
 * or archive should use the admin app (or future explicit toggle).
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import { deleteMySector, type SectorRow } from "@/lib/sim-client";

interface Props {
  rows: SectorRow[];
}

const STATUS_TONE: Record<string, string> = {
  live: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
  draft: "border-cyan-900/60 bg-cyan-950/40 text-cyan-300",
  archived: "border-neutral-800 bg-neutral-950 text-neutral-500",
};

const STATUS_LABEL: Record<string, string> = {
  live: "활성",
  draft: "초안",
  archived: "보관",
};

export function MySectorsTable({ rows: initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function confirmDelete(slug: string) {
    const before = rows;
    setRows(rows.filter((r) => r.slug !== slug));
    setPendingDelete(null);
    try {
      await deleteMySector(slug);
      router.refresh();
    } catch (err) {
      setRows(before);
      alert(err instanceof Error ? err.message : "삭제 실패");
    }
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const tone = STATUS_TONE[r.status] ?? STATUS_TONE.draft;
        const label = STATUS_LABEL[r.status] ?? r.status;
        return (
          <li
            key={r.slug}
            className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
              >
                {label}
              </span>
              <Link
                href={`/sectors/${r.slug}`}
                className="text-base font-semibold text-neutral-100 hover:text-cyan-300"
              >
                {r.name}
              </Link>
              <code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
                {r.slug}
              </code>
              <span className="ml-auto text-[10px] text-neutral-600">
                {new Date(r.created_at).toISOString().slice(0, 10)} 생성
              </span>
            </div>
            {r.description && (
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-neutral-500">
                {r.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                href={`/sectors/${r.slug}`}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                열어보기 →
              </Link>
              <Link
                href={`/sectors/${r.slug}/simulate`}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                시뮬레이션 →
              </Link>
              {pendingDelete === r.slug ? (
                <>
                  <button
                    type="button"
                    onClick={() => confirmDelete(r.slug)}
                    className="text-[11px] font-semibold text-rose-400 hover:text-rose-300"
                  >
                    정말 삭제하시겠어요?
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="text-[11px] text-neutral-500 hover:text-neutral-200"
                  >
                    취소
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingDelete(r.slug)}
                  className="ml-auto text-[11px] text-neutral-500 hover:text-rose-400"
                >
                  삭제
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
