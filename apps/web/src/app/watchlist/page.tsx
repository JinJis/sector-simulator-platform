import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  fetchMe,
  fetchWatchlist,
  SECTOR_SERVICE_URL,
  type WatchlistRow,
} from "@/lib/sim-client";

import { WatchlistTable } from "./watchlist-table";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const user = await fetchMe();
  if (!user) {
    redirect("/login?redirect=/watchlist");
  }

  let rows: WatchlistRow[];
  try {
    rows = await fetchWatchlist();
  } catch (err) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-neutral-50">관심 종목</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "관심 종목" }]} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-50">관심 종목</h1>
        <p className="mt-1 text-sm text-neutral-400">
          내가 관심 등록한 종목들. 각 섹터의 현재 시뮬레이션 가정에서 30일 뒤
          어떻게 움직일 것 같은지를 한 화면에서 봅니다.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <WatchlistTable rows={rows} />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
      <p className="text-sm text-neutral-300">
        아직 등록된 관심 종목이 없습니다.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        섹터 페이지의 종목 행이나 종목 상세 페이지에서 ★ 관심 등록 버튼을
        눌러 추가하세요.
      </p>
      <Link
        href="/sectors"
        className="mt-4 inline-block rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
      >
        섹터 둘러보기 →
      </Link>
    </div>
  );
}
