import { Breadcrumbs } from "@platform/ui";

import { NewDecompositionForm } from "./form";

export default function NewAgentRunPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "Agent runs", href: "/agent-runs" },
          { label: "New decomposition" },
        ]}
      />
      <h1 className="text-xl font-semibold text-neutral-50">
        Propose new sector
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        Run the Decomposition Agent against a free-form sector concept. The
        agent returns drivers, intermediates, and outputs you can review
        before promoting to a registered sector.
      </p>
      <p className="mt-1 text-[11px] text-neutral-600">
        Routed to Claude Opus 4.7 with adaptive thinking — typical cost
        $0.10–$0.30 per run. The page redirects to a live status view
        the moment the run is queued.
      </p>
      <div className="mt-6">
        <NewDecompositionForm />
      </div>
    </main>
  );
}
