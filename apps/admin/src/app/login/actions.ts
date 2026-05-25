"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_COOKIE,
  adminAuthConfig,
  adminSessionCookieOptions,
  checkCredentials,
  signSession,
} from "@/lib/admin-auth";

export type LoginState =
  | { ok: true }
  | { ok: false; error: string };

const SAFE_NEXT = /^\/[^/].*/; // single leading slash, no protocol-relative redirects

function safeNext(next: string | null): string {
  if (!next) return "/";
  // Reject protocol-relative or absolute URLs to defuse open-redirects.
  if (!SAFE_NEXT.test(next)) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const cfg = adminAuthConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: `Admin login not configured. Missing: ${cfg.missing.join(", ")} — set them in .env and restart the admin container.`,
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "/");

  if (!email || !password) {
    return { ok: false, error: "Email + password required." };
  }
  if (!checkCredentials(email, password)) {
    return { ok: false, error: "Invalid credentials." };
  }

  const session = await signSession(email);
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, session.value, {
    ...adminSessionCookieOptions(),
    expires: session.expiresAt,
  });

  // Redirect throws — Next handles it as a 303 from the action.
  redirect(safeNext(nextParam));
}
