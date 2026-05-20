# @platform/ui

Shared React components used by both `apps/web` and `apps/admin`. Source-only — no build step; consumers compile the TS directly via `transpilePackages` in their `next.config.ts`.

## Why this package exists

CLAUDE.md mandates that new components ship here first rather than being authored inline in an app. The friction of an extra import path is the point: shared components get reviewed for reuse, app-local quirks get pushed back to the app.

## What's in here today

| Module | Purpose |
|---|---|
| `breadcrumbs` | Server-friendly trail of clickable parent links, ending in the current page. Drop-in for any nested route. |
| `sub-nav` | Horizontal pill row, auto-highlights the active route via `usePathname()`. For hub pages with multiple children (sector detail's live/manual/graph/sources tabs once they become real routes). |

## Conventions

- **Tailwind for styling.** Both consumer apps already include Tailwind; we use class strings directly. No CSS modules, no styled-components.
- **Default dark.** The platform is dark-mode-first; components assume `bg-neutral-950` backdrop.
- **Server-friendly when possible.** Pure-presentational pieces are RSC-safe. Components that need browser state (`usePathname`, click handlers) carry `"use client"`.
- **Tiny surface.** Each component exports one named symbol + its `Props` type. No re-export shenanigans.

## Adding a component

1. New file under `src/`.
2. Add it to the `exports` map in `package.json`.
3. Add it to `src/index.ts` for the lazy `import { X } from "@platform/ui"` path.
4. Update this README.
