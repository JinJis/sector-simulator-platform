/**
 * /visions/[slug]/risks — risk board detail page.
 *
 * MP4: switched from fixture-only to tRPC `risk.list` (fixture as
 * fallback). Embeds a Severity × Likelihood matrix at the top so the
 * user gets a 5-second read on the risk landscape, then the per-risk
 * rows below carry a SourceChip drilling to the underlying filing /
 * report / news article.
 */

import {
  RiskMatrix,
  type RiskMatrixCell,
  type RiskMatrixLikelihood,
  type RiskMatrixSeverity,
  RiskRow,
  type RiskSeverity,
} from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { trpc } from "@/lib/sim-client";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

type RiskView = {
  key: string;
  category: string;
  name: string;
  description: string;
  severity: string;
  likelihood: string;
  time_horizon: string;
  source_url: string | null;
  source_kind: string | null;
  source_title: string | null;
};

const SEVERITIES: RiskMatrixSeverity[] = ["low", "medium", "high", "critical"];
const LIKELIHOODS: RiskMatrixLikelihood[] = ["low", "medium", "high"];

function isMatrixSeverity(s: string): s is RiskMatrixSeverity {
  return (SEVERITIES as string[]).includes(s);
}
function isMatrixLikelihood(l: string): l is RiskMatrixLikelihood {
  return (LIKELIHOODS as string[]).includes(l);
}

function bucketRisks(risks: RiskView[]): RiskMatrixCell[] {
  const buckets = new Map<string, number>();
  for (const r of risks) {
    if (!isMatrixSeverity(r.severity) || !isMatrixLikelihood(r.likelihood))
      continue;
    const k = `${r.severity}|${r.likelihood}`;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const cells: RiskMatrixCell[] = [];
  for (const s of SEVERITIES) {
    for (const l of LIKELIHOODS) {
      cells.push({ severity: s, likelihood: l, count: buckets.get(`${s}|${l}`) ?? 0 });
    }
  }
  return cells;
}

export default async function RisksIndexPage({ params }: Props) {
  const { slug } = await params;
  const t = await getT();

  let risks: RiskView[] = [];
  try {
    const rows = await trpc.risk.list.query({ sector_slug: slug });
    risks = rows.map((r) => ({
      key: r.key,
      category: r.category,
      name: r.name,
      description: r.description,
      severity: r.severity,
      likelihood: r.likelihood,
      time_horizon: r.time_horizon,
      source_url: r.source_url,
      source_kind: r.source_kind,
      source_title: r.source_title,
    }));
  } catch {
    const fixture = getVisionFixture(slug);
    if (!fixture) notFound();
    risks = fixture.overview.risks.map((r) => ({
      key: r.key,
      category: r.category,
      name: r.name,
      description: r.description,
      severity: r.severity,
      likelihood: r.likelihood,
      time_horizon: r.time_horizon,
      source_url: r.source_url ?? null,
      source_kind: r.source_kind ?? null,
      source_title: r.source_title ?? null,
    }));
  }

  if (risks.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">{t("risks.empty")}</p>
      </section>
    );
  }

  const cells = bucketRisks(risks);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("risks.title")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {risks.length} {t("risks.activeCount")} · severity × likelihood matrix
          below, source-grounded rows beneath.
        </p>
      </div>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <RiskMatrix cells={cells} />
      </section>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2" role="list">
        {risks.map((r) => (
          <RiskRow
            key={r.key}
            category={r.category}
            name={r.name}
            description={r.description}
            severity={r.severity as RiskSeverity}
            likelihood={r.likelihood as "low" | "medium" | "high"}
            timeHorizon={r.time_horizon}
            source={
              r.source_url
                ? {
                    url: r.source_url,
                    title: r.source_title ?? r.name,
                    kind: r.source_kind ?? undefined,
                  }
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}
