import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    // @platform/ui sources are imported at build time; without this
    // Tailwind would generate the app's CSS without the classes the
    // shared components actually use.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  // Class-based dark mode: <html class="dark"> toggles every `dark:*`
  // variant. The ThemeProvider client writes this class on mount based
  // on the user's `User.theme` (dark | light | system).
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
