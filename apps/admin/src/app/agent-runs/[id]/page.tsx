import Link from "next/link";
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
        <Link href="/agent-runs" className="text-[11px] text-neutral-500 hover:text-neutral-300">
          ← Agent runs
        </Link>
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
      <nav className="mb-3 text-[11px] text-neutral-500">
        <Link href="/agent-runs" className="hover:text-neutral-300">
          ← Agent runs
        </Link>
      </nav>
      <RunWatcher id={id} initial={initial} />
    </main>
  );
}
