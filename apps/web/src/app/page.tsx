/**
 * Root home — redirects to the Vision Feasibility Monitor landing.
 *
 * Pre-pivot URL shapes (`/?sector=foo`) and the entire `/sectors/*`
 * family were deleted at the pivot cleanup. Legacy bookmarks 404
 * — git history at commit aa000a7 has the old surface if needed.
 */

import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/visions");
}
