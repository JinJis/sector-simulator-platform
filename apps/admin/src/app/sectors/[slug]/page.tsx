import { Breadcrumbs } from "@platform/ui";
import { notFound } from "next/navigation";

import {
  fetchScenarios,
  fetchSim,
  type DriverSchema,
  type Scenario,
  type SimMetadata,
} from "@/lib/sim-client";

interface Params {
  slug: string;
}

export default async function SectorDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  let sim: SimMetadata;
  let scenarios: Scenario[];
  try {
    [sim, scenarios] = await Promise.all([fetchSim(slug), fetchScenarios(slug)]);
  } catch {
    notFound();
  }

  const drivers = groupBy(sim.drivers, (d) => d.group || "Other");
  const groupOrder = [...drivers.keys()];

  const allSources = Object.entries(sim.provenance).flatMap(([driver, p]) =>
    p.sources.map((s) => ({ ...s, driver })),
  );
  const sourcesByKind = groupBy(allSources, (s) => s.kind || "unclassified");
  const sourceKindOrder = [...sourcesByKind.keys()].sort();

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "Sectors", href: "/" },
          { label: sim.name },
        ]}
      />

      <header className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold text-neutral-50">{sim.name}</h1>
        <span className="rounded-full border border-cyan-900/60 bg-cyan-950/40 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
          {sim.slug}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-neutral-600">
          horizon {sim.horizon_years} yr · {sim.drivers.length} drivers ·{" "}
          {scenarios.length} saved scenarios
        </span>
        <a
          href={`http://localhost:3000/sectors/${encodeURIComponent(sim.slug)}`}
          className="ml-auto text-[11px] text-cyan-400 hover:text-cyan-300"
          rel="noreferrer"
        >
          Open in user app ↗
        </a>
      </header>

      <p className="mb-5 max-w-3xl text-sm leading-relaxed text-neutral-400">
        {sim.description}
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <StubAction title="Phase 2 later slice — kicks data-pipeline-service for this sector">
          ↻ Run ingest
        </StubAction>
        <StubAction title="Phase 2 later slice — agent re-derives this sector's edges">
          🤖 Re-run agent
        </StubAction>
        <StubAction title="Phase 2 later slice — diff agent proposal vs current and approve">
          ✓ Review proposal
        </StubAction>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
          Drivers
        </h2>
        <div className="space-y-3">
          {groupOrder.map((g) => (
            <DriverGroupBlock key={g} group={g} drivers={drivers.get(g) ?? []} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
          Presets ({Object.keys(sim.presets).length})
        </h2>
        <ul className="space-y-2">
          {Object.entries(sim.presets).map(([name, overrides]) => (
            <li
              key={name}
              className="rounded border border-neutral-800 bg-neutral-900/30 p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-neutral-100">{name}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                  {Object.keys(overrides).length} override
                  {Object.keys(overrides).length === 1 ? "" : "s"}
                </span>
              </div>
              {Object.keys(overrides).length > 0 && (
                <ul className="mt-1.5 grid grid-cols-1 gap-x-4 text-[11px] text-neutral-400 md:grid-cols-2">
                  {Object.entries(overrides).map(([k, v]) => (
                    <li key={k} className="tabular-nums">
                      <span className="text-neutral-500">{prettyName(k)}</span>{" "}
                      → {String(v)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
          Scenarios ({scenarios.length})
        </h2>
        {scenarios.length === 0 ? (
          <p className="rounded border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-500">
            No saved scenarios yet.
          </p>
        ) : (
          <ScenarioTable scenarios={scenarios} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
          Sources ({allSources.length})
        </h2>
        <p className="mb-2 text-[11px] text-neutral-500">
          By kind. Sources back individual drivers; the user-facing Sources tab
          shows the same data with citations inline.
        </p>
        <div className="space-y-3">
          {sourceKindOrder.map((kind) => (
            <details
              key={kind}
              className="group rounded border border-neutral-800 bg-neutral-900/30"
            >
              <summary className="cursor-pointer list-none px-3 py-2 text-[11px] uppercase tracking-wider text-neutral-300 group-open:border-b group-open:border-neutral-800">
                {kind}{" "}
                <span className="text-neutral-600">
                  · {(sourcesByKind.get(kind) ?? []).length}
                </span>
              </summary>
              <ul className="space-y-1.5 px-3 py-2 text-[11px]">
                {(sourcesByKind.get(kind) ?? []).map((s, i) => (
                  <li key={`${s.title}-${s.driver}-${i}`}>
                    {s.url ? (
                      <a
                        href={s.url}
                        className="text-cyan-400 hover:text-cyan-300"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.title}
                      </a>
                    ) : (
                      <span className="text-neutral-200">{s.title}</span>
                    )}
                    <span className="ml-1.5 text-neutral-600">
                      {s.as_of ? `· ${s.as_of} ` : ""}· backs {prettyName(s.driver)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

function DriverGroupBlock({
  group,
  drivers,
}: {
  group: string;
  drivers: DriverSchema[];
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/30">
      <div className="border-b border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-wider text-cyan-400">
        {group}{" "}
        <span className="text-neutral-600">
          · {drivers.length} driver{drivers.length === 1 ? "" : "s"}
        </span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-1.5 font-medium">Name</th>
            <th className="px-3 py-1.5 font-medium">Default</th>
            <th className="px-3 py-1.5 font-medium">Range</th>
            <th className="px-3 py-1.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="text-neutral-200">
          {drivers.map((d) => (
            <tr key={d.name} className="border-t border-neutral-800/60">
              <td className="px-3 py-1.5 text-neutral-300">{prettyName(d.name)}</td>
              <td className="px-3 py-1.5 tabular-nums">
                {d.default} <span className="text-neutral-600">{d.unit}</span>
              </td>
              <td className="px-3 py-1.5 tabular-nums text-neutral-500">
                {d.min} – {d.max}
              </td>
              <td className="px-3 py-1.5 text-neutral-500">{d.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioTable({ scenarios }: { scenarios: Scenario[] }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] uppercase tracking-wider text-neutral-500">
          <th className="px-3 py-1.5 font-medium">Name</th>
          <th className="px-3 py-1.5 font-medium">Overrides</th>
          <th className="px-3 py-1.5 font-medium">Updated</th>
          <th className="px-3 py-1.5 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody className="text-neutral-200">
        {scenarios.map((s) => (
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
              {String(s.updated_at).slice(0, 16).replace("T", " ")}
            </td>
            <td className="px-3 py-1.5 text-neutral-500">{s.notes ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
      className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-1.5 text-[11px] font-medium text-neutral-500 disabled:cursor-not-allowed"
    >
      {children}
      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-neutral-700">
        soon
      </span>
    </button>
  );
}

function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function prettyName(s: string): string {
  return s.replace(/_/g, " ");
}
