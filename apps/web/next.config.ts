import type { NextConfig } from "next";

// Proxy browser-side API calls through Next.js so the client uses
// same-origin URLs. Without this, the browser would have to reach
// sector-service directly, which fails whenever apps/web is served from an
// origin other than http://localhost:3000 (Docker on a remote host,
// cloud-workstation preview URL, googlers.com proxy, etc.) — either because
// localhost:8001 isn't on the user's machine, or because of CORS.
//
// As of the tRPC migration, /api/sim now fronts the sector-service Fastify
// app — so /api/sim/trpc/* lands at sector-service:8001/trpc/*. The old
// direct simulation-service rewrite was retired with this slice; the web
// app no longer talks to simulation-service.
const SECTOR_SERVICE_INTERNAL =
  process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001";

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.proxy.googlers.com"],
  async rewrites() {
    return [
      { source: "/api/sim/:path*", destination: `${SECTOR_SERVICE_INTERNAL}/:path*` },
    ];
  },
};

export default config;
