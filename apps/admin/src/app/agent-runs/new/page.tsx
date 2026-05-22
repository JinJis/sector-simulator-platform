import { Breadcrumbs } from "@platform/ui";

import { NewDecompositionForm } from "./form";

export default function NewAgentRunPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "Agent runs", href: "/agent-runs" },
          { label: "New run" },
        ]}
      />
      <h1 className="text-xl font-semibold text-neutral-50">
        Propose new sector
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        Run an agent pipeline against a free-form sector concept. The
        result is reviewable before any promotion to a registered sector.
      </p>
      <p className="mt-1 text-[11px] text-neutral-600">
        Three options — pick by depth. Full pipeline (M28) chains six
        agents end-to-end and produces a reviewed Python source file;
        the other two stop earlier and let you iterate manually.
      </p>
      <div className="mt-6">
        <NewDecompositionForm />
      </div>
    </main>
  );
}
