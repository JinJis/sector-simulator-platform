/**
 * Admin login gate — env-driven single account, HMAC-signed cookie.
 *
 * Configured via three env vars (see `.env.example`):
 *   - ADMIN_EMAIL
 *   - ADMIN_PASSWORD
 *   - ADMIN_SESSION_SECRET
 *
 * Cookie format: `${email}.${expiresAtMs}.${hex(hmacSha256(payload))}`.
 * 7-day TTL. Rotating ADMIN_SESSION_SECRET invalidates every session
 * immediately (the hmac no longer verifies).
 *
 * Uses Web Crypto (`globalThis.crypto.subtle`) so the same function set
 * works in middleware (Edge runtime) and server actions / route
 * handlers (Node runtime). No external dep.
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ADMIN_SESSION_COOKIE = "tssp_admin_session";

export interface AdminAuthConfig {
  configured: boolean;
  missing: ("ADMIN_EMAIL" | "ADMIN_PASSWORD" | "ADMIN_SESSION_SECRET")[];
}

export function adminAuthConfig(): AdminAuthConfig {
  const missing: AdminAuthConfig["missing"] = [];
  if (!process.env.ADMIN_EMAIL) missing.push("ADMIN_EMAIL");
  if (!process.env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!process.env.ADMIN_SESSION_SECRET) missing.push("ADMIN_SESSION_SECRET");
  return { configured: missing.length === 0, missing };
}

/** Constant-time string equality. Avoids `==` short-circuit timing leak. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Compare submitted credentials against the env-configured pair. */
export function checkCredentials(email: string, password: string): boolean {
  const cfg = adminAuthConfig();
  if (!cfg.configured) return false;
  const okEmail = constantTimeEqual(email, process.env.ADMIN_EMAIL ?? "");
  const okPass = constantTimeEqual(password, process.env.ADMIN_PASSWORD ?? "");
  return okEmail && okPass;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export interface SignedSession {
  /** Raw cookie value to write into Set-Cookie. */
  value: string;
  expiresAt: Date;
}

/** Sign a session for the given email. Throws when secret missing
 *  — callers should guard with `adminAuthConfig().configured`. */
export async function signSession(email: string): Promise<SignedSession> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET not configured");
  }
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const payload = `${email}.${expiresAt.getTime()}`;
  const hmac = await hmacSha256Hex(secret, payload);
  return { value: `${payload}.${hmac}`, expiresAt };
}

/** Verify a cookie value. Returns the authenticated email or null. */
export async function verifySession(cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue) return null;
  const secret = process.env.ADMIN_SESSION_SECRET;
  const expectedEmail = process.env.ADMIN_EMAIL;
  if (!secret || !expectedEmail) return null;

  // Payload format is `email.expiresAt.hmac`. Email itself may include
  // dots (e.g. dotted-local-part), so split from the right.
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = cookieValue.slice(0, lastDot);
  const hmac = cookieValue.slice(lastDot + 1);
  if (!payload || !hmac) return null;

  const secondLastDot = payload.lastIndexOf(".");
  if (secondLastDot < 0) return null;
  const email = payload.slice(0, secondLastDot);
  const expiresStr = payload.slice(secondLastDot + 1);

  // Quick rejects before the (expensive-ish) HMAC compute.
  if (email !== expectedEmail) return null;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = await hmacSha256Hex(secret, payload);
  if (!constantTimeEqual(hmac, expected)) return null;
  return email;
}

/** Build the cookie options once so the login + logout paths agree. */
export function adminSessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Browsers reject `secure` cookies on http://. In dev (compose,
    // localhost) we serve over plain http; flip on for prod.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
