import { Breadcrumbs } from "@platform/ui";

import {
  fetchLifecycleCandidates,
  SECTOR_SERVICE_URL,
  type LifecycleCandidate,
  type LifecycleCandidates,
} from "@/lib/sim-client";

import { LifecycleCandidateCard } from "./lifecycle-candidate-card";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: LifecycleCandidate["category"][] = [
  "equity.stale_price",
  "graph_node.orphan",
  "graph_edge.neutral",
  "sector.cold",
];

const CATEGORY_LABEL: Record<LifecycleCandidate["category"], string> = {
  "equity.stale_price": "가격 데이터가 오래된 종목",
  "graph_node.orphan": "Edge가 하나도 없는 노드",
  "graph_edge.neutral": "Seed 이후 변경 없는 neutral edge",
  "sector.cold": "최근 시나리오가 없는 섹터",
};

const CATEGORY_HINT: Record<LifecycleCandidate["category"], string> = {
  "equity.stale_price":
    "data-pipeline 적재가 N일 이상 멈춰있거나 새 가격이 들어오지 않는 종목.",
  "graph_node.orphan":
    "그래프에 존재하지만 어떤 edge에도 연결되지 않아 모델 결과에 영향 없는 노드.",
  "graph_edge.neutral":
    "weight=1.0, magnitude=med — 시드 이후 누구도 손대지 않은 edge. 모델 표현력에 기여 없을 가능성.",
  "sector.cold":
    "최근 N일 동안 시나리오가 저장되지 않은 섹터. 사용자 관심에서 멀어졌을 수 있음.",
};

export default async function LifecyclePage() {
  let result: LifecycleCandidates;
  try {
    result = await fetchLifecycleCandidates();
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-neutral-50">Lifecycle review</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  const byCategory = new Map<LifecycleCandidate["category"], LifecycleCandidate[]>();
  for (const c of result.candidates) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }

  const totalActive = result.candidates.length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Lifecycle" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">Lifecycle review</h1>
        <p className="mt-1 text-xs text-neutral-500">
          시스템이 추천하는 deprecate 후보. 자동 적용은 절대 없음 — 모든 결정은 사용자가 직접 누르고,
          모든 결정은 audit_logs에 기록됩니다.
        </p>
        <p className="mt-2 text-[11px] text-neutral-600">
          {totalActive}개의 활성 후보 · 생성{" "}
          {new Date(result.generated_at).toISOString().slice(0, 19).replace("T", " ")}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATEGORY_ORDER.map((cat) => (
          <div
            key={cat}
            className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              {CATEGORY_LABEL[cat]}
            </div>
            <div className="mt-1 font-mono text-lg text-neutral-100">
              {result.counts[cat] ?? 0}
            </div>
          </div>
        ))}
      </section>

      {totalActive === 0 ? (
        <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-4 text-sm text-emerald-300">
          ✓ 활성 후보 없음 — 모두 처리되었거나 deferred 상태입니다.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {CATEGORY_ORDER.map((cat) => {
            const items = byCategory.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="mb-1 text-sm font-semibold text-neutral-100">
                  {CATEGORY_LABEL[cat]}{" "}
                  <span className="text-[11px] font-normal text-neutral-500">
                    ({items.length})
                  </span>
                </h2>
                <p className="mb-3 text-[11px] text-neutral-500">
                  {CATEGORY_HINT[cat]}
                </p>
                <ul className="flex flex-col gap-3">
                  {items.map((c) => (
                    <LifecycleCandidateCard key={`${c.category}::${c.ref_id}`} candidate={c} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
