/**
 * /visions/[slug]/actors/[key] — actor detail page.
 *
 * M45a: fixture-backed minimal detail (vision relevance + blurb +
 * external links + which capabilities this actor is active on).
 * M45b: tRPC swap + signal feed filtered by actor_id + per-capability
 * role breakdown.
 */

import { ActorPill, countryFlag, type ActorStage } from "@platform/ui";
import { notFound } from "next/navigation";

import { trpc } from "@/lib/sim-client";

import { getVisionFixture } from "../../../_fixtures";

interface Props {
  params: Promise<{ slug: string; key: string }>;
}

const CATEGORY_LABEL: Record<string, string> = {
  public_corp: "Public corporation",
  private_startup: "Private startup",
  government_lab: "Government lab",
  national_lab: "National lab",
  academic_lab: "Academic lab",
  standards_body: "Standards body",
  ngo: "NGO",
};

const STAGE_LABEL: Record<string, string> = {
  research: "Research",
  pilot: "Pilot",
  commercial: "Commercial",
  scaling: "Scaling",
};

export default async function ActorDetailPage({ params }: Props) {
  const { slug, key } = await params;

  // Try DB via actor.get + cross-reference vision.getOverview for
  // per-vision relevance + which capabilities. Fall back to fixture.
  type ActorView = {
    actor_key: string;
    name: string;
    iso_country: string;
    category: string;
    stage: string;
    blurb: string;
    ticker: string | null;
    exchange: string | null;
    relevance: number | null;
    rationale: string | null;
  };
  let actor: ActorView | null = null;
  let activeOn: Array<{
    capability: { key: string; short_name: string | null; name: string };
    role: string;
  }> = [];

  try {
    const overview = await trpc.vision.getOverview.query({ slug, actor_limit: 200 });
    const a = overview.actors.find((x) => x.actor_key === key);
    if (!a) notFound();
    actor = {
      actor_key: a.actor_key,
      name: a.name,
      iso_country: a.iso_country,
      category: a.category,
      stage: a.stage,
      blurb: a.blurb,
      ticker: a.ticker,
      exchange: a.exchange,
      relevance: a.relevance,
      rationale: a.rationale,
    };
    activeOn = overview.capabilities
      .map((c) => {
        const match = c.active_actors.find((aa) => aa.actor_key === key);
        return match
          ? {
              capability: { key: c.key, short_name: c.short_name, name: c.name },
              role: match.role,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  } catch {
    const fixture = getVisionFixture(slug);
    if (!fixture) notFound();
    const a = fixture.overview.actors.find((x) => x.actor_key === key);
    if (!a) notFound();
    actor = {
      actor_key: a.actor_key,
      name: a.name,
      iso_country: a.iso_country,
      category: a.category,
      stage: a.stage,
      blurb: a.blurb,
      ticker: a.ticker,
      exchange: a.exchange,
      relevance: a.relevance,
      rationale: a.rationale,
    };
    activeOn = fixture.overview.capabilities
      .map((c) => {
        const match = c.active_actors.find((aa) => aa.actor_key === key);
        return match
          ? {
              capability: { key: c.key, short_name: c.short_name, name: c.name },
              role: match.role,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  if (!actor) notFound();

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-semibold text-neutral-50">{actor.name}</h2>
          <span aria-label={actor.iso_country.toUpperCase()} className="text-xl">
            {countryFlag(actor.iso_country)}
          </span>
          {actor.ticker && (
            <span className="rounded-sm border border-neutral-800 px-2 py-0.5 font-mono text-[11px] tracking-wider text-neutral-400">
              {actor.ticker}
              {actor.exchange ? ` · ${actor.exchange}` : ""}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-neutral-400">{actor.blurb}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span>
            <strong className="text-neutral-300">
              {CATEGORY_LABEL[actor.category] ?? actor.category}
            </strong>
          </span>
          <span>
            Stage: <strong className="text-neutral-300">{STAGE_LABEL[actor.stage] ?? actor.stage}</strong>
          </span>
          {actor.relevance != null && (
            <span>
              Per-vision relevance:{" "}
              <strong className="text-neutral-300 tabular-nums">{Math.round(actor.relevance)} / 100</strong>
            </span>
          )}
        </div>
      </header>

      {actor.rationale && (
        <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-5">
          <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-300">
            Why this actor matters here
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-200">{actor.rationale}</p>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Active on capabilities
        </h3>
        {activeOn.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No per-capability mapping yet — populated alongside capability seed
            in M45b.
          </p>
        ) : (
          <ul className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
            {activeOn.map((row) => (
              <li
                key={row.capability.key}
                className="flex items-baseline justify-between gap-3"
              >
                <a
                  href={`/visions/${slug}/capabilities/${row.capability.key}`}
                  className="text-sm text-neutral-200 hover:text-cyan-400 hover:underline"
                >
                  {row.capability.short_name || row.capability.name}
                </a>
                <ActorPill
                  actorKey={actor.actor_key}
                  name={"" /* role-only pill */}
                  role={row.role}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-6 text-center">
        <p className="text-xs text-neutral-500">
          Recent signals about this actor — lands when the M39 signal pipeline
          + M45b extractor tagging are online.
        </p>
      </section>
    </div>
  );
}
