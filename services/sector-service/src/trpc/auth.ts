/**
 * `auth.*` procedures — email + password sign-up / sign-in /
 * sign-out + a `me` lookup that the web client uses to hydrate the
 * header user menu.
 *
 * Session is a cookie-bound opaque token:
 *   1. `signUp` / `signIn` insert a `sessions` row + set the cookie
 *   2. Every request comes back through `createContext`, which loads
 *      the user from `cookies[SESSION_COOKIE_NAME]`
 *   3. `signOut` deletes the row + clears the cookie
 *
 * Cookies are httpOnly + sameSite=lax so XSS can't read them and CSRF
 * is harmless against tRPC POSTs. We don't set `secure` because the
 * platform serves over plain HTTP in dev; production deploys flip
 * `NODE_ENV=production` which enables the flag below.
 */

// Picks up `@fastify/cookie`'s TS augmentation of FastifyRequest /
// FastifyReply (adds `cookies`, `setCookie`, `clearCookie`).
import "@fastify/cookie";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  generateSessionToken,
  hashPassword,
  sessionExpiresAt,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  verifyPassword,
} from "../lib/auth.js";
import { env } from "../lib/env.js";
import { publicProcedure, router } from "./init.js";

const PUBLIC_USER = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  locale: z.string().nullable(),
  theme: z.string().nullable(),
  created_at: z.date(),
});

const EMAIL = z.string().email().max(254).toLowerCase();
const PASSWORD = z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(200);
const NAME = z.string().min(1).max(80);

const SignUpInput = z.object({
  email: EMAIL,
  password: PASSWORD,
  name: NAME.optional(),
});

const SignInInput = z.object({
  email: EMAIL,
  password: PASSWORD,
});

const UpdateMeInput = z.object({
  name: NAME.nullable().optional(),
  locale: z.enum(["ko", "en"]).nullable().optional(),
  theme: z.enum(["dark", "light", "system"]).nullable().optional(),
});

function isProd(): boolean {
  return env().NODE_ENV === "production";
}

function setSessionCookie(
  res: import("fastify").FastifyReply,
  token: string,
): void {
  res.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });
}

function clearSessionCookie(res: import("fastify").FastifyReply): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export const authRouter = router({
  signUp: publicProcedure
    .input(SignUpInput)
    .output(PUBLIC_USER)
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (exists) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "이미 가입된 이메일입니다.",
        });
      }
      const password_hash = await hashPassword(input.password);
      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          password_hash,
          name: input.name ?? null,
        },
      });
      const token = generateSessionToken();
      await ctx.prisma.session.create({
        data: {
          user_id: user.id,
          token,
          expires_at: sessionExpiresAt(),
          user_agent: ctx.req.headers["user-agent"] ?? null,
          ip: ctx.req.ip ?? null,
        },
      });
      setSessionCookie(ctx.res, token);
      ctx.log.info({ user_id: user.id }, "auth.signup");
      return user as z.infer<typeof PUBLIC_USER>;
    }),

  signIn: publicProcedure
    .input(SignInInput)
    .output(PUBLIC_USER)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      // Constant-ish-time: still run bcrypt against a known-bad hash
      // when the user is missing so signup-enumeration is harder.
      const SCRATCH =
        "$2a$10$1111111111111111111111111111111111111111111111111111";
      const ok = await verifyPassword(
        input.password,
        user?.password_hash ?? SCRATCH,
      );
      if (!user || !ok) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "이메일 또는 비밀번호가 올바르지 않습니다.",
        });
      }
      const token = generateSessionToken();
      await ctx.prisma.session.create({
        data: {
          user_id: user.id,
          token,
          expires_at: sessionExpiresAt(),
          user_agent: ctx.req.headers["user-agent"] ?? null,
          ip: ctx.req.ip ?? null,
        },
      });
      setSessionCookie(ctx.res, token);
      ctx.log.info({ user_id: user.id }, "auth.signin");
      return user as z.infer<typeof PUBLIC_USER>;
    }),

  signOut: publicProcedure
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      const token = ctx.req.cookies?.[SESSION_COOKIE_NAME];
      if (token) {
        try {
          await ctx.prisma.session.delete({ where: { token } });
        } catch {
          // already gone — still clear the cookie below
        }
      }
      clearSessionCookie(ctx.res);
      return { ok: true };
    }),

  me: publicProcedure
    .output(PUBLIC_USER.nullable())
    .query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const full = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
      });
      return (full ?? null) as z.infer<typeof PUBLIC_USER> | null;
    }),

  updateMe: publicProcedure
    .input(UpdateMeInput)
    .output(PUBLIC_USER)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "로그인이 필요합니다.",
        });
      }
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.locale !== undefined) data.locale = input.locale;
      if (input.theme !== undefined) data.theme = input.theme;
      if (Object.keys(data).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "변경할 필드가 없습니다.",
        });
      }
      const updated = await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data,
      });
      return updated as z.infer<typeof PUBLIC_USER>;
    }),

  changePassword: publicProcedure
    .input(
      z.object({
        current_password: PASSWORD,
        new_password: PASSWORD,
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다." });
      }
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      const ok = await verifyPassword(input.current_password, user.password_hash);
      if (!ok) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "현재 비밀번호가 일치하지 않습니다.",
        });
      }
      const password_hash = await hashPassword(input.new_password);
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { password_hash },
      });
      // Best practice: revoke all other sessions on password change.
      const currentToken = ctx.req.cookies?.[SESSION_COOKIE_NAME];
      if (currentToken) {
        await ctx.prisma.session.deleteMany({
          where: {
            user_id: user.id,
            NOT: { token: currentToken },
          },
        });
      }
      return { ok: true };
    }),
});
