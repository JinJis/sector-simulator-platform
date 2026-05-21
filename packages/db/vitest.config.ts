import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // No real DB touched — these are pure-math tests of the mock-quote
    // generator. Default fork pool is fine.
    testTimeout: 5_000,
  },
});
