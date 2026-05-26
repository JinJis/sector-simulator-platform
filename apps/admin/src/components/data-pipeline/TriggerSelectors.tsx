"use client";

/**
 * Cascading dropdowns for the Data Pipeline triggers.
 *
 * Shape: Vision selector (loaded once on mount) + an optional second
 * selector whose options depend on the selected vision (loaded each
 * time the vision changes). All five triggers
 * (Capability / Actor / Signal / Risk / Digest) consume this — the
 * `kind` prop drives which lookup endpoint is hit.
 *
 * Why a shared component:
 *   - Free-text inputs were error-prone (admins typed `rad-hard-compute`
 *     when the DB key was `rad_hard_compute` → 404 cascade).
 *   - The selectors carry the validated `(vision_slug, key)` upward
 *     and the trigger button only enables when both are populated.
 *   - Loading + empty + fetch-error states are handled in one place.
 */

import { useEffect, useState } from "react";

import {
  listActorsForLookup,
  listCapabilitiesForLookup,
  listRisksForLookup,
  listVisionsForLookup,
  type LookupOption,
  type VisionLookupOption,
} from "@/lib/sim-client";

export type SecondaryKind = "capability" | "actor" | "risk" | null;

export interface TriggerSelectorsValue {
  vision_slug: string;
  secondary_key: string;
}

interface Props {
  /** What the second dropdown shows. `null` = vision-only (digest). */
  secondaryKind: SecondaryKind;
  /** Label for the second dropdown column. */
  secondaryLabel?: string;
  value: TriggerSelectorsValue;
  onChange: (v: TriggerSelectorsValue) => void;
}

export function TriggerSelectors({
  secondaryKind,
  secondaryLabel,
  value,
  onChange,
}: Props) {
  const [visions, setVisions] = useState<VisionLookupOption[] | null>(null);
  const [visionsError, setVisionsError] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<LookupOption[] | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);

  // Load visions once on mount.
  useEffect(() => {
    let cancelled = false;
    listVisionsForLookup()
      .then((rows) => {
        if (cancelled) return;
        setVisions(rows);
        // Auto-select first vision if none picked yet.
        const first = rows[0];
        if (!value.vision_slug && first) {
          onChange({ vision_slug: first.slug, secondary_key: "" });
        }
      })
      .catch((e) =>
        cancelled
          ? null
          : setVisionsError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload secondary options when vision changes (and secondary kind set).
  useEffect(() => {
    if (secondaryKind == null || !value.vision_slug) {
      setSecondary(null);
      return;
    }
    let cancelled = false;
    const load =
      secondaryKind === "capability"
        ? listCapabilitiesForLookup
        : secondaryKind === "actor"
          ? listActorsForLookup
          : listRisksForLookup;
    setSecondary(null);
    setSecondaryError(null);
    load(value.vision_slug)
      .then((rows) => {
        if (cancelled) return;
        setSecondary(rows);
        // Auto-select first option when the current key isn't in the list.
        const exists = rows.some((r) => r.key === value.secondary_key);
        if (!exists) {
          onChange({
            vision_slug: value.vision_slug,
            secondary_key: rows[0]?.key ?? "",
          });
        }
      })
      .catch((e) =>
        cancelled
          ? null
          : setSecondaryError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryKind, value.vision_slug]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-neutral-400">Vision</label>
      {visionsError ? (
        <span className="text-[10px] text-rose-400" title={visionsError}>
          vision load failed
        </span>
      ) : visions === null ? (
        <Skeleton width="w-52" />
      ) : visions.length === 0 ? (
        <span className="text-[10px] text-neutral-500">no visions registered</span>
      ) : (
        <select
          value={value.vision_slug}
          onChange={(e) =>
            onChange({
              vision_slug: e.target.value,
              secondary_key: "",
            })
          }
          className="w-52 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-cyan-500 focus:outline-none"
        >
          {visions.map((v) => (
            <option key={v.slug} value={v.slug}>
              {v.name}{" "}
              <span className="text-neutral-500">— {v.slug}</span>
            </option>
          ))}
        </select>
      )}

      {secondaryKind != null ? (
        <>
          <label className="text-xs text-neutral-400">
            {secondaryLabel ?? labelFor(secondaryKind)}
          </label>
          {secondaryError ? (
            <span
              className="text-[10px] text-rose-400"
              title={secondaryError}
            >
              load failed
            </span>
          ) : !value.vision_slug ? (
            <span className="text-[10px] text-neutral-600">
              pick vision first
            </span>
          ) : secondary === null ? (
            <Skeleton width="w-52" />
          ) : secondary.length === 0 ? (
            <span className="text-[10px] text-neutral-500">
              no {secondaryKind} for this vision
            </span>
          ) : (
            <select
              value={value.secondary_key}
              onChange={(e) =>
                onChange({
                  vision_slug: value.vision_slug,
                  secondary_key: e.target.value,
                })
              }
              className="w-52 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-cyan-500 focus:outline-none"
            >
              {secondary.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}{" "}
                  <span className="text-neutral-500">— {o.key}</span>
                </option>
              ))}
            </select>
          )}
        </>
      ) : null}
    </div>
  );
}

function labelFor(kind: SecondaryKind): string {
  switch (kind) {
    case "capability":
      return "Capability";
    case "actor":
      return "Actor";
    case "risk":
      return "Risk";
    default:
      return "";
  }
}

function Skeleton({ width }: { width: string }) {
  return (
    <span
      className={`inline-block ${width} h-7 animate-pulse rounded border border-neutral-800 bg-neutral-900`}
      aria-label="loading"
    />
  );
}
