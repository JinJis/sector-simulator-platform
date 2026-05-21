import { Breadcrumbs } from "@platform/ui";

import {
  listAdminUsers,
  SECTOR_SERVICE_URL,
  type AdminUserListResult,
} from "@/lib/sim-client";

import { UserAdminTable } from "./user-admin-table";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  tier?: "free" | "premium";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let result: AdminUserListResult;
  try {
    result = await listAdminUsers({
      search: params.search,
      tier: params.tier,
    });
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Breadcrumbs className="mb-3" items={[{ label: "Users" }]} />
        <h1 className="text-xl font-semibold text-neutral-50">사용자</h1>
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Users" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">사용자 ({result.total})</h1>
        <p className="mt-1 text-xs text-neutral-500">
          가입자 목록 · 플랜 · 활동 통계. Premium 부여/해제는 우측 버튼.
        </p>
      </header>

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
      >
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
          이메일 검색
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="@ 포함 부분 검색"
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
          플랜
          <select
            name="tier"
            defaultValue={params.tier ?? ""}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          >
            <option value="">(전체)</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200 hover:border-cyan-700 hover:text-cyan-300"
        >
          적용
        </button>
        <a href="/users" className="text-xs text-neutral-500 hover:text-neutral-200">
          초기화
        </a>
      </form>

      <UserAdminTable rows={result.rows} />
    </main>
  );
}
