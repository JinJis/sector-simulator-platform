"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import type {
  LiveResponse,
  Scenario,
  SensitivityResponse,
  SimMetadata,
} from "@/lib/sim-client";

import { LiveStrip } from "../../../live-strip";
import { ManualPanel } from "../../../manual-panel";
import { ReportPanel } from "../../../report-panel";
import { ScenarioBar } from "../../../scenario-bar";
import {
  SectorProvider,
  useSector,
} from "../../../sectors/[slug]/sector-context";

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
}

/**
 * Vision Playground client wrapper. Wires up the SectorProvider that
 * the legacy sector-shell used, but with a Vision-aware navigation
 * callback (load-scenario stays inside the /visions URL family).
 *
 * Same SectorContext, same components — different URL. M42 adds the
 * WhatIfFeasibility callout on top of this.
 */
export function PlaygroundClient({ meta, sensitivity, initialLive }: Props) {
  const router = useRouter();
  const onLoadNavigate = useCallback(
    (_s: Scenario) => {
      router.push(`/visions/${meta.slug}/playground`);
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
      <div className="space-y-6">
        <LiveStrip slug={meta.slug} initial={initialLive} />
        <PlaygroundChrome />
        <PlaygroundBody />
      </div>
    </SectorProvider>
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

function PlaygroundBody() {
  const { meta, sensitivity, driverValues, setDriverValues, defaults } =
    useSector();
  return (
    <ManualPanel
      meta={meta}
      sensitivity={sensitivity}
      values={driverValues}
      onChangeValues={setDriverValues}
      defaults={defaults}
    />
  );
}
