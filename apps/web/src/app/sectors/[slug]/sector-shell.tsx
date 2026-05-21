"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import type {
  LiveResponse,
  Scenario,
  SensitivityResponse,
  SimMetadata,
} from "@/lib/sim-client";

import { LiveStrip } from "../../live-strip";
import { ReportPanel } from "../../report-panel";
import { ScenarioBar } from "../../scenario-bar";
import { SectorPicker } from "../../sector-picker";

import { SectorNav } from "./sector-nav";
import { SectorProvider, useSector } from "./sector-context";

interface Props {
  meta: SimMetadata;
  sims: SimMetadata[];
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
  children: React.ReactNode;
}

export function SectorShell({
  meta,
  sims,
  sensitivity,
  initialLive,
  children,
}: Props) {
  const router = useRouter();

  // Loading a scenario takes the user to the Manual tab — that's where
  // the override sliders show the loaded values visually.
  const onLoadNavigate = useCallback(
    (_s: Scenario) => {
      router.push(`/sectors/${meta.slug}/manual`);
    },
    [router, meta.slug],
  );

  return (
    <SectorProvider
      meta={meta}
      sensitivity={sensitivity}
      initialLive={initialLive}
      onLoadNavigate={onLoadNavigate}
    >
      <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16">
        <LiveStrip slug={meta.slug} initial={initialLive} />
        <SectorPicker sims={sims} currentSlug={meta.slug} />
        <Chrome />
        <SubNavRow />
        {children}
      </main>
    </SectorProvider>
  );
}

function Chrome() {
  const {
    meta,
    scenarios,
    activeScenario,
    dirty,
    overrideCount,
    scenarioError,
    dismissScenarioError,
    handleLoad,
    handleClearActive,
    handleResetToScenario,
    handleSaveNew,
    handleUpdate,
    handleRename,
    handleDelete,
    openReport,
    reportOpen,
    closeReport,
    driverValues,
  } = useSector();

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
            {meta.name}
          </h1>
          <span className="rounded-full border border-cyan-900/60 bg-cyan-950/40 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
            sector · {meta.slug}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-neutral-600">
            horizon {meta.horizon_years} yr · {meta.drivers.length} drivers
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-400">
          {meta.description}
        </p>
      </header>

      <ScenarioBar
        sectorSlug={meta.slug}
        scenarios={scenarios}
        active={activeScenario}
        dirty={dirty}
        overrideCount={overrideCount}
        error={scenarioError}
        onDismissError={dismissScenarioError}
        onLoad={handleLoad}
        onClearActive={handleClearActive}
        onResetToScenario={handleResetToScenario}
        onSaveNew={handleSaveNew}
        onUpdate={handleUpdate}
        onRename={handleRename}
        onDelete={handleDelete}
        onOpenReport={openReport}
      />
      <ReportPanel
        slug={meta.slug}
        drivers={driverValues}
        scenarioName={activeScenario?.name ?? null}
        scenarioNotes={activeScenario?.notes ?? null}
        open={reportOpen}
        onClose={closeReport}
      />
    </>
  );
}

function SubNavRow() {
  const { meta } = useSector();
  return <SectorNav slug={meta.slug} />;
}
