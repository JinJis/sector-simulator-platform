import Link from "next/link";

import {
  fetchScenarios,
  fetchSims,
  SECTOR_SERVICE_URL,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function ScenariosIndex() {
  // Same pattern as /admin (dashboard) — render whatever we can.
  // Scenarios live in sector-service's DB; sim metadata lives in
  // simulation-service. Either can be down without killing the page.
  const [scenariosR, simsR] = await Promise.all([
    settle(fetchScenarios()),
    settle(fetchSims()),
  ]);
  const scenarios: Scenario[] = scenariosR.ok ? scenariosR.value : [];
  const sims: SimMetadata[] = simsR.ok ? simsR.value : [];
  const simByslug = new Map<string, SimMetadata>(sims.map((s) => [s.slug, s]));
  const failures = [
    scenariosR.ok ? null : { source: "fetchScenarios (sector-service)", error: scenariosR.error },
    simsR.ok ? null : { source: "fetchSims (simulation-service)", error: simsR.error },
  ].filter((x): x is { source: string; error: string } => x != null);

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

      {failures.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-200">
            Partial data — {failures.length} upstream{" "}
            {failures.length === 1 ? "source" : "sources"} unreachable
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100/80">
            {failures.map((f) => (
              <li key={f.source}>
                <span className="text-amber-300">{f.source}</span>:{" "}
                <span className="text-amber-200/70">{f.error}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-amber-200/50">
            sector-service: {SECTOR_SERVICE_URL}
          </div>
        </div>
      )}

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
