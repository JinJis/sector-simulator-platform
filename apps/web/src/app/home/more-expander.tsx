"use client";

/**
 * M23 home — "더 보기" expander.
 *
 * The previous home page surfaced search + biggest movers table +
 * recent scenarios + audit feed all at once on first paint. That's
 * useful for an analyst but overwhelming for a first-time visitor.
 *
 * We move all four into a single collapsible block at the bottom of
 * the home page. Power users can open it (state persists in
 * localStorage so once-opened stays open) without anything being
 * removed from the product.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  AuditLog,
  Scenario,
  SimMetadata,
} from "@/lib/sim-client";

import { HomeSearch, type SearchItem } from "./home-search";

const STORAGE_KEY = "sss_home_more_open";

interface MoverLike {
  equity: {
    id: string;
    ticker: string;
    iso_country: string;
    sector_slug: string;
    company_name: string;
    company_name_local: string | null;
  };
  sectorName: string;
  sectorSlug: string;
  stats: {
    return_pct: number | null;
    beta: number | null;
    volatility_annual_pct: number | null;
  };
}

interface Props {
  searchItems: SearchItem[];
  movers: MoverLike[];
  recentScenarios: Scenario[];
  sims: SimMetadata[];
  audit: AuditLog[];
}

export function MoreExpander({
  searchItems,
  movers,
  recentScenarios,
  sims,
  audit,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "1") setOpen(true);
    } catch {
      // ignore
    }
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/30 px-5 py-3 transition hover:bg-neutral-900/60"
      >
        <div className="text-left">
          <div className="text-sm font-medium text-neutral-200">
            더 보기
          </div>
          <div className="text-[11px] text-neutral-500">
            전체 검색 · 상위 변동 종목 · 최근 시나리오 · 활동 기록
          </div>
        </div>
        <span className={`text-[10px] text-neutral-500 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 grid gap-6">
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              검색
            </h3>
            <HomeSearch items={searchItems} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                상위 변동 종목 · 최근 90일
              </h3>
              <MoversTable movers={movers} />
            </div>
            <div className="lg:col-span-2">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                최근 저장된 시나리오
              </h3>
              <RecentScenarios scenarios={recentScenarios} sims={sims} />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              최근 활동 — 그래프 · 시나리오 변경 기록
            </h3>
            <AuditFeed entries={audit} />
          </div>
        </div>
      )}
    </section>
  );
}

function MoversTable({ movers }: { movers: MoverLike[] }) {
  if (movers.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        가격 히스토리가 아직 적재되지 않았습니다.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/60 text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">종목</th>
            <th className="px-3 py-2 text-left font-medium">섹터</th>
            <th className="px-3 py-2 text-right font-medium">90일</th>
            <th className="px-3 py-2 text-right font-medium">β</th>
            <th className="px-3 py-2 text-right font-medium">변동성(연)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {movers.map((m) => {
            const ret = m.stats.return_pct!;
            const positive = ret >= 0;
            const flag = m.equity.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            return (
              <tr key={m.equity.id} className="transition hover:bg-neutral-900">
                <td className="px-3 py-2">
                  <Link
                    href={`/sectors/${m.equity.sector_slug}/equities/${encodeURIComponent(m.equity.ticker)}`}
                    className="flex items-center gap-2 text-neutral-100 hover:text-cyan-300"
                  >
                    <span aria-hidden>{flag}</span>
                    <span className="font-medium">{m.equity.ticker}</span>
                    <span className="text-[11px] text-neutral-500">
                      {m.equity.company_name_local ?? m.equity.company_name}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-[11px] text-neutral-500">
                  {m.sectorName}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${positive ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {positive ? "+" : ""}
                  {ret.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {m.stats.beta !== null ? m.stats.beta.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-neutral-300">
                  {m.stats.volatility_annual_pct !== null
                    ? `${m.stats.volatility_annual_pct.toFixed(0)}%`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentScenarios({
  scenarios,
  sims,
}: {
  scenarios: Scenario[];
  sims: SimMetadata[];
}) {
  if (scenarios.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        저장된 시나리오가 없습니다. 섹터의 시뮬레이션에서 슬라이더를 조정해 저장해보세요.
      </div>
    );
  }
  const simBySlug = new Map(sims.map((s) => [s.slug, s]));
  return (
    <ul className="flex flex-col gap-2">
      {scenarios.map((sc) => {
        const sim = simBySlug.get(sc.sector_slug);
        const driverCount = Object.keys(sc.driver_overrides).length;
        return (
          <li key={sc.id}>
            <Link
              href={`/sectors/${sc.sector_slug}?scenario=${sc.id}`}
              className="group block rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 transition hover:border-cyan-700 hover:bg-neutral-900"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-neutral-100 group-hover:text-cyan-300">
                  {sc.name}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-600">
                  {driverCount}개 가정
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span>{sim?.name ?? sc.sector_slug}</span>
                <span>·</span>
                <span>{formatRelative(sc.updated_at)}</span>
                {sc.author_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{sc.author_label}</span>
                  </>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function AuditFeed({ entries }: { entries: AuditLog[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
        아직 기록된 변경이 없습니다.
      </div>
    );
  }
  return (
    <ol className="overflow-hidden divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900/40">
      {entries.map((e) => {
        const summary = describeAudit(e);
        const tone = toneForAction(e.action);
        return (
          <li key={e.id} className="flex items-baseline gap-3 px-3 py-2">
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
            >
              {shortAction(e.action)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-neutral-200">{summary}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-600">
                {e.sector_slug && (
                  <Link
                    href={`/sectors/${e.sector_slug}`}
                    className="hover:text-cyan-400"
                  >
                    {e.sector_slug}
                  </Link>
                )}
                <span>·</span>
                <span>{formatRelative(e.created_at)}</span>
                {e.author_label && (
                  <>
                    <span>·</span>
                    <span className="truncate">{e.author_label}</span>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// -------- helpers (lifted from the old home page) --------

function shortAction(action: string): string {
  const idx = action.indexOf(".");
  return idx === -1 ? action : action.slice(idx + 1);
}

function toneForAction(action: string): string {
  if (action.startsWith("graph.")) return "border-cyan-900/60 bg-cyan-950/40 text-cyan-300";
  if (action.startsWith("scenario.")) return "border-amber-900/60 bg-amber-950/40 text-amber-300";
  if (action.startsWith("lifecycle.")) return "border-rose-900/60 bg-rose-950/40 text-rose-300";
  if (action.startsWith("sector.")) return "border-emerald-900/60 bg-emerald-950/40 text-emerald-300";
  return "border-neutral-800 bg-neutral-950 text-neutral-400";
}

function describeAudit(e: AuditLog): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "graph.upsertEdge":
      return `엣지 ${asString(p.source_key)} → ${asString(p.target_key)}`;
    case "graph.deleteEdge":
      return `엣지 삭제 ${asString(p.source_key)} → ${asString(p.target_key)}`;
    case "graph.upsertNode":
      return `노드 ${asString(p.node_key)}`;
    case "graph.deleteNode":
      return `노드 삭제 ${asString(p.node_key)}`;
    case "graph.resetToDefaults":
      return `${asString(p.sector_slug)} 그래프 재구성`;
    case "scenario.create":
      return `시나리오 생성 · ${asString(p.name)}`;
    case "scenario.update":
      return `시나리오 수정`;
    case "scenario.delete":
      return `시나리오 삭제`;
    case "sector.proposeFromAgent":
      return `에이전트 → 신규 draft 섹터 등록`;
    case "sector.activate":
      return `섹터 활성화 · ${asString(p.sector_slug)}`;
    case "sector.archive":
      return `섹터 보관`;
    default:
      return e.action;
  }
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function formatRelative(input: Date | string): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}일 전`;
  const date = new Date(t);
  return date.toISOString().slice(0, 10);
}
