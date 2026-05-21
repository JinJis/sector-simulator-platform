/**
 * Stripe webhook handler — registered on Fastify directly (not tRPC)
 * because signature verification needs the raw request body.
 *
 * Idempotency: every event is appended to `billing_events` keyed by
 * `event.id` (Stripe's, not ours). Stripe retries the same event id
 * on transient failures, so the unique constraint catches double
 * processing.
 *
 * State sync: on `customer.subscription.{created,updated,deleted}` we
 * upsert `billing_subscriptions` and flip the user's `tier` based on
 * whether they have any active sub.
 */

import "@fastify/cookie"; // augmentation passthrough — keep parity with auth

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Stripe from "stripe";

import { prisma } from "@platform/db";

import { env } from "./env.js";
import { stripe, stripeConfigured } from "./stripe.js";

const ACTIVE_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
]);

export function registerStripeWebhook(app: FastifyInstance): void {
  // Stripe POSTs `application/json` but we need the raw bytes to verify
  // the signature. Add a content-type parser that hands us the buffer.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/billing/webhook", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!stripeConfigured()) {
      return reply.code(503).send({ error: "stripe not configured" });
    }
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: "webhook secret missing" });
    }
    const sig = req.headers["stripe-signature"];
    if (!sig || typeof sig !== "string") {
      return reply.code(400).send({ error: "missing stripe-signature header" });
    }
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw)) {
      return reply.code(400).send({ error: "raw body required" });
    }

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(raw, sig, secret);
    } catch (e) {
      req.log.warn({ err: e instanceof Error ? e.message : String(e) }, "stripe webhook signature failed");
      return reply.code(400).send({ error: "invalid signature" });
    }

    // Idempotency: upsert into billing_events. If already seen, no-op.
    try {
      await prisma.billingEvent.create({
        data: {
          stripe_event_id: event.id,
          type: event.type,
          payload: event as unknown as object,
        },
      });
    } catch (e) {
      // P2002 = unique constraint — already processed.
      if ((e as { code?: string }).code === "P2002") {
        req.log.info({ event_id: event.id }, "stripe webhook replay (already processed)");
        return reply.code(200).send({ received: true, replay: true });
      }
      throw e;
    }

    try {
      await dispatch(event, req.log);
    } catch (e) {
      // Persist anyway (we already did) and tell Stripe to retry.
      req.log.error({ err: e, event_id: event.id, type: event.type }, "stripe webhook handler failed");
      return reply.code(500).send({ error: "handler failed" });
    }

    return reply.code(200).send({ received: true });
  });
}

async function dispatch(
  event: Stripe.Event,
  log: FastifyRequest["log"],
): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription, log);
      break;
    case "checkout.session.completed":
      // Subscription created event will follow with the actual sub
      // detail; we just log for traceability.
      log.info({ event_id: event.id }, "checkout completed");
      break;
    default:
      log.debug({ type: event.type }, "stripe webhook event ignored");
  }
}

async function syncSubscription(
  sub: Stripe.Subscription,
  log: FastifyRequest["log"],
): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const customerRow = await prisma.billingCustomer.findUnique({
    where: { stripe_customer_id: customerId },
  });
  if (!customerRow) {
    log.warn(
      { customer: customerId, sub: sub.id },
      "subscription event for unknown customer; ignoring",
    );
    return;
  }

  // Stripe subscriptions have at least one item; we read its price +
  // current period from the first item.
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? "";
  const periodStart = item?.current_period_start
    ? new Date(item.current_period_start * 1000)
    : new Date(sub.start_date * 1000);
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : new Date(sub.start_date * 1000);

  await prisma.billingSubscription.upsert({
    where: { stripe_subscription_id: sub.id },
    create: {
      customer_id: customerRow.id,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      status: sub.status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    update: {
      stripe_price_id: priceId,
      status: sub.status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });

  // Recompute the user's tier: premium if any subscription is in an
  // active-ish status; otherwise free.
  const activeCount = await prisma.billingSubscription.count({
    where: {
      customer_id: customerRow.id,
      status: { in: Array.from(ACTIVE_STATUSES) },
    },
  });
  const nextTier = activeCount > 0 ? "premium" : "free";
  await prisma.user.update({
    where: { id: customerRow.user_id },
    data: { tier: nextTier },
  });
  await prisma.auditLog.create({
    data: {
      action: "billing.subscription.sync",
      sector_slug: null,
      payload: {
        user_id: customerRow.user_id,
        subscription_id: sub.id,
        status: sub.status,
        tier: nextTier,
      },
      author_label: "stripe-webhook",
    },
  });
  log.info(
    {
      user_id: customerRow.user_id,
      sub_id: sub.id,
      status: sub.status,
      tier: nextTier,
    },
    "billing subscription synced",
  );
}
