/**
 * `@platform/db` — shared Prisma client.
 *
 * Import the singleton with:
 *   import { prisma } from "@platform/db";
 *
 * Or pull schema types:
 *   import type { Sector, Scenario } from "@platform/db";
 *
 * Re-exports the full `@prisma/client` namespace so callers don't have to
 * depend on it directly.
 */

import { PrismaClient } from "@prisma/client";

// Cache the client across Next.js hot reloads in dev. Without this, the
// HMR loop opens a new connection on every edit and Postgres rejects new
// ones after a few minutes ("too many clients already").
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
