/**
 * Per-request tRPC context. Pulls the Fastify request logger (which
 * already carries `req.id`) so audit log lines can be correlated with the
 * raw HTTP request.
 *
 * Auth context will be added here (current user, tenant) when the auth
 * slice lands. For now everything is anonymous.
 */

import type { FastifyRequest } from "fastify";

import { prisma } from "@platform/db";

export async function createContext({ req }: { req: FastifyRequest }) {
  return {
    log: req.log,
    requestId: req.id,
    prisma,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
