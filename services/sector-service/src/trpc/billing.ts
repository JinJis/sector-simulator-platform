/**
 * `billing.*` procedures — Stripe Checkout + Customer Portal.
 *
 * Webhook handling lives outside tRPC (in server.ts) because Stripe
 * requires the raw request body for signature verification — JSON-
 * parsing it ahead of time breaks the verification. The tRPC entry
 * points here only handle initiating + redirecting.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "../lib/env.js";
import { stripe, stripeConfigured } from "../lib/stripe.js";
import { publicProcedure, router } from "./init.js";

function requireUser(ctx: import("./context.js").Context) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "결제는 로그인 후 가능합니다.",
    });
  }
  return ctx.user;
}

function requireStripe() {
  if (!stripeConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "결제 시스템이 아직 구성되지 않았습니다. (STRIPE_* env 미설정 — 베타 기간엔 모든 기능이 무료로 풀려 있습니다.)",
    });
  }
}

export const billingRouter = router({
  /**
   * Tells the client whether Stripe is wired. The Settings page uses
   * this to decide whether to show "Premium 업그레이드" as an active
   * link or as the "stub" alert from M25.
   */
  status: publicProcedure
    .output(
      z.object({
        configured: z.boolean(),
        beta_free: z.boolean(),
      }),
    )
    .query(() => ({
      configured: stripeConfigured(),
      beta_free: env().AGENT_BETA_FREE,
    })),

  /**
   * Returns the active subscription (if any) for the current user.
   * Drives the "현재 플랜" section.
   */
  mySubscription: publicProcedure
    .output(
      z
        .object({
          status: z.string(),
          current_period_end: z.date(),
          cancel_at_period_end: z.boolean(),
          stripe_price_id: z.string(),
        })
        .nullable(),
    )
    .query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const sub = await ctx.prisma.billingSubscription.findFirst({
        where: {
          customer: { user_id: ctx.user.id },
          status: { in: ["trialing", "active", "past_due"] },
        },
        orderBy: { current_period_end: "desc" },
      });
      if (!sub) return null;
      return {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        stripe_price_id: sub.stripe_price_id,
      };
    }),

  /**
   * Create a Stripe Checkout Session. Returns the hosted-checkout URL;
   * the client redirects via window.location.
   */
  checkout: publicProcedure
    .output(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx }) => {
      const user = requireUser(ctx);
      requireStripe();
      // Upsert a BillingCustomer + Stripe Customer once per user.
      const existing = await ctx.prisma.billingCustomer.findUnique({
        where: { user_id: user.id },
      });
      let customerId: string;
      if (existing) {
        customerId = existing.stripe_customer_id;
      } else {
        const created = await stripe().customers.create({
          email: user.email,
          name: user.name ?? undefined,
          metadata: { app_user_id: user.id },
        });
        customerId = created.id;
        await ctx.prisma.billingCustomer.create({
          data: {
            user_id: user.id,
            stripe_customer_id: customerId,
            email: user.email,
          },
        });
      }
      const session = await stripe().checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: env().STRIPE_PRICE_ID, quantity: 1 }],
        success_url: env().STRIPE_SUCCESS_URL,
        cancel_url: env().STRIPE_CANCEL_URL,
        // The webhook will pick this up and link the subscription
        // back to the customer + user.
        metadata: { app_user_id: user.id },
      });
      if (!session.url) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe Checkout session URL이 비어있습니다.",
        });
      }
      return { url: session.url };
    }),

  /**
   * Customer Portal — Stripe-hosted page where the user manages
   * payment method, cancels, etc.
   */
  portal: publicProcedure
    .output(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx }) => {
      const user = requireUser(ctx);
      requireStripe();
      const customer = await ctx.prisma.billingCustomer.findUnique({
        where: { user_id: user.id },
      });
      if (!customer) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe 고객 정보가 없습니다 — 먼저 결제를 진행해 주세요.",
        });
      }
      const session = await stripe().billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: env().STRIPE_CANCEL_URL,
      });
      return { url: session.url };
    }),
});
