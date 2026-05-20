import { SimWorkspace } from "./sim-workspace";
import {
  fetchSensitivity,
  fetchSim,
  SIM_SERVICE_URL,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

const SIM_SLUG = "space-data-center";

export default async function Home() {
  let meta: SimMetadata;
  let sensitivity: SensitivityResponse | null = null;
  try {
    meta = await fetchSim(SIM_SLUG);
    // Sensitivity is static per sim definition — fetch alongside metadata.
    sensitivity = await fetchSensitivity(SIM_SLUG).catch(() => null);
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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{meta.name}</h1>
          <span className="rounded-full bg-cyan-950 px-2 py-0.5 text-xs text-cyan-300">
            sector · {meta.slug}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-400">
          {meta.description}
        </p>
      </header>
      <SimWorkspace meta={meta} sensitivity={sensitivity} />
    </main>
  );
}
