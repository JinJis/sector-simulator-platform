"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import type {
  LiveResponse,
  Scenario,
  SensitivityResponse,
  SimMetadata,
} from "@/lib/sim-client";
import type { VisionOverview } from "@/lib/vision-client";

import { LiveStrip } from "../../../live-strip";
import { ManualPanel } from "../../../manual-panel";
import { ReportPanel } from "../../../report-panel";
import { ScenarioBar } from "../../../scenario-bar";
import {
  SectorProvider,
  useSector,
} from "../../../sectors/[slug]/sector-context";

import {
  WhatIfFeasibility,
  type CapabilityForWhatIf,
} from "./whatif-feasibility";

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
  /** M42: optional vision overview — when present we render the
   *  WhatIfFeasibility callout + per-driver capability badges. */
  overview: VisionOverview | null;
}

/**
 * Vision Playground client wrapper. Wires up the SectorProvider that
 * the legacy sector-shell used, but with a Vision-aware navigation
 * callback (load-scenario stays inside the /visions URL family).
 *
 * Same SectorContext, same components — different URL. M42 adds the
 * WhatIfFeasibility callout on top of this.
 */
export function PlaygroundClient({
  meta,
  sensitivity,
  initialLive,
  overview,
}: Props) {
  const router = useRouter();
  const onLoadNavigate = useCallback(
    (_s: Scenario) => {
      router.push(`/visions/${meta.slug}/playground`);
    },
    [router, meta.slug],
  );

  // M42: shape the overview capabilities for WhatIf + the per-driver
  // badge lookup. Memoize so identity stays stable across slider ticks.
  const capabilitiesForWhatIf = useMemo<CapabilityForWhatIf[]>(() => {
    if (!overview) return [];
    return overview.capabilities.map((c) => ({
      key: c.key,
      name: c.short_name ?? c.name,
      weight: c.weight,
      technical: c.current_score?.technical ?? null,
      economic: c.current_score?.economic ?? null,
      regulatory: c.current_score?.regulatory ?? null,
      supply: c.current_score?.supply ?? null,
      composite: c.current_score?.composite ?? null,
      composite_p10: c.current_score?.composite_p10 ?? null,
      composite_p90: c.current_score?.composite_p90 ?? null,
      primary_driver_name: c.primary_driver_name,
    }));
  }, [overview]);

  const driverCapabilityMap = useMemo<Record<string, { key: string; name: string }>>(() => {
    const map: Record<string, { key: string; name: string }> = {};
    for (const c of capabilitiesForWhatIf) {
      if (c.primary_driver_name) {
        map[c.primary_driver_name] = { key: c.key, name: c.name };
      }
    }
    return map;
  }, [capabilitiesForWhatIf]);

  return (
    <SectorProvider
      meta={meta}
      sensitivity={sensitivity}
      initialLive={initialLive}
      onLoadNavigate={onLoadNavigate}
    >
      <div className="space-y-6">
        <LiveStrip slug={meta.slug} initial={initialLive} />
        <PlaygroundChrome />
        {overview && capabilitiesForWhatIf.length > 0 && (
          <PlaygroundWhatIf
            capabilities={capabilitiesForWhatIf}
            currentComposite={overview.vision.feasibility?.composite ?? null}
          />
        )}
        <PlaygroundBody driverCapabilityMap={driverCapabilityMap} />
      </div>
    </SectorProvider>
  );
}

function PlaygroundWhatIf({
  capabilities,
  currentComposite,
}: {
  capabilities: CapabilityForWhatIf[];
  currentComposite: number | null;
}) {
  const { meta, driverValues, defaults } = useSector();
  return (
    <WhatIfFeasibility
      capabilities={capabilities}
      drivers={meta.drivers}
      driverValues={driverValues}
      defaults={defaults}
      currentComposite={currentComposite}
    />
  );
}

function PlaygroundChrome() {
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

function PlaygroundBody({
  driverCapabilityMap,
}: {
  driverCapabilityMap: Record<string, { key: string; name: string }>;
}) {
  const { meta, sensitivity, driverValues, setDriverValues, defaults } =
    useSector();
  return (
    <ManualPanel
      meta={meta}
      sensitivity={sensitivity}
      values={driverValues}
      onChangeValues={setDriverValues}
      defaults={defaults}
      driverCapabilityMap={driverCapabilityMap}
    />
  );
}
