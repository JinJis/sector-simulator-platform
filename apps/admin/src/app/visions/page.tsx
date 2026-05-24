/**
 * Admin Visions list — surfaces existing visions (draft + live) and a
 * prominent "Build new vision" CTA that routes into the M41 Vision
 * Builder. Read-only; promote / archive flows still live under
 * `/sectors/[slug]` because they share the legacy lifecycle UI.
 */

import Link from "next/link";

import { SECTOR_SERVICE_URL, listSectors, type SectorRow } from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function AdminVisionsHome() {
  let rows: SectorRow[];
  try {
    rows = await listSectors();
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold">Visions</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  // Post-M36 pivot: all new sectors are visions; legacy investment-only
  // sectors stay under /sectors but still surface here for completeness.
  const drafts = rows.filter((s) => s.status === "draft");
  const live = rows.filter((s) => s.status === "live");
  const archived = rows.filter((s) => s.status === "archived");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Visions</h1>
          <p className="mt-1 text-[12px] text-neutral-500">
            Vision Feasibility Monitor — every bold technology question
            the platform tracks. {live.length} live · {drafts.length} draft ·{" "}
            {archived.length} archived.
          </p>
        </div>
        <Link
          href="/visions/new"
          className="rounded border border-cyan-700 bg-cyan-900/40 px-4 py-1.5 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60"
        >
          ＋ Build new vision
        </Link>
      </header>

      {drafts.length > 0 && (
        <section className="mt-8">
          <SectionTitle title="Drafts" subtitle="Built by agent, awaiting admin review" />
          <VisionTable rows={drafts} />
        </section>
      )}

      <section className="mt-8">
        <SectionTitle title="Live" subtitle="Surfaced in /visions on the user app" />
        {live.length === 0 ? (
          <p className="mt-3 text-[12px] text-neutral-600">
            No live visions yet. Use “Build new vision” to seed one.
          </p>
        ) : (
          <VisionTable rows={live} />
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-8">
          <SectionTitle title="Archived" subtitle="Hidden from the user app" />
          <VisionTable rows={archived} />
        </section>
      )}
    </main>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
      <p className="text-[11px] text-neutral-500">{subtitle}</p>
    </div>
  );
}

function VisionTable({ rows }: { rows: SectorRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
      <table className="min-w-full text-[12px]">
        <thead>
          <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-2 text-left">Slug</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.slug}
              className="border-b border-neutral-900 last:border-0 hover:bg-neutral-950"
            >
              <td className="px-3 py-2 font-mono text-[11px] text-cyan-300">{s.slug}</td>
              <td className="px-3 py-2 text-neutral-200">{s.name}</td>
              <td className="px-3 py-2">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <Link
                  href={`/sectors/${encodeURIComponent(s.slug)}`}
                  className="text-cyan-400 hover:text-cyan-200"
                >
                  manage ↗
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "live"
      ? "bg-emerald-950/60 text-emerald-300 border-emerald-900"
      : status === "draft"
        ? "bg-amber-950/60 text-amber-300 border-amber-900"
        : "bg-neutral-900 text-neutral-500 border-neutral-800";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}
