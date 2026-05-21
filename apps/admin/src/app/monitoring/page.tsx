import { Breadcrumbs } from "@platform/ui";

import {
  fetchMonitoringHealth,
  SECTOR_SERVICE_URL,
  type MonitoringHealth,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<MonitoringHealth["feeds"][number]["status"], string> = {
  ok: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  stale: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  down: "border-rose-800/60 bg-rose-950/40 text-rose-300",
  not_configured: "border-neutral-800 bg-neutral-950 text-neutral-500",
};

export default async function MonitoringPage() {
  let health: MonitoringHealth;
  try {
    health = await fetchMonitoringHealth();
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-neutral-50">Monitoring</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  const generated = new Date(health.generated_at).toISOString();
  const counts = health.table_counts;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Monitoring" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">Monitoring</h1>
        <p className="mt-1 text-xs text-neutral-500">
          데이터 적재 freshness · 생성 시각 {generated}
        </p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Feeds
        </h2>
        <ul className="flex flex-col gap-2">
          {health.feeds.map((f) => (
            <li
              key={f.name}
              className="flex flex-wrap items-baseline gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
            >
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_TONE[f.status]}`}
              >
                {f.status}
              </span>
              <span className="text-sm font-medium text-neutral-100">{f.name}</span>
              <span className="text-xs text-neutral-400">{f.detail}</span>
              <div className="ml-auto flex flex-col items-end text-[11px] text-neutral-500">
                <span>
                  last:{" "}
                  {f.last_success_at
                    ? f.last_success_at.slice(0, 16).replace("T", " ")
                    : "—"}
                </span>
                {f.next_run_at && (
                  <span>
                    next: {f.next_run_at.slice(0, 16).replace("T", " ")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Table counts
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Sectors" value={counts.sectors} />
          <Tile label="Equities" value={counts.equities} />
          <Tile label="Quote bars" value={counts.equity_quotes} />
          <Tile label="Financial qtrs" value={counts.equity_financials} />
          <Tile label="Graph nodes" value={counts.graph_nodes} />
          <Tile label="Graph edges" value={counts.graph_edges} />
          <Tile label="Scenarios" value={counts.scenarios} />
          <Tile label="Audit logs" value={counts.audit_logs} />
        </div>
      </section>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg text-neutral-100">
        {value.toLocaleString("en-US")}
      </div>
    </div>
  );
}
