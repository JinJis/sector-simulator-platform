import { Breadcrumbs } from "@platform/ui";

import { fetchMe } from "@/lib/sim-client";

import { ProposeFlow } from "./propose-flow";

export const dynamic = "force-dynamic";

export default async function ProposeSectorPage() {
  // Render unauthenticated for browsing; the flow itself routes to
  // /login when the user clicks "시뮬레이터 만들기 시작" without a
  // session. Lets us show the value of the feature to non-logged
  // visitors first (the agent run requires login).
  const user = await fetchMe();

  return (
    <main className="mx-auto max-w-3xl px-6 pb-16 pt-8">
      <Breadcrumbs className="mb-3" items={[{ label: "내 시뮬레이터 만들기" }]} />
      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-700/60 bg-amber-950/40 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
          <span aria-hidden>🤖</span> 에이전트가 만들어 드려요
          <span className="ml-1 rounded bg-amber-900/50 px-1 text-[9px] text-amber-200">
            ★ Premium
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-50">
          궁금한 산업을 직접 시뮬레이터로 만들어보세요
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          관심 있는 산업을 자연어로 설명만 해 주시면, 에이전트가 그 산업의
          핵심 요인(드라이버) · 인과 그래프 · 수식까지 자동으로 구성해
          여러분만의 시뮬레이터를 만들어 드립니다. 보통 1-3 분 소요됩니다.
        </p>
      </header>

      <ProposeFlow user={user} />
    </main>
  );
}
