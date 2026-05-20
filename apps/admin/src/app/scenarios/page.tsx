import Link from "next/link";

import {
  fetchScenarios,
  fetchSims,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

export default async function ScenariosIndex() {
  const [scenarios, sims] = await Promise.all([fetchScenarios(), fetchSims()]);
  const simByslug = new Map<string, SimMetadata>(sims.map((s) => [s.slug, s]));

  const grouped = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    const arr = grouped.get(s.sector_slug) ?? [];
    arr.push(s);
    grouped.set(s.sector_slug, arr);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-neutral-50">Scenarios</h1>
        <span className="text-[11px] uppercase tracking-wider text-neutral-600">
          {scenarios.length} total · {grouped.size} sectors
        </span>
      </div>

      {scenarios.length === 0 && (
        <p className="rounded border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
          저장된 시나리오가 없습니다. 사용자 앱에서 슬라이더를 조정하고 Save as…로
          저장하면 여기 나타납니다.
        </p>
      )}

      <div className="space-y-6">
        {[...grouped.entries()].map(([slug, list]) => (
          <section key={slug}>
            <header className="mb-2 flex items-baseline justify-between">
              <Link
                href={`/sectors/${encodeURIComponent(slug)}`}
                className="text-sm font-semibold text-neutral-100 hover:text-cyan-200"
              >
                {simByslug.get(slug)?.name ?? slug}
              </Link>
              <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                {slug} · {list.length} scenarios
              </span>
            </header>
            <div className="overflow-x-auto rounded border border-neutral-800">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-neutral-900/60 text-left text-[9px] uppercase tracking-wider text-neutral-500">
                    <th className="px-3 py-1.5 font-medium">Name</th>
                    <th className="px-3 py-1.5 font-medium">Overrides</th>
                    <th className="px-3 py-1.5 font-medium">Author</th>
                    <th className="px-3 py-1.5 font-medium">Updated</th>
                    <th className="px-3 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="text-neutral-200">
                  {list.map((s) => (
                    <tr key={s.id} className="border-t border-neutral-800/60">
                      <td className="px-3 py-1.5">
                        <a
                          href={`http://localhost:3000/?scenario=${encodeURIComponent(s.id)}`}
                          className="text-cyan-400 hover:text-cyan-300"
                          rel="noreferrer"
                        >
                          {s.name}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-neutral-400">
                        {Object.keys(s.driver_overrides).length}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {s.author_label ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {String(s.updated_at).slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {s.notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
