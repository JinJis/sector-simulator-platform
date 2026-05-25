import { Breadcrumbs, SubNav, type SubNavItem } from "@platform/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getT } from "@/lib/i18n/server";

import { getVisionFixture } from "../_fixtures";

interface Props {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function VisionLayout({ children, params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();
  const t = await getT();

  const { vision } = fixture.overview;

  const subnav: SubNavItem[] = [
    { label: t("subnav.overview"), href: `/visions/${slug}` },
    { label: t("subnav.capabilities"), href: `/visions/${slug}/capabilities` },
    { label: t("subnav.actors"), href: `/visions/${slug}/actors` },
    { label: t("subnav.signals"), href: `/visions/${slug}/signals` },
    { label: t("subnav.risks"), href: `/visions/${slug}/risks` },
    { label: t("subnav.economics"), href: `/visions/${slug}/economics` },
    { label: t("subnav.playground"), href: `/visions/${slug}/playground` },
    { label: t("subnav.sources"), href: `/visions/${slug}/sources` },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <Breadcrumbs
          className="mb-3"
          items={[
            { label: t("visions.title"), href: "/visions" },
            { label: vision.name },
          ]}
        />
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
            {vision.name}
          </h1>
          {vision.vision_question && (
            <p className="mt-1 text-sm italic text-neutral-400">
              {vision.vision_question}
            </p>
          )}
        </header>
        <SubNav items={subnav} className="mb-6" />
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-16">{children}</div>
    </div>
  );
}
