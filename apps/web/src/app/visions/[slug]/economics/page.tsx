/**
 * /visions/[slug]/economics — full cost curves, TCO comparisons,
 * break-even / sensitivity. M37 stub; M40 wires the actual feasibility
 * engine outputs.
 */

import { notFound } from "next/navigation";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function EconomicsIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();

  return (
    <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
        Economics
      </h2>
      <p className="mt-2 text-sm text-neutral-400">
        Cost curves + unit economics + break-even sensitivity — coming soon.
      </p>
    </section>
  );
}
