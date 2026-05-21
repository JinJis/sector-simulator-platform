"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setUserTier, type AdminUserSummary } from "@/lib/sim-client";

interface Props {
  rows: AdminUserSummary[];
}

export function UserAdminTable({ rows: initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleTier(row: AdminUserSummary) {
    const next = row.tier === "premium" ? "free" : "premium";
    setBusyId(row.id);
    try {
      await setUserTier(row.id, next);
      setRows(rows.map((r) => (r.id === row.id ? { ...r, tier: next } : r)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "변경 실패");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        조건에 맞는 사용자가 없습니다.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">사용자</th>
            <th className="px-3 py-2 text-left font-medium">플랜</th>
            <th className="px-3 py-2 text-right font-medium">섹터</th>
            <th className="px-3 py-2 text-right font-medium">관심 종목</th>
            <th className="px-3 py-2 text-right font-medium">세션</th>
            <th className="px-3 py-2 text-left font-medium">가입일 · 최근 접속</th>
            <th className="px-3 py-2 text-right font-medium">관리</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => {
            const premium = r.tier === "premium";
            return (
              <tr key={r.id} className="transition hover:bg-neutral-900/40">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-neutral-200">
                    {r.email}
                  </div>
                  {r.name && (
                    <div className="text-[11px] text-neutral-500">{r.name}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      premium
                        ? "border-amber-700/60 bg-amber-950/40 text-amber-300"
                        : "border-neutral-800 bg-neutral-950 text-neutral-500"
                    }`}
                  >
                    {premium ? "★ Premium" : "Free"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {r.sector_count}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {r.watchlist_count}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-500">
                  {r.session_count}
                </td>
                <td className="px-3 py-2 text-[11px] text-neutral-500">
                  <div>
                    {new Date(r.created_at).toISOString().slice(0, 10)} 가입
                  </div>
                  {r.last_session_at && (
                    <div className="text-neutral-600">
                      {new Date(r.last_session_at).toISOString().slice(0, 10)} 접속
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleTier(r)}
                    disabled={busyId === r.id}
                    className={`rounded border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
                      premium
                        ? "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-rose-700 hover:text-rose-300"
                        : "border-amber-700 bg-amber-900/40 text-amber-200 hover:bg-amber-800/60"
                    }`}
                  >
                    {busyId === r.id
                      ? "…"
                      : premium
                        ? "Premium 해제"
                        : "★ Premium 부여"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
