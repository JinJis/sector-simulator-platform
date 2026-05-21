import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  fetchLive,
  fetchSensitivity,
  fetchSim,
  fetchSims,
  SECTOR_SERVICE_URL,
  type LiveResponse,
  type SensitivityResponse,
  type SimMetadata,
} from "@/lib/sim-client";

import { SectorShell } from "./sector-shell";

interface Props {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function SectorLayout({ children, params }: Props) {
  const { slug } = await params;

  let sims: SimMetadata[];
  try {
    sims = await fetchSims();
  } catch (err) {
    return (
      <ErrorShell
        title={`sector-service에 연결할 수 없습니다 (${SECTOR_SERVICE_URL})`}
        detail={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  const userFacing = sims.filter((s) => s.slug !== "placeholder");
  const visibleSims = userFacing.length > 0 ? userFacing : sims;

  if (!visibleSims.find((s) => s.slug === slug)) {
    notFound();
  }

  let meta: SimMetadata;
  let sensitivity: SensitivityResponse | null = null;
  let initialLive: LiveResponse | null = null;
  try {
    meta = await fetchSim(slug);
    [sensitivity, initialLive] = await Promise.all([
      fetchSensitivity(slug).catch(() => null),
      fetchLive(slug).catch(() => null),
    ]);
  } catch (err) {
    return (
      <ErrorShell
        title={`섹터 metadata 로드 실패: ${slug}`}
        detail={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  return (
    <SectorShell
      meta={meta}
      sims={visibleSims}
      sensitivity={sensitivity}
      initialLive={initialLive}
    >
      {children}
    </SectorShell>
  );
}

function ErrorShell({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Tech Sector Simulator</h1>
      <p className="mt-4 text-sm text-red-400">{title}</p>
      <p className="mt-2 text-xs text-neutral-500">{detail}</p>
    </main>
  );
}
