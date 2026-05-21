import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";

import {
  fetchScenario,
  fetchScenarios,
  fetchSim,
  runSim,
  SECTOR_SERVICE_URL,
  type Scenario,
  type SimMetadata,
  type SimRunResponse,
} from "@/lib/sim-client";

import { CompareView } from "./compare-view";

const DEFAULTS_SENTINEL = "defaults";

interface SearchParams {
  sector?: string;
  a?: string;
  b?: string;
}

export interface ResolvedSide {
  /** Either a Scenario id or `defaults`. Round-trips into the picker URLs. */
  key: string;
  /** Display label — scenario name, or "Defaults". */
  label: string;
  scenario: Scenario | null;
  drivers: Record<string, number>;
  outputs: SimRunResponse["outputs"];
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { sector, a: aParam, b: bParam } = await searchParams;

  if (!sector) {
    return (
      <ErrorShell
        title="섹터가 지정되지 않았습니다"
        detail="URL에 ?sector=<slug>을 포함해야 합니다."
      />
    );
  }

  let meta: SimMetadata;
  try {
    meta = await fetchSim(sector);
  } catch (err) {
    return (
      <ErrorShell
        title={`sector-service에 연결할 수 없습니다 (${SECTOR_SERVICE_URL})`}
        detail={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  const scenarios = await fetchScenarios(sector).catch(() => [] as Scenario[]);

  const aKey = aParam ?? scenarios[0]?.id ?? DEFAULTS_SENTINEL;
  const bKey = bParam ?? scenarios[1]?.id ?? DEFAULTS_SENTINEL;

  const defaults = Object.fromEntries(meta.drivers.map((d) => [d.name, d.default]));

  const [aSide, bSide] = await Promise.all([
    resolveSide(aKey, meta, defaults),
    resolveSide(bKey, meta, defaults),
  ]);

  if (!aSide || !bSide) {
    return (
      <ErrorShell
        title="시나리오를 불러올 수 없습니다"
        detail={`a=${aKey} / b=${bKey} — 일부 시나리오가 존재하지 않거나 다른 섹터에 속합니다.`}
      />
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16 pt-6">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "Sectors", href: `/sectors` },
          { label: meta.name, href: `/sectors/${encodeURIComponent(sector)}` },
          { label: "Compare" },
        ]}
      />
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-50">
          {meta.name}
        </h1>
        <span className="rounded-full border border-cyan-900/60 bg-cyan-950/40 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
          A / B compare
        </span>
        <span className="text-[11px] uppercase tracking-wider text-neutral-600">
          {meta.horizon_years} yr · {meta.drivers.length} drivers
        </span>
      </div>
      <CompareView
        meta={meta}
        scenarios={scenarios}
        a={aSide}
        b={bSide}
        defaultsSentinel={DEFAULTS_SENTINEL}
      />
    </main>
  );
}

/**
 * Resolve one side of the compare (the scenario lookup + the sim run).
 * Returns null if the key references a scenario from a different sector or
 * one that no longer exists, so the page can surface a single coherent
 * error instead of half-rendering.
 */
async function resolveSide(
  key: string,
  meta: SimMetadata,
  defaults: Record<string, number>,
): Promise<ResolvedSide | null> {
  if (key === DEFAULTS_SENTINEL) {
    const run = await runSim(meta.slug, defaults).catch(() => null);
    if (!run) return null;
    return {
      key,
      label: "Defaults",
      scenario: null,
      drivers: defaults,
      outputs: run.outputs,
    };
  }

  let scenario: Scenario;
  try {
    scenario = await fetchScenario(key);
  } catch {
    return null;
  }
  if (scenario.sector_slug !== meta.slug) return null;

  const drivers = { ...defaults, ...scenario.driver_overrides };
  const run = await runSim(meta.slug, drivers).catch(() => null);
  if (!run) return null;
  return {
    key,
    label: scenario.name,
    scenario,
    drivers,
    outputs: run.outputs,
  };
}

function ErrorShell({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Tech Sector Simulator</h1>
      <p className="mt-4 text-sm text-red-400">{title}</p>
      <p className="mt-2 text-xs text-neutral-500">{detail}</p>
      <Link
        href="/sectors"
        className="mt-6 inline-block rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
      >
        ← back to sectors
      </Link>
    </main>
  );
}
