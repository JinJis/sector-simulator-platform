# @platform/ui

Shared React components used by both `apps/web` and `apps/admin`.
Source-only — no build step; consumers compile the TS directly via
`transpilePackages` in their `next.config.ts`.

## Why this package exists

CLAUDE.md mandates that new shared components ship here first rather
than being authored inline in an app. The friction of an extra import
path is the point: shared components get reviewed for reuse, app-local
quirks get pushed back to the app.

## What's in here today

### Vision Hero family (M37a + M45a)

| Component | Use |
|---|---|
| `FeasibilityGauge` | 0-100 dial with color ramp (rose < 30 < amber < 60 < emerald) + 90-day delta + ETA chip |
| `DimensionBars` | 4-dim horizontal bars (technical / economic / regulatory / supply) |
| `CapabilityCard` | Hero capability tile: name + score + binding pill + dimension bars + latest signal + active actors footer |
| `RiskRow` | Risk-board row: severity × likelihood + horizon + affected capabilities |
| `SignalRow` | Live signal feed row: source-kind pill + title + 4-dim deltas + actor pill |
| `EtaWindow` | ETA distribution display (P10 — median — P90 with confidence band) |
| `TrajectorySparkline` | 6-month feasibility trajectory inline chart |
| `EconomicsCurveChart` | Cost curve of new tech vs incumbent baseline + crossover marker |
| `VisionCard` | `/visions` landing-grid tile with domain theme + headline numbers |
| `ActorCard` | Logo + name + flag + stage pill + latest signal (Actors band on Hero) |
| `ActorPill` | Compact inline pill for capability footers + signal rows |

### Layout / nav primitives

| Component | Use |
|---|---|
| `Breadcrumbs` | Server-friendly nav trail of clickable parent links, ending in the current page |
| `SubNav` | Horizontal pill row that auto-highlights the active route via `usePathname()`. Used for the `/visions/[slug]/*` sub-tabs |
| `Sparkline` | Tiny inline chart for headline numbers (capability score history, equity price history, etc.) |

Each component exports one named symbol + its `Props` type. The barrel
at `src/index.ts` re-exports them all so `import { X } from "@platform/ui"`
works; the per-component subpath (`@platform/ui/feasibility-gauge`) is
also available for finer-grained imports.

## Conventions

- **Tailwind for styling.** Both consumer apps already include Tailwind;
  we use class strings directly. No CSS modules, no styled-components.
- **Dark default + light mode aware.** The platform is dark-first; the
  light-theme overrides live in `apps/web/src/app/globals.css` and key
  off `html.light`. Pick neutral-* utilities so they get repainted
  automatically; use accent colors (cyan / emerald / amber / rose) for
  signal — they read on both backgrounds.
- **Server-friendly when possible.** Pure-presentational pieces are
  RSC-safe. Components that need browser state (`usePathname`, click
  handlers, charts) carry `"use client"`.
- **No i18n inside the package.** Components accept already-translated
  strings as props. The `useT()` hook lives in `apps/web` because the
  cookie / dict is web-app concern; admin app uses its own translator.
- **Tiny surface.** No re-export shenanigans, no implicit defaults.

## Adding a component

1. New file under `src/`.
2. Add it to the `exports` map in `package.json`.
3. Add it to `src/index.ts` for the lazy `import { X } from "@platform/ui"` path.
4. Update this README's component table.

Pending additions (currently in `apps/web`, will migrate up when the
surface stabilizes): `ProposalCard`, `ProposalStatusPill`, `VoteButtons`,
and the M47 `DiscussionThread`.
