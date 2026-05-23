/**
 * /visions/[slug]/playground — the simulator-as-playground. M37 stub
 * with a pointer to the existing sector workspace; M37c relocates the
 * actual driver-slider workspace here (currently at /sectors/[slug]/manual).
 * M42 adds the WhatIfFeasibility callout that ties slider state to
 * vision composite shift.
 */

import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function PlaygroundIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();

  return (
    <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
        Playground
      </h2>
      <p className="mt-2 text-sm text-neutral-400">
        Driver sliders + what-if Feasibility projection. Migrating here from
        the existing workspace in <strong>M37c</strong>.
      </p>
      <p className="mt-4 text-xs text-neutral-500">
        For now, the legacy workspace is still at{" "}
        <a className="text-cyan-400 hover:underline" href={`/sectors/${slug}/manual`}>
          /sectors/{slug}/manual
        </a>
        .
      </p>
    </section>
  );
}
