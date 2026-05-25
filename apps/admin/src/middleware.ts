import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE, verifySession } from "@/lib/admin-auth";

// Runs at the edge for every request that doesn't match the static
// whitelist in `config.matcher`. Cheap path: verify the cookie HMAC
// and forward; otherwise 302 → /login?next=<original>.
export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const email = await verifySession(cookie);
  if (email) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  const nextPath = req.nextUrl.pathname + req.nextUrl.search;
  if (nextPath && nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }
  // 307 (not 302) so POSTs preserve method + body on the redirect — but
  // we redirect them at the login page anyway, so it barely matters.
  return NextResponse.redirect(loginUrl);
}

// Skip the gate for:
//   - /login itself (would loop)
//   - /api/admin/auth/* (the login + logout endpoints set the cookie)
//   - Next internals (all of /_next/* — static, image, data, HMR
//     websocket in dev, error overlay stack frames). The narrower
//     `_next/static|_next/image` matcher used initially missed
//     `/_next/data/*` (App Router data fetches) and broke RSC nav.
//   - favicon
// `matcher` is a negative lookahead — anything NOT matching these is
// guarded. Tweak only when adding new public asset paths.
export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|login|api/admin/auth).*)"],
};
