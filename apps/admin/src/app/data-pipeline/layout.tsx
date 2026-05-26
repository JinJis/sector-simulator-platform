import { Breadcrumbs } from "@platform/ui";
import type { ReactNode } from "react";

import { DataPipelineTabs } from "./tabs";

export default function DataPipelineLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Data Pipeline" }]} />
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-neutral-50">Data Pipeline</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Tiered ingest · per-fetcher health · schedule · bot proposals ·
          Vision Builder runs. Single service on :8003.
        </p>
      </header>
      <DataPipelineTabs />
      <div className="mt-5">{children}</div>
    </main>
  );
}
