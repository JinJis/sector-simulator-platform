/**
 * tRPC root — `initTRPC` configured once and shared across procedure files.
 *
 * We carry a per-request audit context on the tRPC context so every
 * procedure can attach structured fields to logs without re-deriving them.
 */

import { initTRPC } from "@trpc/server";

import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Surface zod validation issues nicely for client error display.
        zodIssues: error.cause && "issues" in error.cause ? error.cause.issues : undefined,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure.use(async ({ ctx, path, type, next }) => {
  // Per-procedure audit log. Fastify already logs every HTTP request; this
  // adds the tRPC-level context (procedure path + type) which a plain HTTP
  // log line can't see.
  const started = Date.now();
  const result = await next({ ctx });
  ctx.log.info(
    {
      audit: true,
      proc: path,
      type,
      ok: result.ok,
      duration_ms: Date.now() - started,
    },
    "trpc.call",
  );
  return result;
});
export const createCallerFactory = t.createCallerFactory;
