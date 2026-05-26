/**
 * /admin/data-pipeline — Live tab (default landing).
 *
 * Manual fetcher triggers + auto-refreshing CrawlRun table. The
 * Health / Schedule / Proposals / Agent-runs concerns live in
 * sibling routes under the shared `DataPipelineLayout` tab nav.
 */

import { ActorTrigger } from "@/components/data-pipeline/ActorTrigger";
import { CapabilityTrigger } from "@/components/data-pipeline/CapabilityTrigger";
import { DigestTrigger } from "@/components/data-pipeline/DigestTrigger";
import { HelloWorldTrigger } from "@/components/data-pipeline/HelloWorldTrigger";
import { LiveJobsTable } from "@/components/data-pipeline/LiveJobsTable";
import { RiskTrigger } from "@/components/data-pipeline/RiskTrigger";
import { SignalTrigger } from "@/components/data-pipeline/SignalTrigger";
import { type CrawlRun, listCrawlRuns } from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function DataPipelineLive() {
  let runs: CrawlRun[] = [];
  let runsError: string | null = null;
  try {
    runs = await listCrawlRuns({ limit: 30 });
  } catch (err) {
    runsError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <section className="mb-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Manual triggers
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <HelloWorldTrigger />
          <CapabilityTrigger />
          <ActorTrigger />
          <SignalTrigger />
          <RiskTrigger />
        </div>
        <div className="mt-2">
          <DigestTrigger />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Live jobs
        </h2>
        {runsError ? (
          <p className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {runsError}
          </p>
        ) : (
          <LiveJobsTable initialRuns={runs} limit={30} />
        )}
      </section>
    </>
  );
}
