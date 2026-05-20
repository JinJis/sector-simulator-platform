/**
 * Tests for `sim.*` procedures with a mocked simulation-service. We stub
 * `globalThis.fetch` so these run without needing the upstream FastAPI
 * service alive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SIMULATION_SERVICE_URL ??= "http://sim-mock";
// env() validates the *whole* schema at first call, so DATABASE_URL has to
// be set or the proxy hits process.exit even though these tests don't
// touch Prisma. Stubbing here keeps the sim suite runnable without a DB.
process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost/stub";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");

const createCaller = createCallerFactory(appRouter);

function caller() {
  return createCaller({
    log: console as unknown as Parameters<typeof createCaller>[0]["log"],
    requestId: "test-req",
    prisma,
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    return Promise.resolve(handler(url, init));
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sim.list", () => {
  it("proxies /sims and returns the array", async () => {
    mockFetch((url) => {
      expect(url).toMatch(/\/sims$/);
      return jsonResponse([
        {
          slug: "space-data-center",
          name: "Space Data Center",
          description: "x",
          horizon_years: 15,
          drivers: [],
          presets: {},
          provenance: {},
        },
      ]);
    });
    const result = await caller().sim.list();
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("space-data-center");
  });
});

describe("sim.get", () => {
  it("maps 404 to tRPC NOT_FOUND", async () => {
    mockFetch(() => jsonResponse({ detail: "not found" }, 404));
    await expect(caller().sim.get({ slug: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns metadata on success", async () => {
    mockFetch(() =>
      jsonResponse({
        slug: "sofc",
        name: "SOFC",
        description: "x",
        horizon_years: 20,
        drivers: [],
        presets: {},
        provenance: {},
      }),
    );
    const meta = await caller().sim.get({ slug: "sofc" });
    expect(meta.slug).toBe("sofc");
    expect(meta.horizon_years).toBe(20);
  });
});

describe("sim.run", () => {
  it("forwards driver overrides as POST body", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    mockFetch((url, init) => {
      captured = { url, init };
      return jsonResponse({
        slug: "memory-semi",
        drivers: { hbm_premium_x: 7.0 },
        outputs: [],
      });
    });
    const result = await caller().sim.run({
      slug: "memory-semi",
      drivers: { hbm_premium_x: 7.0 },
    });
    expect(captured?.url).toMatch(/\/sims\/memory-semi\/run$/);
    expect(captured?.init?.method).toBe("POST");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ drivers: { hbm_premium_x: 7.0 } });
    expect(result.drivers.hbm_premium_x).toBe(7.0);
  });

  it("maps 400 to tRPC BAD_REQUEST with upstream detail", async () => {
    mockFetch(() => jsonResponse({ detail: "Unknown drivers: ['bogus']" }, 400));
    await expect(
      caller().sim.run({ slug: "space-data-center", drivers: { bogus: 1 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("sim.sensitivity / sim.live", () => {
  it("each proxies the right path", async () => {
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url.endsWith("/sensitivity")) {
        return jsonResponse({ slug: "sofc", by_output: {} });
      }
      return jsonResponse({
        slug: "sofc",
        tick: 1,
        timestamp: "2026-05-20T00:00:00Z",
        drivers: {},
        outputs: [],
      });
    });
    await caller().sim.sensitivity({ slug: "sofc" });
    await caller().sim.live({ slug: "sofc" });
    expect(seen[0]).toMatch(/\/sims\/sofc\/sensitivity$/);
    expect(seen[1]).toMatch(/\/sims\/sofc\/live$/);
  });
});

describe("sim.graph", () => {
  it("proxies /graph and returns nodes + edges", async () => {
    mockFetch((url) => {
      expect(url).toMatch(/\/sims\/space-data-center\/graph$/);
      return jsonResponse({
        slug: "space-data-center",
        nodes: [
          {
            id: "compute_demand_pflops",
            label: "Compute demand",
            kind: "driver",
            group: "Compute",
            unit: "PFLOPS",
            description: "",
          },
          {
            id: "npv_savings_vs_ground_usd",
            label: "NPV savings",
            kind: "output",
            group: "Outputs",
            unit: "USD",
            description: "",
          },
        ],
        edges: [
          {
            source: "compute_demand_pflops",
            target: "npv_savings_vs_ground_usd",
            label: "feeds",
          },
        ],
      });
    });
    const g = await caller().sim.graph({ slug: "space-data-center" });
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes[0]!.kind).toBe("driver");
  });

  it("maps upstream 404 to tRPC NOT_FOUND", async () => {
    mockFetch(() => jsonResponse({ detail: "not found" }, 404));
    await expect(caller().sim.graph({ slug: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
