import { Breadcrumbs, SubNav, type SubNavItem } from "@platform/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getVisionFixture } from "../_fixtures";

interface Props {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function VisionLayout({ children, params }: Props) {
  const { slug } = await params;
  const fixture = getVisionFixture(slug);
  if (!fixture) notFound();

  const { vision } = fixture.overview;

  const subnav: SubNavItem[] = [
    { label: "Overview", href: `/visions/${slug}` },
    { label: "Capabilities", href: `/visions/${slug}/capabilities` },
    // M45a: Actor tab — the WHO layer (companies + labs + govt per capability).
    { label: "Actors", href: `/visions/${slug}/actors` },
    { label: "Signals", href: `/visions/${slug}/signals` },
    { label: "Risks", href: `/visions/${slug}/risks` },
    { label: "Economics", href: `/visions/${slug}/economics` },
    { label: "Playground", href: `/visions/${slug}/playground` },
    { label: "Sources", href: `/visions/${slug}/sources` },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <Breadcrumbs
          className="mb-3"
          items={[
            { label: "Visions", href: "/visions" },
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
      <div className="mx-auto max-w-7xl px-6 pb-16">{children}</div>
    </div>
  );
}
