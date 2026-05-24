"use client";

import { useMemo } from "react";

import {
  projectWhatIfVision,
  type CapabilityWithComposite,
  type DriverOverride,
} from "@/lib/playground/feasibility";
import type { DriverSchema } from "@/lib/sim-client";

/**
 * Capability + driver mapping the Playground page passes in (derived
 * from `vision.getOverview`). Kept narrower than the full OverviewOut
 * shape so the component is testable in isolation.
 */
export interface CapabilityForWhatIf extends CapabilityWithComposite {
  /** Capability.primary_driver_name — links one driver to one capability. */
  primary_driver_name: string | null;
}

interface Props {
  capabilities: CapabilityForWhatIf[];
  drivers: DriverSchema[];
  driverValues: Record<string, number>;
  defaults: Record<string, number>;
  /** Pre-computed by the parent — when null we hide the callout. */
  currentComposite: number | null;
}

/**
 * Sits above the Playground sim chart. When the user moves sliders,
 * shows how the vision composite would shift if the capability
 * mapped to each driver moved proportionally.
 *
 * Math is intentionally simple — see lib/playground/feasibility.ts.
 * This is a UX hint ("here's what your move implies"), not a sim
 * output.
 */
export function WhatIfFeasibility({
  capabilities,
  drivers,
  driverValues,
  defaults,
  currentComposite,
}: Props) {
  const result = useMemo(() => {
    const driverToCapability: Record<string, string> = {};
    for (const c of capabilities) {
      if (c.primary_driver_name) {
        driverToCapability[c.primary_driver_name] = c.key;
      }
    }
    const overrides: DriverOverride[] = drivers.map((d) => ({
      driver_name: d.name,
      value: driverValues[d.name] ?? d.default,
      default: defaults[d.name] ?? d.default,
      min: d.min,
      max: d.max,
    }));
    return projectWhatIfVision({
      capabilities,
      driverToCapability,
      drivers: overrides,
    });
  }, [capabilities, drivers, driverValues, defaults]);

  // If we have no capabilities with composites, or no driver→capability
  // mapping exists at all, suppress the callout — surfacing a 0→0
  // delta is noise.
  const anyMappedDrivers = capabilities.some((c) => c.primary_driver_name);
  if (!anyMappedDrivers) return null;
  if (currentComposite === null && result.current === null) return null;

  const cur = currentComposite ?? result.current?.composite ?? null;
  const proj = result.projected?.composite ?? cur;
  const delta = cur !== null && proj !== null ? proj - cur : 0;
  const sign = delta > 0 ? "+" : "";
  const dirty = Object.values(result.perCapabilityShift).some((s) => s !== 0);

  // Top affected capabilities (sorted by absolute shift).
  const topImpacts = capabilities
    .map((c) => ({
      key: c.key,
      name: c.name,
      shift: result.perCapabilityShift[c.key] ?? 0,
    }))
    .filter((x) => x.shift !== 0)
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))
    .slice(0, 3);

  return (
    <div
      className={`rounded-lg border p-4 transition ${
        dirty
          ? delta > 0
            ? "border-emerald-700/60 bg-emerald-950/20"
            : delta < 0
              ? "border-rose-700/60 bg-rose-950/20"
              : "border-neutral-800 bg-neutral-900/40"
          : "border-neutral-800 bg-neutral-900/40"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            What-if vision feasibility
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Projection assumes each driver shifts its primary capability's{" "}
            <span className="font-mono text-neutral-400">technical</span> dim
            proportionally. UX hint, not a sim output.
          </p>
        </div>
        {!dirty && (
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
            sliders at default
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-4">
        <CompositeChip label="Current" value={cur} muted />
        <span className="text-neutral-700">→</span>
        <CompositeChip
          label="Projected"
          value={proj}
          accent={dirty ? (delta > 0 ? "up" : "down") : null}
        />
        {dirty && cur !== null && proj !== null && (
          <span
            className={`ml-2 font-mono text-sm ${
              delta > 0
                ? "text-emerald-300"
                : delta < 0
                  ? "text-rose-300"
                  : "text-neutral-400"
            }`}
          >
            {sign}
            {delta.toFixed(1)}
          </span>
        )}
      </div>

      {topImpacts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
          {topImpacts.map((x) => (
            <li key={x.key}>
              <span className="text-neutral-500">{x.name}:</span>{" "}
              <span
                className={
                  x.shift > 0
                    ? "text-emerald-300"
                    : x.shift < 0
                      ? "text-rose-300"
                      : "text-neutral-400"
                }
              >
                {x.shift > 0 ? "+" : ""}
                {x.shift.toFixed(1)}
              </span>
              <span className="text-neutral-600"> tech</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompositeChip({
  label,
  value,
  muted = false,
  accent = null,
}: {
  label: string;
  value: number | null;
  muted?: boolean;
  accent?: "up" | "down" | null;
}) {
  const color = accent === "up"
    ? "text-emerald-200"
    : accent === "down"
      ? "text-rose-200"
      : muted
        ? "text-neutral-400"
        : "text-neutral-100";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${color}`}>
        {value === null ? "—" : value.toFixed(1)}
      </p>
    </div>
  );
}
