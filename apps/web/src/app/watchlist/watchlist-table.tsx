"use client";

/**
 * /watchlist body — renders the user's watched stocks with each
 * row's recent 90d return (pulled from the per-sector basketStats).
 * We deliberately *don't* compute a 30d forward projection here
 * because that depends on whatever driver assumptions the user has
 * open elsewhere — meaningless out of context. Instead, each row
 * links into the per-equity detail page where the user can adjust
 * the underlying sector assumptions and see the projection in
 * context.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  fetchBasketStats,
  removeFromWatchlist,
  type BasketStatsEquity,
  type WatchlistRow,
} from "@/lib/sim-client";

interface Props {
  rows: WatchlistRow[];
}


export function WatchlistTable({ rows: initialRows }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [statsBySectorEquity, setStats] = useState<
    Record<string, Record<string, BasketStatsEquity>>
  >({});

  const sectorSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.equity.sector_slug);
    return [...set];
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sectorSlugs.map((slug) =>
        fetchBasketStats(slug, 90)
          .then((r) => {
            const byEquity: Record<string, BasketStatsEquity> = {};
            for (const e of r.equities) byEquity[e.equity_id] = e;
            return [slug, byEquity] as const;
          })
          .catch(
            () => [slug, {} as Record<string, BasketStatsEquity>] as const,
          ),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, Record<string, BasketStatsEquity>> = {};
      for (const [slug, byEquity] of entries) next[slug] = byEquity;
      setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [sectorSlugs]);

  async function handleRemove(equityId: string) {
    // Optimistic remove. Roll back on error — unlikely, but explicit.
    const before = rows;
    setRows(rows.filter((r) => r.equity_id !== equityId));
    try {
      await removeFromWatchlist(equityId);
    } catch {
      setRows(before);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">종목</th>
            <th className="px-3 py-2 text-left font-medium">섹터</th>
            <th className="px-3 py-2 text-right font-medium">현재 가격</th>
            <th className="px-3 py-2 text-right font-medium">90일 변동</th>
            <th className="px-3 py-2 text-left font-medium">메모</th>
            <th className="px-3 py-2 text-right font-medium">관리</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => {
            const stats =
              statsBySectorEquity[r.equity.sector_slug]?.[r.equity_id];
            const ret90 = stats?.return_pct ?? null;
            const positive = (ret90 ?? 0) >= 0;
            const flag = r.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            const stale = ret90 === null;
            return (
              <tr key={r.id} className="transition hover:bg-neutral-900/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/sectors/${r.equity.sector_slug}/equities/${encodeURIComponent(r.equity.ticker)}`}
                    className="flex items-center gap-2 text-neutral-100 hover:text-cyan-300"
                  >
                    <span aria-hidden>{flag}</span>
                    <span className="font-mono font-semibold">
                      {r.equity.ticker}
                    </span>
                    <span className="text-[11px] text-neutral-500">
                      {r.equity.company_name_local ?? r.equity.company_name}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-[11px] text-neutral-500">
                  <Link
                    href={`/sectors/${r.equity.sector_slug}`}
                    className="hover:text-cyan-400"
                  >
                    {r.equity.sector_slug}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {r.equity.last_close_local !== null
                    ? `${fmtPrice(r.equity.last_close_local)} ${r.equity.currency ?? ""}`
                    : "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${stale ? "text-neutral-500" : positive ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {stale
                    ? "—"
                    : `${positive ? "+" : ""}${ret90!.toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-[11px] text-neutral-400">
                  {r.note || (
                    <span className="text-neutral-700">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleRemove(r.equity_id)}
                    className="text-[11px] text-neutral-500 hover:text-rose-400"
                    title="관심 종목에서 제거"
                    aria-label="관심 종목에서 제거"
                  >
                    제거
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-neutral-800 px-3 py-2 text-[10px] text-neutral-600">
        90일 변동은 실제 가격 변화입니다. 30일 예상 변동은 종목 페이지에서
        시뮬레이션 가정을 조정해 확인하세요.
      </p>
    </div>
  );
}

function fmtPrice(n: number): string {
  if (Math.abs(n) >= 10_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 100)
    return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
