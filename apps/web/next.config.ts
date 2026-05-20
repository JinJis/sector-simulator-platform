import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.proxy.googlers.com"],
};

export default config;
