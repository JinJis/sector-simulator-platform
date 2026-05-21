/**
 * Tests for `agent.*` procedures. The upstream agent-orchestration
 * service is mocked via globalThis.fetch so these run without
 * requiring the FastAPI service alive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SIMULATION_SERVICE_URL ??= "http://sim-mock";
process.env.AGENT_ORCHESTRATION_URL ??= "http://agent-mock";
// Stub for the env validator — see sim.test.ts.
process.env.DATABASE_URL ??= "postgresql://stub:stub@localhost/stub";

const { prisma } = await import("@platform/db");
const { createCallerFactory } = await import("../src/trpc/init.js");
const { appRouter } = await import("../src/trpc/router.js");
const { stubContext } = await import("./stub-context.js");

const createCaller = createCallerFactory(appRouter);

// Agent procedures became auth-required in M27 (budget check needs a
// user). Tests inject a fake CurrentUser; the procedures don't actually
// touch the DB for the user id beyond the budget query, which
// gracefully degrades when prisma is unreachable in the in-memory test
// environment.
function caller() {
  return createCaller(
    stubContext({
      prisma,
      user: {
        id: "test-user",
        email: "test@example.com",
        name: "Test",
        label: "test@example.com",
      },
    }),
  );
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
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

const SAMPLE_RECORD = {
  id: "wf_abc123",
  kind: "decomposition",
  status: "running",
  created_at: "2026-05-20T00:00:00Z",
  updated_at: "2026-05-20T00:00:00Z",
  input: { description: "x" },
  output: null,
  error: null,
  cost_usd: 0,
};

describe("agent.startDecomposition", () => {
  it("posts description + reference_data and returns the record", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    mockFetch((url, init) => {
      captured = { url, init };
      return jsonResponse(SAMPLE_RECORD, 202);
    });
    const result = await caller().agent.startDecomposition({
      description: "A long-enough sector description to clear validation",
      reference_data: "prior similar sector context",
    });
    expect(captured?.url).toMatch(/\/workflows\/decompose$/);
    expect(captured?.init?.method).toBe("POST");
    const body = JSON.parse(String(captured?.init?.body));
    expect(body.description).toMatch(/long-enough/);
    expect(body.reference_data).toBe("prior similar sector context");
    expect(result.id).toBe("wf_abc123");
  });

  it("rejects too-short descriptions at the tRPC boundary", async () => {
    mockFetch(() => jsonResponse(SAMPLE_RECORD, 202));
    await expect(
      caller().agent.startDecomposition({ description: "short" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps upstream 422 validation to BAD_REQUEST", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          detail: [
            { loc: ["body", "description"], msg: "ensure this value has at least 10 characters" },
          ],
        },
        422,
      ),
    );
    await expect(
      caller().agent.startDecomposition({
        description: "Valid input here, but upstream rejects.",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("agent.getWorkflow", () => {
  it("returns the workflow record", async () => {
    mockFetch((url) => {
      expect(url).toMatch(/\/workflows\/wf_abc123$/);
      return jsonResponse({ ...SAMPLE_RECORD, status: "succeeded" });
    });
    const rec = await caller().agent.getWorkflow({ id: "wf_abc123" });
    expect(rec.status).toBe("succeeded");
  });

  it("maps 404 to NOT_FOUND", async () => {
    mockFetch(() => jsonResponse({ detail: "not found" }, 404));
    await expect(caller().agent.getWorkflow({ id: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("agent.listWorkflows", () => {
  it("encodes kind + limit as query string", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse([SAMPLE_RECORD]);
    });
    await caller().agent.listWorkflows({ kind: "decomposition", limit: 25 });
    expect(capturedUrl).toMatch(/kind=decomposition/);
    expect(capturedUrl).toMatch(/limit=25/);
  });

  it("omits kind when not supplied", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse([]);
    });
    await caller().agent.listWorkflows({ limit: 10 });
    expect(capturedUrl).not.toMatch(/kind=/);
    expect(capturedUrl).toMatch(/limit=10/);
  });
});

describe("agent.cancelWorkflow", () => {
  it("posts to /cancel and returns the (cancelled) record", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    mockFetch((url, init) => {
      captured = { url, init };
      return jsonResponse({ ...SAMPLE_RECORD, status: "cancelled" });
    });
    const rec = await caller().agent.cancelWorkflow({ id: "wf_abc123" });
    expect(captured?.url).toMatch(/\/workflows\/wf_abc123\/cancel$/);
    expect(captured?.init?.method).toBe("POST");
    expect(rec.status).toBe("cancelled");
  });
});

describe("missing AGENT_ORCHESTRATION_URL", () => {
  it("returns PRECONDITION_FAILED with a clear message", async () => {
    // Reload env with the URL unset. The env() helper caches its result,
    // so we have to clear the env module's cache. Easiest path: use a
    // dedicated import + reset.
    const envModule = await import("../src/lib/env.js");
    // Pull AGENT_ORCHESTRATION_URL out, force a re-parse.
    const prior = process.env.AGENT_ORCHESTRATION_URL;
    delete process.env.AGENT_ORCHESTRATION_URL;
    // Reach into the module to bust the cached env. Acceptable because
    // env.ts is a workspace-internal helper, not public API.
    (envModule as unknown as { _resetForTests?: () => void })._resetForTests?.();
    try {
      await expect(
        caller().agent.getWorkflow({ id: "anything" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (prior !== undefined) process.env.AGENT_ORCHESTRATION_URL = prior;
      (envModule as unknown as { _resetForTests?: () => void })._resetForTests?.();
    }
  });
});
