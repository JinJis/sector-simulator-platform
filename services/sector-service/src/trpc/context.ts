/**
 * Per-request tRPC context. Pulls the Fastify request logger (which
 * already carries `req.id`) so audit log lines correlate to the raw
 * HTTP request.
 *
 * M20: also resolves the current user from the session cookie. tRPC
 * mutations that need to record the actor (graph edits, scenario CRUD,
 * lifecycle decisions) read `ctx.user` and fall back to "anonymous"
 * when absent — anonymous browse still works.
 *
 * The cookie is set / cleared inside `auth.*` procedures via
 * `ctx.res.setCookie(...)` / `clearCookie(...)`. We pass the Fastify
 * reply through so the auth router has somewhere to write.
 */

// Picks up `@fastify/cookie`'s TS augmentation so `req.cookies` is
// statically typed.
import "@fastify/cookie";

import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "@platform/db";

import { SESSION_COOKIE_NAME } from "../lib/auth.js";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  /** Author label that mutations should record. Defaults to email. */
  label: string;
}

export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];

  let user: CurrentUser | null = null;
  if (token) {
    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });
      if (session && session.expires_at > new Date()) {
        user = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          label: session.user.name || session.user.email,
        };
      }
    } catch {
      // Don't fail the request if session lookup hits a transient DB
      // hiccup — log it via the request logger and treat as anonymous.
      req.log.warn("session lookup failed");
    }
  }

  return {
    log: req.log,
    requestId: req.id,
    prisma,
    res,
    req,
    user,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
