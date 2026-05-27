/**
 * Fastify entrypoint. Wires the tRPC router under `/trpc/*` and exposes a
 * lightweight `/health` for liveness probes.
 *
 * Pino is enabled by default with a per-request `req.id` — that ID flows
 * into the tRPC context so audit log lines correlate to the underlying
 * HTTP request.
 */

import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";

import { registerStripeWebhook } from "./lib/billing-webhook.js";
import { env } from "./lib/env.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

async function main(): Promise<void> {
  const cfg = env();

  const fastify = Fastify({
    logger: {
      level: cfg.LOG_LEVEL,
      // Pretty in dev, JSON in everything else.
      transport:
        cfg.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
          : undefined,
    },
    // Built-in request-id propagation: clients can pass X-Request-Id, else
    // Fastify generates one. We surface it on tRPC context for log correlation.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  await fastify.register(cors, {
    origin: cfg.NODE_ENV === "production" ? false : true,
    credentials: true,
  });

  await fastify.register(cookie, {
    // No signed cookies (yet) — the session token IS the secret. When
    // we move to signed/rotating tokens this gains a real secret from
    // env or a secrets manager.
  });

  await fastify.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path?: string; error: { code: string; message: string } }) {
        fastify.log.error({ proc: path, code: error.code, err: error.message }, "trpc.error");
      },
    },
  });

  fastify.get("/health", () => ({
    status: "ok",
    service: "sector-service",
    upstream: { simulation_service: cfg.SIMULATION_SERVICE_URL },
  }));

  // Stripe webhook (raw body verification — registered before tRPC's
  // JSON content-type takes over for /trpc/*).
  registerStripeWebhook(fastify);

  try {
    await fastify.listen({ host: cfg.HOST, port: cfg.PORT });
    fastify.log.info(
      {
        port: cfg.PORT,
        host: cfg.HOST,
        upstream: cfg.SIMULATION_SERVICE_URL,
        trpc_procedure_count: Object.keys(appRouter._def.procedures).length,
      },
      "sector-service listening",
    );
  } catch (err) {
    fastify.log.error(err, "sector-service failed to start");
    process.exit(1);
  }
}

void main();
