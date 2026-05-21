import { Breadcrumbs } from "@platform/ui";

import {
  fetchMe,
  fetchRecentSuggestions,
  fetchSims,
  fetchSuggestionsForSector,
  type CurrentUser,
  type SimMetadata,
  type SuggestionRow,
} from "@/lib/sim-client";

import { SuggestionsBrowser } from "./suggestions-browser";

interface SearchParams {
  sector?: string;
}

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let sims: SimMetadata[];
  let user: CurrentUser | null;
  let rows: SuggestionRow[];
  try {
    [sims, user] = await Promise.all([fetchSims(), fetchMe()]);
    rows = params.sector
      ? await fetchSuggestionsForSector(params.sector)
      : await fetchRecentSuggestions(50);
  } catch (err) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-neutral-50">섹터 개선 제안</h1>
        <p className="mt-4 text-sm text-red-400">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }
  const sectorOptions = sims.filter((s) => s.slug !== "placeholder");
  return (
    <main className="mx-auto max-w-4xl px-6 pb-16 pt-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "커뮤니티", href: "/community" },
          { label: "섹터 개선 제안" },
        ]}
      />
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-neutral-50">
          💡 섹터 개선 제안
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          어떤 드라이버 · 종목 · 인과 관계가 빠져있나요? 추가/제거를 제안하고,
          다른 사람의 제안에 투표해 주세요. 인기 제안은 편집팀이 검토 후 실제
          섹터 모델에 반영합니다.
        </p>
      </header>

      <SuggestionsBrowser
        initialRows={rows}
        initialSectorSlug={params.sector ?? null}
        sectorOptions={sectorOptions.map((s) => ({ slug: s.slug, name: s.name }))}
        signedIn={!!user}
      />
    </main>
  );
}
