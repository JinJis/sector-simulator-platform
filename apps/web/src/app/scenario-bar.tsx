"use client";

import { useState } from "react";

import type { Scenario } from "@/lib/sim-client";

interface Props {
  sectorSlug: string;
  scenarios: Scenario[];
  active: Scenario | null;
  dirty: boolean;
  overrideCount: number;
  error: string | null;
  onDismissError: () => void;
  onLoad: (s: Scenario) => void;
  onClearActive: () => void;
  onResetToScenario: () => void;
  onSaveNew: (name: string, notes?: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * Top-of-workspace bar for scenario CRUD. Visible on every tab.
 *
 * State machine drives which buttons are enabled:
 *   - no active scenario, no overrides   → only "Save as new" disabled
 *   - no active scenario, dirty          → "Save as new" enabled
 *   - active scenario, clean             → Rename / Fork / Share / Delete
 *   - active scenario, dirty             → also Update / Discard
 *
 * Save / rename / fork use `window.prompt` for the MVP. Replace with a
 * proper dialog component when we adopt one.
 */
export function ScenarioBar({
  sectorSlug,
  scenarios,
  active,
  dirty,
  overrideCount,
  error,
  onDismissError,
  onLoad,
  onClearActive,
  onResetToScenario,
  onSaveNew,
  onUpdate,
  onRename,
  onDelete,
}: Props) {
  const [shareToast, setShareToast] = useState<string | null>(null);

  function handlePickerChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (id === "__none__") {
      onClearActive();
      return;
    }
    const s = scenarios.find((x) => x.id === id);
    if (s) onLoad(s);
  }

  async function handleSaveNew() {
    const fallback = active ? `${active.name} (copy)` : "Untitled scenario";
    const name = window.prompt("Scenario name", fallback)?.trim();
    if (!name) return;
    await onSaveNew(name);
  }

  async function handleRename() {
    if (!active) return;
    const name = window.prompt("Rename scenario", active.name)?.trim();
    if (!name || name === active.name) return;
    await onRename(name);
  }

  async function handleDelete() {
    if (!active) return;
    if (!window.confirm(`Delete scenario "${active.name}"? This cannot be undone.`))
      return;
    await onDelete();
  }

  async function handleShare() {
    if (!active) return;
    // Always include the sector slug so the link is self-contained even if
    // the user is on a different sector when they paste it back.
    const url = `${window.location.origin}/?sector=${encodeURIComponent(
      sectorSlug,
    )}&scenario=${encodeURIComponent(active.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Link copied to clipboard");
    } catch {
      // Clipboard API can be blocked (insecure context, denied permission).
      // Fall back to showing the URL so the user can copy it by hand.
      setShareToast(url);
    }
    setTimeout(() => setShareToast(null), 2500);
  }

  const showSaveNew = dirty || overrideCount > 0;

  return (
    <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Scenario
        </span>

        <select
          value={active?.id ?? "__none__"}
          onChange={handlePickerChange}
          className="min-w-[180px] rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
          aria-label="Saved scenarios"
        >
          <option value="__none__">— defaults —</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {active && (
          <span className="flex items-center gap-1.5 text-xs text-neutral-400">
            {dirty && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                title="unsaved changes"
              />
            )}
            <span className="text-neutral-500">
              {Object.keys(active.driver_overrides).length} override
              {Object.keys(active.driver_overrides).length === 1 ? "" : "s"}
            </span>
          </span>
        )}

        {!active && overrideCount > 0 && (
          <span className="text-xs text-amber-300">
            {overrideCount} unsaved override{overrideCount === 1 ? "" : "s"}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {active && dirty && (
            <BarButton onClick={onUpdate} tone="primary" title="Save changes to this scenario">
              Update
            </BarButton>
          )}
          {active && dirty && (
            <BarButton
              onClick={onResetToScenario}
              tone="muted"
              title="Revert drivers to this scenario's saved values"
            >
              Discard
            </BarButton>
          )}
          {showSaveNew && (
            <BarButton
              onClick={handleSaveNew}
              tone={active ? "muted" : "primary"}
              title={active ? "Fork into a new scenario" : "Save current drivers as a new scenario"}
            >
              {active ? "Fork…" : "Save as…"}
            </BarButton>
          )}
          {active && (
            <BarButton onClick={handleRename} tone="muted" title="Rename scenario">
              Rename
            </BarButton>
          )}
          {active && (
            <BarButton onClick={handleShare} tone="muted" title="Copy share link">
              Share
            </BarButton>
          )}
          {active && (
            <BarButton
              onClick={handleDelete}
              tone="danger"
              title="Delete this scenario"
            >
              Delete
            </BarButton>
          )}
        </div>
      </div>

      {shareToast && (
        <p className="mt-2 text-[11px] text-cyan-300">{shareToast}</p>
      )}
      {error && (
        <p className="mt-2 flex items-start justify-between gap-3 rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          <span>{error}</span>
          <button
            onClick={onDismissError}
            className="text-red-400 hover:text-red-200"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </p>
      )}
    </div>
  );
}

function BarButton({
  children,
  onClick,
  tone,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  tone: "primary" | "muted" | "danger";
  title?: string;
}) {
  const cls =
    tone === "primary"
      ? "border-cyan-700 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-800/60"
      : tone === "danger"
        ? "border-red-900 bg-red-950/40 text-red-200 hover:bg-red-900/60"
        : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded border px-2 py-1 text-[11px] font-medium transition ${cls}`}
    >
      {children}
    </button>
  );
}
