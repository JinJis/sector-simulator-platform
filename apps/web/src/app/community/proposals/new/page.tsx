/**
 * /community/proposals/new — 5-step wizard.
 *
 * Server wrapper pre-loads sector choices + does the auth redirect.
 * The wizard itself is client-side; state lives in React (no URL
 * persistence for v1).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { fetchMe } from "@/lib/sim-client";
import { fetchVisions } from "@/lib/vision-client";

import { ProposalWizard } from "./proposal-wizard";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ sector?: string }>;
}

export default async function NewProposalPage({ searchParams }: Props) {
  const params = await searchParams;
  const me = await fetchMe();
  if (!me) {
    redirect(
      `/sign-in?next=${encodeURIComponent("/community/proposals/new")}`,
    );
  }
  const t = await getT();
  const visions = await fetchVisions({ include_legacy: true }).catch(() => []);
  const sectorChoices = visions
    .map((v) => ({ slug: v.slug, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/proposals" className="hover:text-neutral-300">
          {t("proposal.new.backLink")}
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-50">
          {t("proposal.new.title")}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-400">
          {t("proposal.new.subtitle")}
        </p>
      </header>

      <ProposalWizard
        sectorChoices={sectorChoices}
        defaultSector={params.sector}
      />
    </main>
  );
}
