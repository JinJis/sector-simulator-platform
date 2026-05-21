import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  fetchMe,
  listMySectors,
  type SectorRow,
} from "@/lib/sim-client";

import { MySectorsTable } from "./my-sectors-table";

export const dynamic = "force-dynamic";

export default async function MySectorsPage() {
  const user = await fetchMe();
  if (!user) {
    redirect("/login?redirect=/my-sectors");
  }
  let rows: SectorRow[];
  try {
    rows = await listMySectors();
  } catch (err) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Breadcrumbs className="mb-3" items={[{ label: "내가 만든 시뮬레이터" }]} />
        <h1 className="text-2xl font-semibold text-neutral-50">
          내가 만든 시뮬레이터
        </h1>
        <p className="mt-4 text-sm text-red-400">
          데이터를 불러올 수 없습니다.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "내가 만든 시뮬레이터" }]} />
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-50">
            내가 만든 시뮬레이터
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            에이전트로 직접 만든 섹터 시뮬레이터들입니다. 각 상태에 따라
            아래 동작이 가능합니다.
          </p>
        </div>
        <Link
          href="/propose"
          className="rounded border border-cyan-700 bg-cyan-950/40 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-900/60"
        >
          + 새로 만들기
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <MySectorsTable rows={rows} />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
      <p className="text-sm text-neutral-300">
        아직 만든 시뮬레이터가 없습니다.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        궁금한 산업이 있다면, 자연어 설명만으로 에이전트가 시뮬레이터를
        구성해 드립니다.
      </p>
      <Link
        href="/propose"
        className="mt-4 inline-block rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
      >
        에이전트로 만들어보기 →
      </Link>
    </div>
  );
}
