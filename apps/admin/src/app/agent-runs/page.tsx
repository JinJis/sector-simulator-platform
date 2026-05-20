import Link from "next/link";

import {
  listAgentWorkflows,
  SECTOR_SERVICE_URL,
  type AgentWorkflow,
} from "@/lib/sim-client";

import { StatusPill } from "./status-pill";

export default async function AgentRunsIndex() {
  let runs: AgentWorkflow[];
  try {
    runs = await listAgentWorkflows({ limit: 100 });
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold">Agent runs</h1>
        <p className="mt-4 text-sm text-red-400">
          {err instanceof Error && err.message.includes("PRECONDITION_FAILED")
            ? "agent-orchestration service is not configured. Set AGENT_ORCHESTRATION_URL on sector-service and bring the agent-orchestration container up."
            : "Could not reach the sector-service to list agent runs."}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)} ({SECTOR_SERVICE_URL})
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-neutral-50">Agent runs</h1>
        <Link
          href="/agent-runs/new"
          className="rounded border border-rose-700 bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-800/60"
        >
          + New decomposition
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-6 text-sm text-neutral-500">
          No runs yet. Kick one off with{" "}
          <Link href="/agent-runs/new" className="text-cyan-400 hover:text-cyan-300">
            + New decomposition
          </Link>{" "}
          to validate the agent layer end-to-end.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-neutral-900/60 text-left text-[9px] uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Kind</th>
                <th className="px-3 py-1.5 font-medium">ID</th>
                <th className="px-3 py-1.5 font-medium">Started</th>
                <th className="px-3 py-1.5 font-medium">Cost</th>
                <th className="px-3 py-1.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-neutral-200">
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-neutral-800/60">
                  <td className="px-3 py-1.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-1.5 text-neutral-400">{r.kind}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">
                    <Link
                      href={`/agent-runs/${encodeURIComponent(r.id)}`}
                      className="text-cyan-400 hover:text-cyan-300"
                    >
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-neutral-500">
                    {String(r.created_at).slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-neutral-400">
                    ${r.cost_usd.toFixed(4)}
                  </td>
                  <td className="px-3 py-1.5 max-w-[420px] truncate text-neutral-500">
                    {String((r.input as { description?: string }).description ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
