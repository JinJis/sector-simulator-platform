/**
 * Public package surface for `@platform/sector-service`.
 *
 * Consumers (web app, future report-service, etc.) only need the
 * `AppRouter` type to spin up a typed tRPC client — no runtime code
 * crosses the boundary.
 */

export type { AppRouter } from "./trpc/router.js";
