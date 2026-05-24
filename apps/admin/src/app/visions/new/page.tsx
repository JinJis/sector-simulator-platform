/**
 * M41 Vision Builder admin entry. Server wrapper around the client
 * builder form so the page metadata + breadcrumb render with the
 * regular layout while the agent run lives entirely client-side
 * (synchronous tRPC mutation, no streaming).
 */

import Link from "next/link";

import { VisionBuilderForm } from "./builder-form";

export const dynamic = "force-dynamic";

export default function NewVisionPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/visions" className="hover:text-neutral-300">
          ← Visions
        </Link>
      </nav>
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">Build a new vision</h1>
        <p className="mt-1 text-[12px] text-neutral-500">
          Natural-language prompt → validated capability tree + actors
          + risks + signal sources, ready for admin review and
          one-click commit into the live DB.
        </p>
      </header>

      <VisionBuilderForm />

      <section className="mt-12 rounded-lg border border-neutral-800 bg-neutral-950/40 p-5 text-[11px] leading-relaxed text-neutral-400">
        <h2 className="text-xs font-semibold text-neutral-300">
          What happens when you submit
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <strong className="text-neutral-200">Validator (haiku):</strong>{" "}
            checks the prompt is a real tech vision, not off-topic /
            vague / duplicate. ~$0.001.
          </li>
          <li>
            <strong className="text-neutral-200">Decomposition (opus):</strong>{" "}
            structural capability tree + dependencies + risks + actors.
            ~$0.40 per build.
          </li>
          <li>
            <strong className="text-neutral-200">Data sources (sonnet):</strong>{" "}
            per-capability arXiv / USPTO / news keyword sets for the M39
            ingest cron. ~$0.005.
          </li>
          <li>
            <strong className="text-neutral-200">Validation gate (pure Py):</strong>{" "}
            DAG cycle check, FK integrity, weight normalization. Errors
            block commit; warnings just inform.
          </li>
          <li>
            <strong className="text-neutral-200">Review:</strong> the
            draft renders below. Edit names / weights / actor lists
            inline (M41d v1: limited; v2 adds full edit panes).
          </li>
          <li>
            <strong className="text-neutral-200">Commit:</strong> one
            Prisma transaction inserts the Vision into the live DB as
            status="draft". Promote to "live" from the Sectors page
            when ready.
          </li>
        </ol>
      </section>
    </main>
  );
}
