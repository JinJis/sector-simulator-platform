/**
 * Test-only context stub. Fills in the FastifyReply / FastifyRequest /
 * user slots that the production `createContext` populates so existing
 * router tests (sim / scenario / graph / agent) don't have to mock the
 * entire Fastify request lifecycle just to call a procedure.
 *
 * Procedures that touch `ctx.res.setCookie` or `ctx.user` should have
 * their own dedicated tests; this stub deliberately throws if those
 * are touched so a future "I tested the wrong procedure here" mistake
 * surfaces loudly.
 */

import type { Context } from "../src/trpc/context.js";

export function stubContext(extras: Partial<Context> = {}): Context {
  const reqStub = {
    headers: {},
    cookies: {},
    ip: "127.0.0.1",
    log: console,
    id: "test-req",
  } as unknown as Context["req"];

  const resStub = {
    setCookie: () => {
      throw new Error("test stub: ctx.res.setCookie called without override");
    },
    clearCookie: () => {
      throw new Error("test stub: ctx.res.clearCookie called without override");
    },
  } as unknown as Context["res"];

  const { prisma, ...rest } = extras;
  if (!prisma) {
    throw new Error("stubContext: prisma is required");
  }
  return {
    log: console as unknown as Context["log"],
    requestId: "test-req",
    prisma,
    res: resStub,
    req: reqStub,
    user: null,
    ...rest,
  } as Context;
}
