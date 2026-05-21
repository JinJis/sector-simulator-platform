import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";

import {
  fetchSims,
  SECTOR_SERVICE_URL,
  type SimMetadata,
} from "@/lib/sim-client";

export default async function SectorsIndexPage() {
  let sims: SimMetadata[];
  try {
    sims = await fetchSims();
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-neutral-50">
          Tech Sector Simulator
        </h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
        <pre className="mt-4 rounded bg-neutral-900 p-3 text-xs text-neutral-300">
          pnpm dev # sector-service + simulation-service 동시 기동
        </pre>
      </main>
    );
  }

  const userFacing = sims.filter((s) => s.slug !== "placeholder");
  const visibleSims = userFacing.length > 0 ? userFacing : sims;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-6">
      <Breadcrumbs className="mb-3" items={[{ label: "Sectors" }]} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
          Sectors
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-400">
          시뮬레이션 가능한 산업 섹터 목록입니다. 각 섹터는 드라이버 → 산출의
          인과 그래프로 모델링되어 있으며, 슬라이더로 직접 조작하거나 실시간
          데이터로 자동 실행할 수 있습니다.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleSims.map((sim) => (
          <Link
            key={sim.slug}
            href={`/sectors/${sim.slug}`}
            className="group flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/40 p-5 transition hover:border-cyan-700 hover:bg-neutral-900"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-neutral-100 group-hover:text-cyan-300">
                {sim.name}
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                {sim.horizon_years} yr
              </span>
            </div>
            <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-neutral-500">
              {sim.description}
            </p>
            <div className="mt-auto flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-600">
              <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-neutral-400">
                {sim.slug}
              </span>
              <span>{sim.drivers.length} drivers</span>
            </div>
          </Link>
        ))}
      </div>

      {visibleSims.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          등록된 섹터가 없습니다.
        </p>
      )}
    </main>
  );
}
