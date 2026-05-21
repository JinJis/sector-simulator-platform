/**
 * `scenario.*` procedures — CRUD over the `scenarios` table.
 *
 * A Scenario is a named bundle of driver overrides for a given sector
 * (FK on `sector_slug`). The driver_overrides JSON is validated as
 * `Record<string, number>` here — deeper "do these keys exist on the
 * referenced sector?" validation is left to the next slice once the
 * UI starts authoring real overrides.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "./init.js";

const ScenarioOut = z.object({
  id: z.string(),
  sector_slug: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  driver_overrides: z.record(z.number()),
  author_label: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

// Inputs

const DriverOverrides = z.record(z.number().finite());

const CreateInput = z.object({
  sector_slug: z.string().min(1),
  name: z.string().min(1).max(200),
  notes: z.string().max(5000).optional(),
  driver_overrides: DriverOverrides,
  author_label: z.string().max(120).optional(),
});

const UpdateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).nullable().optional(),
  driver_overrides: DriverOverrides.optional(),
});

const IdInput = z.object({ id: z.string().min(1) });

const ListInput = z.object({
  sector_slug: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

export const scenarioRouter = router({
  list: publicProcedure
    .input(ListInput)
    .output(z.array(ScenarioOut))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.scenario.findMany({
        where: input.sector_slug ? { sector_slug: input.sector_slug } : undefined,
        orderBy: { updated_at: "desc" },
        take: input.limit,
      }) as Promise<z.infer<typeof ScenarioOut>[]>;
    }),

  get: publicProcedure
    .input(IdInput)
    .output(ScenarioOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.scenario.findUnique({ where: { id: input.id } });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `scenario ${input.id}` });
      return row as z.infer<typeof ScenarioOut>;
    }),

  create: publicProcedure
    .input(CreateInput)
    .output(ScenarioOut)
    .mutation(async ({ ctx, input }) => {
      // Reject if the referenced sector doesn't exist — surfaces a clean
      // 400 instead of relying on the Postgres FK violation bubbling up.
      const sector = await ctx.prisma.sector.findUnique({
        where: { slug: input.sector_slug },
      });
      if (!sector) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `sector "${input.sector_slug}" is not registered`,
        });
      }
      const created = await ctx.prisma.scenario.create({
        data: {
          sector_slug: input.sector_slug,
          name: input.name,
          notes: input.notes,
          driver_overrides: input.driver_overrides,
          // M20: default to the logged-in user when the caller didn't
          // pass an explicit label (which is the normal case from the
          // web UI — the legacy CLI affordance keeps working).
          author_label: input.author_label ?? ctx.user?.label ?? null,
        },
      });
      ctx.log.info({ scenario_id: created.id, sector_slug: input.sector_slug }, "scenario.created");
      return created as z.infer<typeof ScenarioOut>;
    }),

  update: publicProcedure
    .input(UpdateInput)
    .output(ScenarioOut)
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const data: Record<string, unknown> = {};
      if (rest.name !== undefined) data.name = rest.name;
      if (rest.notes !== undefined) data.notes = rest.notes;
      if (rest.driver_overrides !== undefined) data.driver_overrides = rest.driver_overrides;
      if (Object.keys(data).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "no fields to update" });
      }
      try {
        const updated = await ctx.prisma.scenario.update({ where: { id }, data });
        return updated as z.infer<typeof ScenarioOut>;
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: `scenario ${id}` });
        }
        throw e;
      }
    }),

  delete: publicProcedure
    .input(IdInput)
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.prisma.scenario.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (e) {
        if ((e as { code?: string }).code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: `scenario ${input.id}` });
        }
        throw e;
      }
    }),
});
