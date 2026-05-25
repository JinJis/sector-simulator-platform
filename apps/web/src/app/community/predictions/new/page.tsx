/**
 * /community/predictions/new — placement form.
 *
 * Server wrapper preloads available sectors + equities so the form
 * dropdown renders instantly. Auth check redirects anonymous users.
 *
 * Query params: `?equity=<id>&sector=<slug>` deep-link from the
 * equity / sector pages.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { fetchEquities, fetchMe } from "@/lib/sim-client";
import { fetchVisions } from "@/lib/vision-client";

import { PlacePredictionForm } from "./place-prediction-form";

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
  const visions = await fetchVisions({ include_legacy: true }).catch(() => []);
  const sectorChoices = visions
    .map((v) => ({ slug: v.slug, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Default sector: from query param, else first available.
  const defaultSector = params.sector ?? sectorChoices[0]?.slug ?? "";
  const equityChoices = defaultSector
    ? await fetchEquities(defaultSector).catch(() => [])
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/predictions" className="hover:text-neutral-300">
          ← Predictions
        </Link>
      </nav>
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">
          Place a prediction
        </h1>
        <p className="mt-1 text-[12px] text-neutral-500">
          Pick a stock, set a price band, choose a horizon. We auto-
          assign the difficulty tier — wider bands + longer horizons +
          lower volatility = Easy; tight bands + short horizons + high
          volatility = Hard. Reward = score × tier × 10 points.
        </p>
      </header>

      <PlacePredictionForm
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
