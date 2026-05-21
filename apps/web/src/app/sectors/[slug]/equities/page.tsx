"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchEquities, type Equity, type EquityDriverLink } from "@/lib/sim-client";

import { useSector } from "../sector-context";

import { EquitiesTable } from "./equities-table";

export default function SectorEquitiesPage() {
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

  if (error) {
    return (
      <div className="rounded border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
        Equity 데이터 로드 실패: {error}
      </div>
    );
  }
  if (!equities) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
        불러오는 중…
      </div>
    );
  }
  if (equities.length === 0) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
        이 섹터에 등록된 종목이 없습니다.
        <p className="mt-2 text-xs text-neutral-600">
          관리자: <code className="rounded bg-neutral-950 px-1 py-0.5">pnpm db:seed:equities</code>
        </p>
      </div>
    );
  }

  return (
    <EquitiesTable
      equities={equities}
      defaults={defaults}
      driverValues={driverValues}
    />
  );
}

export type { Equity, EquityDriverLink };
