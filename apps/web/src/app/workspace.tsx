"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createScenario,
  deleteScenario,
  fetchScenarios,
  updateScenario,
  type LiveResponse,
  type Scenario,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import { LiveDashboard } from "./live-dashboard";
import { ManualPanel } from "./manual-panel";
import { ScenarioBar } from "./scenario-bar";
import { diffFromDefaults, isSameOverrides } from "./scenario-state";
import { SourcesView } from "./sources-view";

type TabId = "live" | "manual" | "sources";

interface TabSpec {
  id: TabId;
  label: string;
  caption: string;
}

const TABS: TabSpec[] = [
  { id: "live", label: "Live", caption: "실시간 자동 데이터" },
  { id: "manual", label: "Manual", caption: "슬라이더로 직접 조정" },
  { id: "sources", label: "Sources", caption: "과거 → 현재 + 출처" },
];

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
  initialScenario: Scenario | null;
}

export function Workspace({ meta, sensitivity, initialLive, initialScenario }: Props) {
  const defaults = useMemo(
    () => Object.fromEntries(meta.drivers.map((d) => [d.name, d.default])),
    [meta.drivers],
  );

  // Driver values are now lifted here so ScenarioBar can read them when
  // saving and write them when loading. ManualPanel becomes a controlled
  // consumer.
  const [driverValues, setDriverValues] = useState<Record<string, number>>(() =>
    initialScenario
      ? { ...defaults, ...initialScenario.driver_overrides }
      : defaults,
  );
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(
    initialScenario,
  );
  const [scenarios, setScenarios] = useState<Scenario[]>(
    initialScenario ? [initialScenario] : [],
  );
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>("live");

  // Pull the full saved-scenario list for this sector after mount. The
  // server-loaded `initialScenario` (if any) is already in there as a
  // singleton placeholder so the bar shows it pre-selected without a flash.
  useEffect(() => {
    let cancelled = false;
    void fetchScenarios(meta.slug)
      .then((list) => {
        if (!cancelled) setScenarios(list);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setScenarioError(e instanceof Error ? e.message : "scenario list failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  // What we'd send if we saved right now — drivers diffed against default.
  const currentOverrides = useMemo(
    () => diffFromDefaults(driverValues, meta.drivers),
    [driverValues, meta.drivers],
  );

  // "dirty" relative to the loaded scenario (not relative to defaults).
  // Used by the bar to enable Update / Discard.
  const dirty = useMemo(() => {
    if (!activeScenario) return Object.keys(currentOverrides).length > 0;
    return !isSameOverrides(currentOverrides, activeScenario.driver_overrides);
  }, [activeScenario, currentOverrides]);

  const handleLoad = useCallback(
    (s: Scenario) => {
      setDriverValues({ ...defaults, ...s.driver_overrides });
      setActiveScenario(s);
      setScenarioError(null);
      // Manual is where overrides actually take effect visually — switching
      // there gives users a beat of confirmation.
      setTab("manual");
    },
    [defaults],
  );

  const handleResetToScenario = useCallback(() => {
    if (!activeScenario) {
      setDriverValues(defaults);
      return;
    }
    setDriverValues({ ...defaults, ...activeScenario.driver_overrides });
  }, [activeScenario, defaults]);

  const handleClearActive = useCallback(() => {
    setActiveScenario(null);
    setDriverValues(defaults);
  }, [defaults]);

  const handleSaveNew = useCallback(
    async (name: string, notes?: string) => {
      try {
        const created = await createScenario({
          sector_slug: meta.slug,
          name,
          notes,
          driver_overrides: currentOverrides,
        });
        setScenarios((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
        setActiveScenario(created);
        setScenarioError(null);
      } catch (e) {
        setScenarioError(e instanceof Error ? e.message : "save failed");
      }
    },
    [meta.slug, currentOverrides],
  );

  const handleUpdate = useCallback(async () => {
    if (!activeScenario) return;
    try {
      const updated = await updateScenario({
        id: activeScenario.id,
        driver_overrides: currentOverrides,
      });
      setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setActiveScenario(updated);
      setScenarioError(null);
    } catch (e) {
      setScenarioError(e instanceof Error ? e.message : "update failed");
    }
  }, [activeScenario, currentOverrides]);

  const handleRename = useCallback(
    async (name: string) => {
      if (!activeScenario) return;
      try {
        const updated = await updateScenario({ id: activeScenario.id, name });
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setActiveScenario(updated);
        setScenarioError(null);
      } catch (e) {
        setScenarioError(e instanceof Error ? e.message : "rename failed");
      }
    },
    [activeScenario],
  );

  const handleDelete = useCallback(async () => {
    if (!activeScenario) return;
    try {
      await deleteScenario(activeScenario.id);
      setScenarios((prev) => prev.filter((s) => s.id !== activeScenario.id));
      setActiveScenario(null);
      setDriverValues(defaults);
      setScenarioError(null);
    } catch (e) {
      setScenarioError(e instanceof Error ? e.message : "delete failed");
    }
  }, [activeScenario, defaults]);

  return (
    <div>
      <ScenarioBar
        sectorSlug={meta.slug}
        scenarios={scenarios}
        active={activeScenario}
        dirty={dirty}
        overrideCount={Object.keys(currentOverrides).length}
        error={scenarioError}
        onDismissError={() => setScenarioError(null)}
        onLoad={handleLoad}
        onClearActive={handleClearActive}
        onResetToScenario={handleResetToScenario}
        onSaveNew={handleSaveNew}
        onUpdate={handleUpdate}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      <div className="mb-5 flex flex-wrap items-stretch gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 p-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[140px] rounded-md px-4 py-2 text-left transition ${
                active
                  ? "bg-neutral-800 shadow-inner ring-1 ring-cyan-500/30"
                  : "hover:bg-neutral-800/50"
              }`}
            >
              <div
                className={`text-sm font-semibold ${
                  active ? "text-cyan-300" : "text-neutral-200"
                }`}
              >
                {t.label}
              </div>
              <div className="text-[11px] text-neutral-500">{t.caption}</div>
            </button>
          );
        })}
      </div>

      {tab === "live" && (
        <LiveDashboard meta={meta} sensitivity={sensitivity} initial={initialLive} />
      )}
      {tab === "manual" && (
        <ManualPanel
          meta={meta}
          sensitivity={sensitivity}
          values={driverValues}
          onChangeValues={setDriverValues}
          defaults={defaults}
        />
      )}
      {tab === "sources" && <SourcesView meta={meta} />}
    </div>
  );
}
