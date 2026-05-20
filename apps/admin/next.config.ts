import type { NextConfig } from "next";

// Same rewrite trick as apps/web: the browser hits /api/sim/* (same-origin)
// and Next forwards to the sector-service container. Lets us keep CORS off
// while still allowing cloud-workstation / proxy origins.
const SECTOR_SERVICE_INTERNAL =
  process.env.SECTOR_SERVICE_URL ?? "http://localhost:8001";

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.proxy.googlers.com"],
  // @platform/ui exports raw .tsx source — Next has to transpile it
  // because the workspace package doesn't ship pre-built JS.
  transpilePackages: ["@platform/ui"],
  async rewrites() {
    return [
      { source: "/api/sim/:path*", destination: `${SECTOR_SERVICE_INTERNAL}/:path*` },
    ];
  },
};

export default config;
