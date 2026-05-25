import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";

import { getVisionFixture } from "../../_fixtures";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function EconomicsIndexPage({ params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const t = await getT();

  return (
    <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
        {t("economics.title")}
      </h2>
      <p className="mt-2 text-sm text-neutral-400">{t("economics.coming")}</p>
    </section>
  );
}
