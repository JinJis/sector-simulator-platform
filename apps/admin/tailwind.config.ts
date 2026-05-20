import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    // @platform/ui sources are imported at build time; without this
    // Tailwind would generate the app's CSS without the classes the
    // shared components actually use.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
