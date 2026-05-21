"use client";

/**
 * /community/suggestions browser — list + filter + create + vote.
 *
 * Keeps everything in one client component so the user's vote
 * round-trip can refresh the score in-place without going through
 * `router.refresh()`.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  createSuggestion,
  fetchRecentSuggestions,
  fetchSuggestionsForSector,
  voteSuggestion,
  type SuggestionKind,
  type SuggestionRow,
} from "@/lib/sim-client";

const KIND_OPTIONS: Array<{ value: SuggestionKind; label: string }> = [
  { value: "add_driver", label: "드라이버 추가" },
  { value: "remove_driver", label: "드라이버 제거" },
  { value: "add_equity", label: "종목 추가" },
  { value: "remove_equity", label: "종목 제거" },
  { value: "rename_node", label: "이름 변경" },
  { value: "rewire_edge", label: "엣지 수정" },
  { value: "other", label: "기타" },
];

interface SectorOption {
  slug: string;
  name: string;
}

interface Props {
  initialRows: SuggestionRow[];
  initialSectorSlug: string | null;
  sectorOptions: SectorOption[];
  signedIn: boolean;
}

export function SuggestionsBrowser({
  initialRows,
  initialSectorSlug,
  sectorOptions,
  signedIn,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sectorSlug, setSectorSlug] = useState<string>(initialSectorSlug ?? "");
  const [rows, setRows] = useState(initialRows);
  const [creating, setCreating] = useState(false);

  // Refetch when sector filter changes (don't full-refresh — keeps
  // vote-button focus state).
  useEffect(() => {
    let cancelled = false;
    (sectorSlug
      ? fetchSuggestionsForSector(sectorSlug)
      : fetchRecentSuggestions(50)
    ).then((next) => {
      if (cancelled) return;
      setRows(next);
    });
    return () => {
      cancelled = true;
    };
  }, [sectorSlug]);

  function onSectorChange(next: string) {
    setSectorSlug(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next) params.set("sector", next);
    else params.delete("sector");
    router.replace(`/community/suggestions${params.toString() ? `?${params}` : ""}`);
  }

  async function onVote(suggestion_id: string, value: -1 | 0 | 1) {
    if (!signedIn) {
      router.push("/login?redirect=/community/suggestions");
      return;
    }
    const result = await voteSuggestion({ suggestion_id, value });
    setRows((prev) =>
      prev.map((r) =>
        r.id === suggestion_id
          ? { ...r, score: result.score, my_vote: result.my_vote }
          : r,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            섹터
          </label>
          <select
            value={sectorSlug}
            onChange={(e) => onSectorChange(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          >
            <option value="">(전체)</option>
            {sectorOptions.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!signedIn) {
              router.push("/login?redirect=/community/suggestions");
              return;
            }
            if (!sectorSlug) {
              alert("먼저 섹터를 선택해 주세요.");
              return;
            }
            setCreating((v) => !v);
          }}
          className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-800/60"
        >
          + 새 제안
        </button>
      </div>

      {creating && sectorSlug && signedIn && (
        <CreateSuggestionForm
          sectorSlug={sectorSlug}
          onCreated={(next) => {
            setRows((prev) => [next, ...prev]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          {sectorSlug
            ? "이 섹터에는 아직 제안이 없습니다. 첫 제안을 등록해 보세요."
            : "아직 등록된 제안이 없습니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => (
            <SuggestionCard
              key={s.id}
              row={s}
              onVote={onVote}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  row,
  onVote,
}: {
  row: SuggestionRow;
  onVote: (id: string, value: -1 | 0 | 1) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const kindLabel = useMemo(() => {
    return KIND_OPTIONS.find((k) => k.value === row.kind)?.label ?? row.kind;
  }, [row.kind]);
  const my = row.my_vote ?? 0;

  async function vote(value: -1 | 1) {
    if (busy) return;
    setBusy(true);
    try {
      const next = my === value ? 0 : value;
      await onVote(row.id, next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => vote(1)}
            disabled={busy}
            aria-pressed={my === 1}
            title={my === 1 ? "추천 취소" : "추천"}
            className={`rounded border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
              my === 1
                ? "border-emerald-700 bg-emerald-900/40 text-emerald-200"
                : "border-neutral-800 text-neutral-400 hover:border-emerald-700 hover:text-emerald-300"
            }`}
          >
            ▲
          </button>
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
              row.score > 0
                ? "text-emerald-400"
                : row.score < 0
                  ? "text-rose-400"
                  : "text-neutral-400"
            }`}
          >
            {row.score > 0 ? "+" : ""}
            {row.score}
          </span>
          <button
            type="button"
            onClick={() => vote(-1)}
            disabled={busy}
            aria-pressed={my === -1}
            title={my === -1 ? "비추천 취소" : "비추천"}
            className={`rounded border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
              my === -1
                ? "border-rose-700 bg-rose-900/40 text-rose-200"
                : "border-neutral-800 text-neutral-400 hover:border-rose-700 hover:text-rose-300"
            }`}
          >
            ▼
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
              {kindLabel}
            </span>
            <h3 className="font-medium text-neutral-100">{row.title}</h3>
            <span className="ml-auto text-[10px] text-neutral-500">
              {row.sector_slug} · {row.user_label} ·{" "}
              {new Date(row.created_at).toISOString().slice(0, 10)}
            </span>
          </div>
          {row.body && (
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-400">
              {row.body}
            </p>
          )}
          <p className="mt-2 text-[10px] text-neutral-600">
            상태: {statusLabel(row.status)}
          </p>
        </div>
      </div>
    </li>
  );
}

function CreateSuggestionForm({
  sectorSlug,
  onCreated,
  onCancel,
}: {
  sectorSlug: string;
  onCreated: (row: SuggestionRow) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<SuggestionKind>("add_equity");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (title.trim().length < 3) {
      setError("제목은 3자 이상이어야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createSuggestion({
        sector_slug: sectorSlug,
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4"
    >
      <h3 className="mb-3 text-sm font-medium text-cyan-200">새 제안 — {sectorSlug}</h3>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as SuggestionKind)}
          className="rounded border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs text-neutral-200"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: NVDA를 memory-semi 종목으로 추가"
          className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="왜 추가/제거가 필요한지, 어떤 근거가 있는지 적어주세요. (선택)"
        className="mt-3 w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200"
      />
      {error && (
        <p className="mt-2 rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-neutral-500 hover:text-neutral-200"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500 disabled:opacity-50"
        >
          {busy ? "등록 중…" : "제안 등록"}
        </button>
      </div>
    </form>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "open": return "검토 대기";
    case "under_review": return "검토 중";
    case "approved": return "승인됨 ✓";
    case "rejected": return "거절됨";
    case "withdrawn": return "철회됨";
    default: return s;
  }
}
