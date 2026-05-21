/**
 * Lazy Stripe SDK accessor.
 *
 * The SDK is optional — when `STRIPE_SECRET_KEY` is unset (dev /
 * pre-launch), we degrade gracefully: checkout endpoints throw
 * `PRECONDITION_FAILED` and webhooks are 503. Importing here doesn't
 * fail; only the first call does.
 */

import Stripe from "stripe";

import { env } from "./env.js";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY not set");
  }
  cached = new Stripe(key, {
    // Pin the API version so an SDK update can't silently change
    // behavior under us. Bump deliberately in a single commit when
    // we want to opt in to a newer API surface.
    apiVersion: "2026-04-22.dahlia",
  });
  return cached;
}

export function stripeConfigured(): boolean {
  return !!env().STRIPE_SECRET_KEY && !!env().STRIPE_PRICE_ID;
}
