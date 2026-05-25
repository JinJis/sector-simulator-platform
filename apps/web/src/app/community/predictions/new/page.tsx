/**
 * /community/predictions/new — 3-step wizard (Stock → Bet → Review).
 *
 * Server wrapper does auth redirect + preloads sectors + the first
 * sector's equities so the wizard renders instantly.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { fetchEquities, fetchMe } from "@/lib/sim-client";
import { fetchVisions } from "@/lib/vision-client";

import { PredictionWizard } from "./prediction-wizard";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ equity?: string; sector?: string }>;
}

export default async function NewPredictionPage({ searchParams }: Props) {
  const params = await searchParams;
  const me = await fetchMe();
  if (!me) {
    redirect(
      `/sign-in?next=${encodeURIComponent("/community/predictions/new")}`,
    );
  }
  const t = await getT();
  const visions = await fetchVisions({ include_legacy: true }).catch(() => []);
  const sectorChoices = visions
    .map((v) => ({ slug: v.slug, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const defaultSector = params.sector ?? sectorChoices[0]?.slug ?? "";
  const equityChoices = defaultSector
    ? await fetchEquities(defaultSector).catch(() => [])
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/predictions" className="hover:text-neutral-300">
          {t("prediction.new.backLink")}
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-50">
          {t("prediction.new.title")}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-400">
          {t("prediction.new.subtitle")}
        </p>
      </header>

      <PredictionWizard
        sectorChoices={sectorChoices}
        initialSector={defaultSector}
        initialEquityChoices={equityChoices.map((e) => ({
          id: e.id,
          ticker: e.ticker,
          exchange: e.exchange,
          company_name: e.company_name,
          last_close_local: e.last_close_local,
        }))}
        initialEquityId={params.equity ?? equityChoices[0]?.id ?? ""}
      />
    </main>
  );
}
