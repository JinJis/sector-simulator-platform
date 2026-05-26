import Link from "next/link";

import {
  fetchHealth24h,
  listAdminUsers,
  listSectors,
  SECTOR_SERVICE_URL,
  type AdminUserListResult,
  type CrawlRun,
  type Health24h,
  type SectorRow,
  listCrawlRuns,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AdminHome() {
  const [usersR, sectorsR, statsR, runsR] = await Promise.all([
    settle(listAdminUsers({ limit: 5 })),
    settle(listSectors()),
    settle(fetchHealth24h(24)),
    settle(listCrawlRuns({ limit: 8 })),
  ]);

  const users: AdminUserListResult = usersR.ok
    ? usersR.value
    : { rows: [], total: 0 };
  const sectors: SectorRow[] = sectorsR.ok ? sectorsR.value : [];
  const stats: Health24h | null = statsR.ok ? statsR.value : null;
  const runs: CrawlRun[] = runsR.ok ? runsR.value : [];

  const failures = [
    usersR.ok ? null : { source: "users", error: usersR.error },
    sectorsR.ok ? null : { source: "sectors", error: sectorsR.error },
    statsR.ok ? null : { source: "data-pipeline 24h", error: statsR.error },
    runsR.ok ? null : { source: "data-pipeline runs", error: runsR.error },
  ].filter((x): x is { source: string; error: string } => x != null);

  const liveVisions = sectors.filter((s) => s.status === "live");
  const draftCount = sectors.filter((s) => s.status === "draft").length;
  const premiumCount = users.rows.filter((u) => u.tier === "premium").length;
  const signals24h = stats
    ? stats.by_fetcher.reduce((n, r) => n + r.count, 0)
    : 0;
  const spend24h = stats?.total_cost_usd ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-50">
          Vision Feasibility Monitor — Admin
        </h1>
        <p className="mt-1 text-[11px] text-neutral-500">
          한눈에 보는 운영 상태. 상세 작업은 우측 네비게이션의 각 섹션으로.
        </p>
      </div>

      {failures.length > 0 ? (
        <div className="mb-6 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-200">
            Partial data — {failures.length} source(s) unreachable
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100/80">
            {failures.map((f) => (
              <li key={f.source}>
                <span className="text-amber-300">{f.source}</span>:{" "}
                <span className="text-amber-200/70">{f.error}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-amber-200/50">
            sector-service: {SECTOR_SERVICE_URL}
          </div>
        </div>
      ) : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="등록 사용자"
          value={users.total.toString()}
          sub={`Premium ${premiumCount}명`}
          href="/users"
        />
        <MetricTile
          label="Live 비전"
          value={liveVisions.length.toString()}
          sub={`Draft ${draftCount}`}
          href="/visions"
        />
        <MetricTile
          label="24h 신호 흐름"
          value={signals24h.toLocaleString("en-US")}
          sub={`${stats?.by_fetcher.length ?? 0} fetcher`}
          href="/data-pipeline"
        />
        <MetricTile
          label="24h LLM 비용"
          value={`$${spend24h.toFixed(2)}`}
          sub="data-pipeline 합계"
          href="/data-pipeline/health"
        />
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              최근 fetcher 실행
            </h2>
            <Link
              href="/data-pipeline"
              className="text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              전체 보기 →
            </Link>
          </div>
          {runs.length === 0 ? (
            <p className="text-xs text-neutral-500">
              아직 fetcher 실행 기록이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[11px]">
              {runs.slice(0, 8).map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline gap-2 border-b border-neutral-800/60 pb-1.5 last:border-b-0"
                >
                  <StatusDot status={r.status} />
                  <span className="font-mono text-neutral-500">
                    {r.fetcher_kind}
                  </span>
                  <span className="text-neutral-300">{r.vision_slug}</span>
                  {r.signals_written > 0 ? (
                    <span className="text-neutral-500">
                      +{r.signals_written} signals
                    </span>
                  ) : null}
                  {r.cost_usd != null && r.cost_usd > 0 ? (
                    <span className="text-neutral-500">
                      ${r.cost_usd.toFixed(4)}
                    </span>
                  ) : null}
                  <span className="ml-auto text-neutral-600">
                    {timeAgo(r.started_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              비전별 24h 비용
            </h2>
            <Link
              href="/data-pipeline/health"
              className="text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              상세 →
            </Link>
          </div>
          {!stats || stats.by_vision.length === 0 ? (
            <p className="text-xs text-neutral-500">
              지난 24시간 동안 비용이 발생하지 않았습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-[11px]">
              {stats.by_vision.slice(0, 8).map((v) => (
                <li
                  key={v.vision_slug}
                  className="flex items-baseline justify-between border-b border-neutral-800/60 pb-1 last:border-b-0"
                >
                  <span className="text-neutral-300">{v.vision_slug}</span>
                  <span className="font-mono text-neutral-200">
                    ${v.total_cost_usd.toFixed(4)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Live 비전 · {liveVisions.length}
          </h2>
          <Link
            href="/visions"
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            전체 비전 →
          </Link>
        </div>
        {liveVisions.length === 0 ? (
          <p className="text-xs text-neutral-500">
            등록된 비전이 없습니다.{" "}
            <Link
              href="/visions/new"
              className="text-cyan-400 hover:text-cyan-300"
            >
              새 비전 만들기 →
            </Link>
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {liveVisions.map((s) => (
              <Link
                key={s.slug}
                href={`/visions/${encodeURIComponent(s.slug)}`}
                className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-cyan-700"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-neutral-50 group-hover:text-cyan-200">
                    {s.name ?? s.slug}
                  </h3>
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                    {s.slug}
                  </span>
                </div>
                {s.description ? (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-neutral-400">
                    {s.description}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === "ok"
      ? "bg-emerald-400"
      : status === "running" || status === "queued"
        ? "bg-cyan-400 animate-pulse"
        : status === "error"
          ? "bg-rose-400"
          : "bg-neutral-500";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${tone}`}
      aria-label={status}
    />
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MetricTile({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-neutral-500">{sub}</div>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-cyan-700"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      {inner}
    </div>
  );
}
