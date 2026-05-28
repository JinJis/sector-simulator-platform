/**
 * /visions/[slug]/playground — the simulator-as-playground. Driver
 * sliders + outputs + saved scenarios. M37c migrates the existing
 * /sectors/[slug]/manual workspace into the Vision URL space; M42 adds
 * the WhatIfFeasibility callout that ties slider state to vision
 * composite shift.
 *
 * Implementation strategy: this server component fetches the same data
 * the legacy sector layout was using, then a thin client wrapper
 * (PlaygroundClient) sets up SectorContext + renders the existing
 * ManualPanel / ScenarioBar / ReportPanel / LiveStrip. We deliberately
 * REUSE rather than duplicate the existing components — duplication
 * would have to be merged again at M42, and the existing components
 * already work.
 */

import { notFound } from "next/navigation";

import {
  fetchLive,
  fetchSensitivity,
  fetchSim,
  type LiveResponse,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";
import {
  fetchVisionOverview,
  fetchVisionSummary,
  type VisionOverview,
} from "@/lib/vision-client";

import { PlaygroundClient } from "./playground-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function PlaygroundPage({ params }: Props) {
  const { slug } = await params;
  // DB-driven (F6): vision must exist in DB or 404. Old code
  // 404'd against the fixture, which made unknown slugs disappear
  // but also accepted demo slugs that weren't seeded.
  try {
    await fetchVisionSummary(slug);
  } catch {
    notFound();
  }

  // Fetch the same sim payloads the sector layout uses. If sim-service
  // is unreachable, render an inline error rather than 500-ing the page.
  // M42: also fetch vision overview so the WhatIfFeasibility callout can
  // project composite shifts from slider state. Overview fetch is best-
  // effort — if sector-service is down, suppress the callout instead of
  // failing the whole page (the sim still works).
  let meta: SimMetadata;
  let sensitivity: SensitivityResponse | null = null;
  let initialLive: LiveResponse | null = null;
  let overview: VisionOverview | null = null;
  try {
    meta = await fetchSim(slug);
    [sensitivity, initialLive, overview] = await Promise.all([
      fetchSensitivity(slug).catch(() => null),
      fetchLive(slug).catch(() => null),
      fetchVisionOverview(slug).catch(() => null),
    ]);
  } catch (err) {
    return (
      <section className="rounded-xl border border-amber-500/50 bg-amber-950/20 p-6 text-sm">
        <p className="font-medium text-amber-300">
          Couldn't load simulation metadata for <code>{slug}</code>.
        </p>
        <p className="mt-2 text-amber-200/80">
          {err instanceof Error ? err.message : String(err)}
        </p>
        <p className="mt-3 text-xs text-amber-200/60">
          The hero page above still works — only the Playground sliders
          require simulation-service to be reachable.
        </p>
      </section>
    );
  }

  return (
    <PlaygroundClient
      meta={meta}
      sensitivity={sensitivity}
      initialLive={initialLive}
      overview={overview}
    />
  );
}
