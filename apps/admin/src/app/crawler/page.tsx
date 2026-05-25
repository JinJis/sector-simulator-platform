import { Breadcrumbs } from "@platform/ui";

import { CapabilityTrigger } from "@/components/crawler/CapabilityTrigger";
import { HelloWorldTrigger } from "@/components/crawler/HelloWorldTrigger";
import {
  type CrawlerHealth,
  type CrawlRun,
  fetchCrawlerHealth,
  listCrawlRuns,
  SECTOR_SERVICE_URL,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  ok: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  running: "border-blue-800/60 bg-blue-950/40 text-blue-300",
  queued: "border-neutral-800 bg-neutral-900/40 text-neutral-300",
  error: "border-rose-800/60 bg-rose-950/40 text-rose-300",
  cancelled: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  timeout: "border-amber-800/60 bg-amber-950/40 text-amber-300",
};

function statusTone(status: string): string {
  return STATUS_TONE[status] ?? "border-neutral-800 bg-neutral-900/40 text-neutral-400";
}

export default async function CrawlerCockpitPage() {
  let health: CrawlerHealth | null = null;
  let healthError: string | null = null;
  let runs: CrawlRun[] = [];
  let runsError: string | null = null;

  try {
    health = await fetchCrawlerHealth();
  } catch (err) {
    healthError = err instanceof Error ? err.message : String(err);
  }

  try {
    runs = await listCrawlRuns({ limit: 20 });
  } catch (err) {
    runsError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Crawler" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">Crawler cockpit</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Phase 4 real-time crawler — fetcher runs, health, smoke triggers.
          Production fetchers (capability / actor / signal / risk / economics)
          land in M49.
        </p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Service health
        </h2>
        {healthError ? (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            crawler 서비스에 연결할 수 없습니다 — {SECTOR_SERVICE_URL}
            <div className="mt-1 text-[11px] text-rose-400/80">{healthError}</div>
          </div>
        ) : health ? (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <ReadyChip label="repo" on={health.ready.repo} />
            <ReadyChip label="deep_research" on={health.ready.deep_research} />
            <span className="ml-auto text-neutral-500">
              checked {new Date(health.now).toISOString().slice(0, 19).replace("T", " ")}
            </span>
          </div>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Fetchers
        </h2>
        <div className="flex flex-col gap-2">
          <HelloWorldTrigger />
          <CapabilityTrigger />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Recent runs ({runs.length})
        </h2>
        {runsError ? (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            {runsError}
          </div>
        ) : runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center text-xs text-neutral-500">
            아직 fetcher 실행 이력이 없습니다. 위 smoke trigger로 첫 run을 만들어 보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ReadyChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`rounded border px-2 py-0.5 font-medium uppercase tracking-wider ${
        on
          ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
          : "border-rose-800/60 bg-rose-950/40 text-rose-300"
      }`}
    >
      {label} {on ? "on" : "off"}
    </span>
  );
}

function RunRow({ run }: { run: CrawlRun }) {
  const started = new Date(run.started_at);
  const ended = run.ended_at ? new Date(run.ended_at) : null;
  const elapsed =
    ended != null ? `${((ended.getTime() - started.getTime()) / 1000).toFixed(2)}s` : "—";
  const preview =
    run.result_summary && typeof run.result_summary === "object"
      ? // Surface `output_preview` if HelloWorldFetcher wrote it.
        (run.result_summary as { output_preview?: string }).output_preview ?? ""
      : "";
  const costStr = run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—";

  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-3 text-xs">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusTone(run.status)}`}
        >
          {run.status}
        </span>
        <span className="font-mono text-neutral-200">{run.fetcher_kind}</span>
        <span className="text-neutral-400">{run.vision_slug}</span>
        <span className="ml-auto text-neutral-500">{elapsed}</span>
        <span className="text-neutral-500">{costStr}</span>
      </div>
      {preview ? (
        <p className="mt-2 line-clamp-2 text-[12px] text-neutral-300">{preview}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-neutral-500">
        <span>id: {run.id}</span>
        <span>started: {started.toISOString().slice(0, 19).replace("T", " ")}</span>
        {run.error ? <span className="text-rose-400">error: {run.error}</span> : null}
      </div>
    </li>
  );
}
