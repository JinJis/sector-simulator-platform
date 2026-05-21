"use client";

import { useSearchParams } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createScenario,
  deleteScenario,
  fetchScenario,
  fetchScenarios,
  updateScenario,
  type LiveResponse,
  type Scenario,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import { diffFromDefaults, isSameOverrides } from "../../scenario-state";

interface SectorContextValue {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
  defaults: Record<string, number>;

  driverValues: Record<string, number>;
  setDriverValues: Dispatch<SetStateAction<Record<string, number>>>;

  scenarios: Scenario[];
  activeScenario: Scenario | null;
  dirty: boolean;
  overrideCount: number;
  currentOverrides: Record<string, number>;

  scenarioError: string | null;
  dismissScenarioError: () => void;

  handleLoad: (s: Scenario) => void;
  handleClearActive: () => void;
  handleResetToScenario: () => void;
  handleSaveNew: (name: string, notes?: string) => Promise<void>;
  handleUpdate: () => Promise<void>;
  handleRename: (name: string) => Promise<void>;
  handleDelete: () => Promise<void>;

  reportOpen: boolean;
  openReport: () => void;
  closeReport: () => void;
}

const Ctx = createContext<SectorContextValue | null>(null);

export function useSector(): SectorContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSector must be used inside <SectorShell>");
  return v;
}

interface ProviderProps {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
  children: React.ReactNode;
  /** Called when a user picks a saved scenario from the bar. */
  onLoadNavigate?: (s: Scenario) => void;
}

export function SectorProvider({
  meta,
  sensitivity,
  initialLive,
  children,
  onLoadNavigate,
}: ProviderProps) {
  const defaults = useMemo(
    () => Object.fromEntries(meta.drivers.map((d) => [d.name, d.default])),
    [meta.drivers],
  );

  const [driverValues, setDriverValues] = useState<Record<string, number>>(
    defaults,
  );
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Load the full scenario list for this sector after mount.
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

  // Hydrate ?scenario=<id> share links. Layouts in Next 15 can't see
  // searchParams server-side, so this happens client-side — accept the
  // brief flash on direct-link landing rather than duplicate the SSR
  // fetch into every child page.
  const searchParams = useSearchParams();
  const scenarioParam = searchParams?.get("scenario") ?? null;
  useEffect(() => {
    if (!scenarioParam) return;
    let cancelled = false;
    void fetchScenario(scenarioParam)
      .then((s) => {
        if (cancelled) return;
        if (s.sector_slug !== meta.slug) return;
        setActiveScenario(s);
        setDriverValues({ ...defaults, ...s.driver_overrides });
        setScenarios((prev) =>
          prev.find((x) => x.id === s.id) ? prev : [s, ...prev],
        );
      })
      .catch(() => {
        // Stale / invalid id — silently fall back to defaults.
      });
    return () => {
      cancelled = true;
    };
    // `defaults` is stable per meta; meta.slug guards cross-sector races.
  }, [scenarioParam, meta.slug, defaults]);

  const currentOverrides = useMemo(
    () => diffFromDefaults(driverValues, meta.drivers),
    [driverValues, meta.drivers],
  );

  const dirty = useMemo(() => {
    if (!activeScenario) return Object.keys(currentOverrides).length > 0;
    return !isSameOverrides(currentOverrides, activeScenario.driver_overrides);
  }, [activeScenario, currentOverrides]);

  const handleLoad = useCallback(
    (s: Scenario) => {
      setDriverValues({ ...defaults, ...s.driver_overrides });
      setActiveScenario(s);
      setScenarioError(null);
      onLoadNavigate?.(s);
    },
    [defaults, onLoadNavigate],
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

  const value: SectorContextValue = {
    meta,
    sensitivity,
    initialLive,
    defaults,
    driverValues,
    setDriverValues,
    scenarios,
    activeScenario,
    dirty,
    overrideCount: Object.keys(currentOverrides).length,
    currentOverrides,
    scenarioError,
    dismissScenarioError: () => setScenarioError(null),
    handleLoad,
    handleClearActive,
    handleResetToScenario,
    handleSaveNew,
    handleUpdate,
    handleRename,
    handleDelete,
    reportOpen,
    openReport: () => setReportOpen(true),
    closeReport: () => setReportOpen(false),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
