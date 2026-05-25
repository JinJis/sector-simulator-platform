/**
 * Domain → visual theme map (emoji + accent color + gradient).
 *
 * Each vision has a `domain_label` (Space / Energy / Compute / Bio /
 * Robotics / Materials / Transport / Finance / Other). We map to a
 * cohesive theme so the /visions grid reads at a glance — Space is
 * always indigo + 🛰, Energy is always orange + ⚡ etc.
 *
 * The fallback (`other`) is intentional muted-neutral so themed
 * cards POP against non-domain ones.
 */

export interface DomainTheme {
  /** Stable key — used as the value of `?domain=` query + the
   *  DomainFilter button identity. */
  key: string;
  emoji: string;
  /** Tailwind-compatible color tokens. */
  accent: string; // text-* color for the emoji + badge
  border: string; // border-* on the card
  bg: string; // bg-* gradient anchor
  glow: string; // shadow + gradient anchor
  /** Friendly label for the badge. */
  label: string;
}

const THEMES: Record<string, DomainTheme> = {
  space: {
    key: "space",
    emoji: "🛰️",
    accent: "text-indigo-300",
    border: "border-indigo-900/60 hover:border-indigo-700",
    bg: "from-indigo-950/40",
    glow: "shadow-indigo-900/30",
    label: "Space",
  },
  energy: {
    key: "energy",
    emoji: "⚡",
    accent: "text-amber-300",
    border: "border-amber-900/60 hover:border-amber-700",
    bg: "from-amber-950/40",
    glow: "shadow-amber-900/30",
    label: "Energy",
  },
  compute: {
    key: "compute",
    emoji: "🧠",
    accent: "text-cyan-300",
    border: "border-cyan-900/60 hover:border-cyan-700",
    bg: "from-cyan-950/40",
    glow: "shadow-cyan-900/30",
    label: "Compute",
  },
  bio: {
    key: "bio",
    emoji: "🧬",
    accent: "text-emerald-300",
    border: "border-emerald-900/60 hover:border-emerald-700",
    bg: "from-emerald-950/40",
    glow: "shadow-emerald-900/30",
    label: "Bio",
  },
  robotics: {
    key: "robotics",
    emoji: "🤖",
    accent: "text-rose-300",
    border: "border-rose-900/60 hover:border-rose-700",
    bg: "from-rose-950/40",
    glow: "shadow-rose-900/30",
    label: "Robotics",
  },
  materials: {
    key: "materials",
    emoji: "⚗️",
    accent: "text-fuchsia-300",
    border: "border-fuchsia-900/60 hover:border-fuchsia-700",
    bg: "from-fuchsia-950/40",
    glow: "shadow-fuchsia-900/30",
    label: "Materials",
  },
  transport: {
    key: "transport",
    emoji: "🛞",
    accent: "text-sky-300",
    border: "border-sky-900/60 hover:border-sky-700",
    bg: "from-sky-950/40",
    glow: "shadow-sky-900/30",
    label: "Transport",
  },
  finance: {
    key: "finance",
    emoji: "📊",
    accent: "text-lime-300",
    border: "border-lime-900/60 hover:border-lime-700",
    bg: "from-lime-950/40",
    glow: "shadow-lime-900/30",
    label: "Finance",
  },
  semi: {
    key: "semi",
    emoji: "💾",
    accent: "text-cyan-300",
    border: "border-cyan-900/60 hover:border-cyan-700",
    bg: "from-cyan-950/40",
    glow: "shadow-cyan-900/30",
    label: "Semiconductor",
  },
  other: {
    key: "other",
    emoji: "✨",
    accent: "text-neutral-300",
    border: "border-neutral-800 hover:border-neutral-700",
    bg: "from-neutral-900",
    glow: "shadow-neutral-900",
    label: "Other",
  },
};

/**
 * Resolve a theme from a free-form domain label (e.g. "Energy",
 * "Space Tech", "Compute"). Defaults to "other" when no match. Also
 * accepts slugs (memory-semi → semi, space-data-center → space, etc.)
 */
export function themeForVision(domain: string | null | undefined, slug: string): DomainTheme {
  const haystack = `${domain ?? ""} ${slug}`.toLowerCase();
  if (haystack.includes("space")) return THEMES.space!;
  if (/(energy|fusion|sofc|battery|grid)/.test(haystack)) return THEMES.energy!;
  if (/(quantum|compute|ai\b|hbm|memory|chip)/.test(haystack)) {
    if (haystack.includes("memory") || haystack.includes("hbm") || haystack.includes("semi")) {
      return THEMES.semi!;
    }
    return THEMES.compute!;
  }
  if (/(bio|mrna|drug|cancer|gene|cell)/.test(haystack)) return THEMES.bio!;
  if (/(robot|humanoid|auton)/.test(haystack)) return THEMES.robotics!;
  if (/(material|superconduct|polymer)/.test(haystack)) return THEMES.materials!;
  if (/(transport|ev|mobility|launch)/.test(haystack)) return THEMES.transport!;
  if (/(finance|fintech|payment|defi)/.test(haystack)) return THEMES.finance!;
  return THEMES.other!;
}

export const ALL_DOMAIN_THEMES = THEMES;
