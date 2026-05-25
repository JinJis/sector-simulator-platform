/**
 * /community/proposals/new — 5-step wizard.
 *
 * Server wrapper pre-loads sector choices + does the auth redirect.
 * The wizard itself is client-side; state lives in React (no URL
 * persistence for v1).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

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
  const visions = await fetchVisions({ include_legacy: true }).catch(() => []);
  const sectorChoices = visions
    .map((v) => ({ slug: v.slug, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-3 flex gap-2 text-[11px] text-neutral-500">
        <Link href="/community/proposals" className="hover:text-neutral-300">
          ← Proposals
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-50">
          새 제안 작성
        </h1>
        <p className="mt-1 text-[13px] text-neutral-400">
          5단계로 끝납니다 — 종류를 고르고, 섹터를 정하고, 본문을 쓰고,
          상세 필드를 채우고, 근거를 첨부한 뒤 공개합니다.
        </p>
      </header>

      <ProposalWizard
        sectorChoices={sectorChoices}
        defaultSector={params.sector}
      />
    </main>
  );
}
