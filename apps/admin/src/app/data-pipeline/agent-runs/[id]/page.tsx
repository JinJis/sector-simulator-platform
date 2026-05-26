import { notFound } from "next/navigation";

import { getAgentWorkflow, type AgentWorkflow } from "@/lib/sim-client";

import { RunWatcher } from "./watcher";

interface Params {
  id: string;
}

export default async function AgentRunDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  let initial: AgentWorkflow;
  try {
    initial = await getAgentWorkflow(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("NOT_FOUND")) {
      notFound();
    }
    return (
      <>
        <h2 className="text-base font-semibold text-neutral-50">
          Workflow {shortId(id)}
        </h2>
        <p className="mt-4 text-sm text-red-400">
          Failed to load workflow {id}.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-base font-semibold text-neutral-50">
        Workflow {shortId(id)}
      </h2>
      <div className="mt-3">
        <RunWatcher id={id} initial={initial} />
      </div>
    </>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 11)}…` : id;
}
