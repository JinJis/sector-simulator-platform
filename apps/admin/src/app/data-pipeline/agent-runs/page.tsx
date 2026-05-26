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
    const msg = err instanceof Error ? err.message : String(err);
    // Classify the failure so the visible copy points at the actual
    // missing piece instead of a generic "sector-service down".
    const isAgentMissing =
      msg.includes("PRECONDITION_FAILED") ||
      msg.includes("agent-orchestration") ||
      msg.includes("AGENT_ORCHESTRATION_URL");
    const headline = isAgentMissing
      ? "agent-orchestration 서비스가 연결되지 않았습니다."
      : "sector-service에 연결할 수 없습니다.";
    const hint = isAgentMissing
      ? "Vertex AI 자격증명을 마운트하고 (`infra/secrets/vertex-ai-sa.json`) " +
        "`agent-orchestration` 컨테이너를 띄우거나, sector-service의 " +
        "AGENT_ORCHESTRATION_URL 환경변수를 가리키세요."
      : `sector-service: ${SECTOR_SERVICE_URL}`;
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-200">{headline}</p>
        <p className="mt-1 text-[11px] text-amber-200/70">{hint}</p>
        <p className="mt-2 font-mono text-[10px] text-amber-200/50">{msg}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-baseline justify-end">
        <Link
          href="/data-pipeline/agent-runs/new"
          className="rounded border border-rose-700 bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-800/60"
        >
          + New decomposition
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-6 text-sm text-neutral-500">
          No runs yet. Kick one off with{" "}
          <Link href="/data-pipeline/agent-runs/new" className="text-cyan-400 hover:text-cyan-300">
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
                      href={`/data-pipeline/agent-runs/${encodeURIComponent(r.id)}`}
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
    </>
  );
}
