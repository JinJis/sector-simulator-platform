/**
 * /sectors/[slug]/narrative — M17 page absorbed into Overview by M23.
 *
 * The investment-narrative content (thesis + drivers / blockers +
 * per-equity upside grid) now lives on the sector Overview page +
 * the Stocks page. This route stays as a permanent redirect so
 * existing bookmarks and external share links don't 404.
 */

import { redirect } from "next/navigation";

interface Params {
  slug: string;
}

export default async function NarrativeRedirect({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  redirect(`/sectors/${slug}`);
}
