import Link from "next/link";

import {
  fetchScenarios,
  fetchSims,
  SECTOR_SERVICE_URL,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

export default async function AdminHome() {
  let sims: SimMetadata[];
  let scenarios: Scenario[];
  try {
    [sims, scenarios] = await Promise.all([fetchSims(), fetchScenarios()]);
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold">Sectors</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  const scenarioCount = new Map<string, number>();
  for (const s of scenarios) {
    scenarioCount.set(s.sector_slug, (scenarioCount.get(s.sector_slug) ?? 0) + 1);
  }

  // Hide the seed-only placeholder unless it's the only registered sim.
  const visible = sims.filter((s) => s.slug !== "placeholder");
  const list = visible.length > 0 ? visible : sims;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-neutral-50">Sectors</h1>
        <span className="text-[11px] uppercase tracking-wider text-neutral-600">
          {list.length} registered · {scenarios.length} scenarios total
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <StubAction title="Phase 2 later slice — agent triggers a research pass">
          + Propose new sector (agent)
        </StubAction>
        <StubAction title="Phase 2 later slice — kicks data-pipeline-service">
          ↻ Run ingest (all)
        </StubAction>
        <StubAction title="Phase 2 later slice — bulk approve proposed sectors">
          ✓ Approve queue
        </StubAction>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {list.map((sim) => (
          <SectorCard
            key={sim.slug}
            sim={sim}
            scenarios={scenarioCount.get(sim.slug) ?? 0}
          />
        ))}
      </div>
    </main>
  );
}

function SectorCard({ sim, scenarios }: { sim: SimMetadata; scenarios: number }) {
  const driverGroups = new Set(sim.drivers.map((d) => d.group).filter(Boolean));
  const sourceCount = Object.values(sim.provenance).reduce(
    (n, p) => n + p.sources.length,
    0,
  );
  const presets = Object.keys(sim.presets).length;
  return (
    <Link
      href={`/sectors/${encodeURIComponent(sim.slug)}`}
      className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/70"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-50 group-hover:text-cyan-200">
          {sim.name}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-neutral-600">
          {sim.slug}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-neutral-400">
        {sim.description}
      </p>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
        <Stat label="horizon" value={`${sim.horizon_years} yr`} />
        <Stat label="drivers" value={`${sim.drivers.length}`} sub={`${driverGroups.size} groups`} />
        <Stat label="presets" value={`${presets}`} />
        <Stat label="sources" value={`${sourceCount}`} sub={`${scenarios} scenarios`} />
      </dl>
      <div className="mt-3 flex items-center justify-end text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          live
        </span>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-neutral-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-neutral-100">{value}</dd>
      {sub && <dd className="text-[10px] text-neutral-500">{sub}</dd>}
    </div>
  );
}

function StubAction({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled
      title={title}
      className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-1.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-700 disabled:cursor-not-allowed"
    >
      {children}
      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-neutral-700">
        soon
      </span>
    </button>
  );
}
