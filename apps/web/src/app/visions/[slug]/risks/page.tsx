import { RiskRow, type RiskSeverity } from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function RisksIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const t = await getT();
  const { risks } = fixture.overview;

  if (risks.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
        <p className="text-sm text-neutral-400">{t("risks.empty")}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("risks.title")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {risks.length} {t("risks.activeCount")} {t("risks.matrixComing")}
        </p>
      </div>
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
          />
        ))}
      </div>
    </div>
  );
}
