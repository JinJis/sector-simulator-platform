/**
 * Auth primitives — password hashing + opaque session-token generation.
 *
 * Kept small on purpose. M20 ships email + password with a 30-day
 * session cookie; OAuth, magic links, MFA, rotating signed tokens, and
 * device fingerprinting all live behind a future slice (Phase 4).
 */

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

/** Bcrypt cost factor. 10 is the modern Node default — about 60ms on a
 *  laptop, slow enough to deter brute force, fast enough that sign-in
 *  feels instant. */
const BCRYPT_ROUNDS = 10;

/** 30 days — long enough that "stay signed in" feels natural, short
 *  enough that a stolen cookie eventually expires. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "sss_session";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * 32 random bytes, base64url-encoded. ~43 chars, cookie-safe.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_DURATION_MS);
}
