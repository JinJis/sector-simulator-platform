/**
 * /community/proposals/new — proposal creation form.
 *
 * Server wrapper pre-loads the sector list so the form can render a
 * dropdown without an extra round-trip. Sign-in check is server-side;
 * anonymous users get redirected.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { fetchMe } from "@/lib/sim-client";
import { fetchVisions } from "@/lib/vision-client";

import { NewProposalForm } from "./new-proposal-form";

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
  const visions = await fetchVisions({ include_legacy: true }).catch(() => []);
  const sectorChoices = visions.map((v) => ({ slug: v.slug, name: v.name }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/proposals" className="hover:text-neutral-300">
          ← Proposals
        </Link>
      </nav>
      <header>
        <h1 className="text-xl font-semibold text-neutral-100">
          Propose a change
        </h1>
        <p className="mt-1 text-[12px] text-neutral-500">
          Suggest a new driver, equity, capability, risk, actor, or
          signal source. Add evidence (URLs or notes) — the more
          grounded your proposal, the faster it gets applied.
        </p>
      </header>

      <NewProposalForm
        sectorChoices={sectorChoices}
        defaultSector={params.sector ?? sectorChoices[0]?.slug ?? ""}
      />
    </main>
  );
}
