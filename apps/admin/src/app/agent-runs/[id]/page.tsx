import { Breadcrumbs } from "@platform/ui";
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
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Breadcrumbs
          className="mb-3"
          items={[
            { label: "Agent runs", href: "/agent-runs" },
            { label: shortId(id) },
          ]}
        />
        <p className="mt-4 text-sm text-red-400">
          Failed to load workflow {id}.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "Agent runs", href: "/agent-runs" },
          { label: shortId(id) },
        ]}
      />
      <RunWatcher id={id} initial={initial} />
    </main>
  );
}

/** wf_abc123def456 → wf_abc123…. Keeps breadcrumbs compact for long IDs. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 11)}…` : id;
}
