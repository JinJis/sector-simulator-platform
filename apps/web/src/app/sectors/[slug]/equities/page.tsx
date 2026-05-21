"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { fetchEquities, type Equity, type EquityDriverLink } from "@/lib/sim-client";

import { useSector } from "../sector-context";

import { EquitiesTable } from "./equities-table";

/**
 * Stocks page (URL stays /equities for backwards compat).
 *
 * M23 changed the framing from analyst-grade ("Equities") to
 * beginner-investor-first ("이 섹터의 종목 — 현재 가정에서 어떻게
 * 움직일 예상인지"). The big table itself is the existing M5-M9
 * component; this page just wraps it with friendlier intro copy + a
 * link back to Simulate so users understand the cause-effect chain.
 */
export default function SectorStocksPage() {
  const { meta, defaults, driverValues } = useSector();
  const [equities, setEquities] = useState<Equity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEquities(null);
    setError(null);
    void fetchEquities(meta.slug)
      .then((r) => {
        if (!cancelled) setEquities(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  const dirtyCount = meta.drivers.filter(
    (d) => Math.abs((driverValues[d.name] ?? d.default) - d.default) > 1e-9,
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-50">
          이 섹터의 종목
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-400">
          {dirtyCount === 0 ? (
            <>
              기본 가정 기준입니다. 위쪽{" "}
              <Link
                href={`/sectors/${meta.slug}/simulate`}
                className="text-cyan-400 hover:text-cyan-300"
              >
                시뮬레이션
              </Link>{" "}
              탭에서 가정을 바꾸면, 종목별 30일 예상 변동이 실시간으로 갱신됩니다.
            </>
          ) : (
            <>
              현재 {dirtyCount}개 가정을 기본값과 다르게 설정 중입니다. 아래
              <span className="text-cyan-300"> 30일 예상 변동</span> 이
              실시간으로 갱신됩니다.{" "}
              <Link
                href={`/sectors/${meta.slug}/simulate`}
                className="text-cyan-400 hover:text-cyan-300"
              >
                가정 조정 →
              </Link>
            </>
          )}
        </p>
      </header>

      {error ? (
        <div className="rounded border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
          종목 데이터 로드 실패: {error}
        </div>
      ) : !equities ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
          불러오는 중…
        </div>
      ) : equities.length === 0 ? (
        <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
          이 섹터에 등록된 종목이 없습니다.
          <p className="mt-2 text-xs text-neutral-600">
            관리자: <code className="rounded bg-neutral-950 px-1 py-0.5">pnpm db:seed:equities</code>
          </p>
        </div>
      ) : (
        <EquitiesTable
          equities={equities}
          defaults={defaults}
          driverValues={driverValues}
          sectorSlug={meta.slug}
        />
      )}
    </div>
  );
}

export type { Equity, EquityDriverLink };
