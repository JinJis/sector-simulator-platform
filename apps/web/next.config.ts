import type { NextConfig } from "next";

// Proxy browser-side simulation calls through Next.js so the client uses
// same-origin URLs. Without this, the browser would have to reach
// simulation-service directly, which fails whenever apps/web is served from
// an origin other than http://localhost:3000 (Docker on a remote host,
// cloud-workstation preview URL, googlers.com proxy, etc.) — either because
// localhost:8000 isn't on the user's machine, or because of CORS.
const SIM_SERVICE_INTERNAL =
  process.env.SIMULATION_SERVICE_URL ?? "http://localhost:8000";

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.proxy.googlers.com"],
  async rewrites() {
    return [
      { source: "/api/sim/:path*", destination: `${SIM_SERVICE_INTERNAL}/:path*` },
    ];
  },
};

export default config;
