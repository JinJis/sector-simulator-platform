/**
 * `sim.*` procedures — thin proxy over services/simulation-service.
 *
 * Schemas are duplicated here (not imported) on purpose: tRPC clients only
 * see the types this router exposes, and we want the boundary explicit.
 * If simulation-service adds a field, we deliberately decide whether to
 * surface it here.
 */

import { z } from "zod";

import { simFetch } from "../lib/sim-proxy.js";
import { publicProcedure, router } from "./init.js";

// ---------- Schemas (mirror simulation-service Pydantic models) ----------

const Driver = z.object({
  name: z.string(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  unit: z.string(),
  description: z.string(),
  group: z.string(),
});

const Output = z.object({
  name: z.string(),
  series: z.array(z.number()).nullable(),
  scalar: z.number().nullable(),
  unit: z.string(),
  description: z.string(),
});

const Source = z.object({
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  as_of: z.string(),
  kind: z.string(),
});

const HistoryPoint = z.object({
  date: z.string(),
  value: z.number(),
});

const Provenance = z.object({
  history: z.array(HistoryPoint),
  sources: z.array(Source),
  note: z.string(),
});

const SimMetadata = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  horizon_years: z.number(),
  drivers: z.array(Driver),
  presets: z.record(z.record(z.number())),
  provenance: z.record(Provenance),
});

const SimRunResponse = z.object({
  slug: z.string(),
  drivers: z.record(z.number()),
  outputs: z.array(Output),
});

const SensitivityEntry = z.object({
  driver: z.string(),
  swing: z.number(),
});

const SensitivityResponse = z.object({
  slug: z.string(),
  by_output: z.record(z.array(SensitivityEntry)),
});

const LiveResponse = z.object({
  slug: z.string(),
  tick: z.number(),
  timestamp: z.string(),
  drivers: z.record(z.number()),
  outputs: z.array(Output),
});

const SlugInput = z.object({ slug: z.string().min(1) });

// ---------- Procedures ----------

export const simRouter = router({
  list: publicProcedure
    .output(z.array(SimMetadata))
    .query(() => simFetch("/sims", { context: "sims" })),

  get: publicProcedure
    .input(SlugInput)
    .output(SimMetadata)
    .query(({ input }) => simFetch(`/sims/${input.slug}`, { context: `sim:${input.slug}` })),

  run: publicProcedure
    .input(SlugInput.extend({ drivers: z.record(z.number()) }))
    .output(SimRunResponse)
    .mutation(({ input }) =>
      simFetch(`/sims/${input.slug}/run`, {
        method: "POST",
        body: { drivers: input.drivers },
        context: `sim.run:${input.slug}`,
      }),
    ),

  sensitivity: publicProcedure
    .input(SlugInput)
    .output(SensitivityResponse)
    .query(({ input }) =>
      simFetch(`/sims/${input.slug}/sensitivity`, {
        context: `sim.sensitivity:${input.slug}`,
      }),
    ),

  live: publicProcedure
    .input(SlugInput)
    .output(LiveResponse)
    .query(({ input }) =>
      simFetch(`/sims/${input.slug}/live`, { context: `sim.live:${input.slug}` }),
    ),
});
