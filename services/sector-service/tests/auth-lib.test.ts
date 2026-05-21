/**
 * Unit tests for the pure auth helpers. No DB, no Fastify — verifies
 * bcrypt round-trip + session token shape + expiry math so the
 * password handling has at least one safety net independent of the
 * tRPC procedures.
 */

import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashPassword,
  sessionExpiresAt,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  verifyPassword,
} from "../src/lib/auth.js";

describe("password hashing", () => {
  it("round-trips correctly", async () => {
    const hash = await hashPassword("hunter2-correct-horse");
    expect(hash).not.toEqual("hunter2-correct-horse");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
    expect(await verifyPassword("hunter2-correct-horse", hash)).toBe(true);
    expect(await verifyPassword("hunter2-correct-house", hash)).toBe(false);
  });

  it("produces a distinct hash each call (salt)", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    expect(a).not.toEqual(b);
    expect(await verifyPassword("same-input", a)).toBe(true);
    expect(await verifyPassword("same-input", b)).toBe(true);
  });

  it("rejects empty + whitespace passwords through verify", async () => {
    const hash = await hashPassword("real-password");
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("real-password ", hash)).toBe(false);
  });
});

describe("session tokens", () => {
  it("are base64url, ~43 chars, distinct per call", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).not.toEqual(t2);
    expect(t1.length).toBeGreaterThanOrEqual(43);
    expect(t1.length).toBeLessThanOrEqual(44);
    // base64url alphabet only
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("expiry is 30 days out from now", () => {
    const now = new Date("2026-05-21T00:00:00Z");
    const expiry = sessionExpiresAt(now);
    expect(expiry.getTime() - now.getTime()).toBe(SESSION_DURATION_MS);
    expect(expiry.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("cookie name is stable", () => {
    // If we ever rename this we need a migration story for in-flight
    // sessions; freeze the name here so a rename trips the test.
    expect(SESSION_COOKIE_NAME).toBe("sss_session");
  });
});
