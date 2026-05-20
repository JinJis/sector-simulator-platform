"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelAgentWorkflow,
  getAgentWorkflow,
  type AgentDecomposition,
  type AgentWorkflow,
} from "@/lib/sim-client";

import { StatusPill } from "../status-pill";

interface Props {
  id: string;
  initial: AgentWorkflow;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Server hydrated with the initial record; client polls until the
 * status is terminal. Poll cadence is 1.5s — workflows are typically
 * 5–20s end-to-end, so this samples ~5–15x without burning the server.
 */
export function RunWatcher({ id, initial }: Props) {
  const [record, setRecord] = useState<AgentWorkflow>(initial);
  const [cancelBusy, setCancelBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await getAgentWorkflow(id);
      setRecord(next);
    } catch {
      // Transient — try again on the next tick. A persistent failure
      // surfaces as a stale "running" badge, which is a clear-enough
      // signal that something's wrong.
    }
  }, [id]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(record.status)) return;
    timer.current = setTimeout(poll, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [record.status, poll]);

  async function handleCancel() {
    if (!confirm("Cancel this workflow? In-flight LLM calls won't be aborted, but the result is discarded.")) {
      return;
    }
    setCancelBusy(true);
    try {
      const next = await cancelAgentWorkflow(id);
      setRecord(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelBusy(false);
    }
  }

  const decomp = useMemo(
    () => extractDecomposition(record),
    [record],
  );
  const inputDescription = String(
    (record.input as { description?: string }).description ?? "",
  );

  return (
    <>
      <header className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold text-neutral-50">Agent run</h1>
        <StatusPill status={record.status} />
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-0.5 text-[10px] font-medium text-neutral-400">
          {record.kind}
        </span>
        <span className="font-mono text-[10px] text-neutral-600">{record.id}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-neutral-500">
          <span className="tabular-nums">${record.cost_usd.toFixed(4)}</span>
          <span>{String(record.updated_at).slice(0, 19).replace("T", " ")}</span>
          {!TERMINAL_STATUSES.has(record.status) && (
            <button
              onClick={handleCancel}
              disabled={cancelBusy}
              className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
            >
              {cancelBusy ? "cancelling…" : "cancel"}
            </button>
          )}
        </span>
      </header>

      <section className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Input
        </h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
          {inputDescription || <em className="text-neutral-600">(empty)</em>}
        </p>
      </section>

      {record.error && (
        <section className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-300">
            Error
          </h2>
          <pre className="whitespace-pre-wrap font-mono text-[12px]">
            {record.error}
          </pre>
        </section>
      )}

      {record.status === "succeeded" && decomp && (
        <DecompositionResult decomp={decomp} />
      )}

      {!TERMINAL_STATUSES.has(record.status) && (
        <section className="rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-4 text-sm text-cyan-200">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />{" "}
          Agent is working. This page polls every 1.5 seconds.
        </section>
      )}
    </>
  );
}

function extractDecomposition(record: AgentWorkflow): AgentDecomposition | null {
  if (record.kind !== "decomposition") return null;
  if (record.status !== "succeeded") return null;
  const out = record.output;
  if (!out || typeof out !== "object") return null;
  return out as unknown as AgentDecomposition;
}

function DecompositionResult({ decomp }: { decomp: AgentDecomposition }) {
  const groupedDrivers = groupBy(decomp.drivers, (d) => d.group || "Other");
  const groupNames = [...groupedDrivers.keys()];
  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-emerald-200">
              {decomp.name}
            </h2>
            <p className="mt-0.5 text-[10px] text-emerald-400">
              slug: <code className="font-mono">{decomp.slug}</code> · horizon{" "}
              {decomp.horizon_years} yr · {decomp.drivers.length} drivers ·{" "}
              {decomp.outputs.length} outputs
            </p>
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-emerald-100/80">
          {decomp.description}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Drivers ({decomp.drivers.length})
        </h3>
        <div className="space-y-3">
          {groupNames.map((group) => (
            <div
              key={group}
              className="rounded border border-neutral-800 bg-neutral-900/30"
            >
              <div className="border-b border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-wider text-cyan-400">
                {group}
                <span className="ml-2 text-neutral-600">
                  {(groupedDrivers.get(group) ?? []).length} driver
                  {(groupedDrivers.get(group) ?? []).length === 1 ? "" : "s"}
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
                  {(groupedDrivers.get(group) ?? []).map((d) => (
                    <tr key={d.name} className="border-t border-neutral-800/60">
                      <td className="px-3 py-1.5 font-mono text-[10px] text-neutral-300">
                        {d.name}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {d.default}{" "}
                        <span className="text-neutral-600">{d.unit}</span>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-neutral-500">
                        {d.min} – {d.max}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">
                        {d.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {decomp.intermediates.length > 0 && (
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Intermediates ({decomp.intermediates.length})
          </h3>
          <ul className="space-y-1.5 rounded border border-neutral-800 bg-neutral-900/30 p-3 text-[11px]">
            {decomp.intermediates.map((i) => (
              <li key={i.name}>
                <span className="font-mono text-neutral-300">{i.name}</span>{" "}
                <span className="text-neutral-600">{i.unit && `(${i.unit})`}</span>
                <span className="text-neutral-500"> — {i.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Outputs ({decomp.outputs.length})
        </h3>
        <table className="w-full rounded border border-neutral-800 text-[11px]">
          <thead>
            <tr className="bg-neutral-900/60 text-left text-[9px] uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Kind</th>
              <th className="px-3 py-1.5 font-medium">Unit</th>
              <th className="px-3 py-1.5 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="text-neutral-200">
            {decomp.outputs.map((o) => (
              <tr key={o.name} className="border-t border-neutral-800/60">
                <td className="px-3 py-1.5 font-mono text-[10px]">{o.name}</td>
                <td className="px-3 py-1.5 text-neutral-400">{o.kind}</td>
                <td className="px-3 py-1.5 text-neutral-500">{o.unit}</td>
                <td className="px-3 py-1.5 text-neutral-500">{o.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-[11px] text-amber-200">
        This decomposition is{" "}
        <strong>not yet a registered sector</strong>. A future slice will add
        a "Promote to registered sector" action that runs the rest of the
        agent pipeline (driver-inference → edge-inference → code-gen →
        code-review) before persisting a class file.
      </p>
    </section>
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
