import {
  fetchLive,
  fetchSensitivity,
  fetchSim,
  SIM_SERVICE_URL,
  type LiveResponse,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import { LiveStrip } from "./live-strip";
import { Workspace } from "./workspace";

const SIM_SLUG = "space-data-center";

export default async function Home() {
  let meta: SimMetadata;
  let sensitivity: SensitivityResponse | null = null;
  let initialLive: LiveResponse | null = null;
  try {
    meta = await fetchSim(SIM_SLUG);
    [sensitivity, initialLive] = await Promise.all([
      fetchSensitivity(SIM_SLUG).catch(() => null),
      fetchLive(SIM_SLUG).catch(() => null),
    ]);
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Tech Sector Simulator</h1>
        <p className="mt-4 text-sm text-red-400">
          simulation-service에 연결할 수 없습니다 ({SIM_SERVICE_URL}).
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
        <pre className="mt-4 rounded bg-neutral-900 p-3 text-xs text-neutral-300">
          pnpm dev # 또는 services/simulation-service 단독 기동
        </pre>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16">
      <LiveStrip slug={meta.slug} initial={initialLive} />
      <header className="mb-6 mt-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
            {meta.name}
          </h1>
          <span className="rounded-full border border-cyan-900/60 bg-cyan-950/40 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
            sector · {meta.slug}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-neutral-600">
            horizon {meta.horizon_years} yr
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-400">
          {meta.description}
        </p>
      </header>
      <Workspace meta={meta} sensitivity={sensitivity} initialLive={initialLive} />
    </main>
  );
}
