import { Breadcrumbs } from "@platform/ui";
import { redirect } from "next/navigation";

import { fetchMe } from "@/lib/sim-client";

import { PredictForm } from "./predict-form";

interface SearchParams {
  ticker?: string;
  sector?: string;
}

export const dynamic = "force-dynamic";

export default async function PredictPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await fetchMe();
  if (!user) {
    redirect("/login?redirect=/community/predict");
  }
  const params = await searchParams;
  return (
    <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "커뮤니티", href: "/community" },
          { label: "예측 등록" },
        ]}
      />
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-neutral-50">
          내 예측을 등록해 보세요
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          종목 · 기간 · 예상 변동률을 고르면 자동으로 채점 대상이 됩니다.
          정확도에 따라 포인트를 받습니다.
        </p>
      </header>
      <PredictForm
        initialTicker={params.ticker ?? null}
        initialSectorSlug={params.sector ?? null}
      />
    </main>
  );
}
