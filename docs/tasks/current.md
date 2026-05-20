# Current task — Phase 0 vertical slice

**Status**: scaffolded (2026-05-19)
**Sector**: placeholder (toy compound-growth sim — swap for real sector next)

## Shipped in this slice

- pnpm + Turborepo workspace root (`package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- uv workspace (`pyproject.toml` at root); shared TS config (`tsconfig.base.json`)
- `packages/sdk-python` — `SimulationBase`, `Driver`, `Output`, `resolve_drivers`
- `services/simulation-service` — FastAPI app
  - `GET /health`
  - `GET /sims`, `GET /sims/{slug}` — metadata (drivers w/ defaults + ranges)
  - `POST /sims/{slug}/run` — run with driver overrides
  - `PlaceholderSim` registered (compound growth, 2 drivers, 1 output series)
- `apps/web` — Next.js 15 App Router page
  - Server component fetches sim metadata from simulation-service
  - Client component renders driver sliders + Recharts line chart, refetches outputs on slider change
  - Dark mode default, Tailwind 3
- `docs/tasks/current.md` — this file

## Verifying locally

Prerequisites: Node 20+, pnpm 9+, Python 3.12+, uv installed (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
pnpm install
uv sync
pnpm dev
```

`pnpm dev` runs `apps/web` on :3000 and `services/simulation-service` on :8000 in parallel via Turborepo.

Visit http://localhost:3000 — sliders should update the chart with ~no perceptible latency (all local, ~3ms compute).

## Phase 0 backlog (DESIGN.md §9 — pick up next)

- [ ] GitHub Actions CI (typecheck / lint / test gates)
- [ ] Prisma schema v1 + Postgres in `docker-compose.yml`
- [ ] First real sector ("AI Memory Demand"): replace `PlaceholderSim`
- [ ] `services/api-gateway` (Fastify + tRPC) — currently `apps/web` hits simulation-service directly
- [ ] `apps/admin` skeleton (sector CRUD UI)
- [ ] `packages/ui` — promote `<Slider>`, `<OutputChart>` out of `apps/web` once a second app needs them
- [ ] `packages/sdk-ts` — typed client (currently inlined in `apps/web/src/lib/sim-client.ts`)
- [ ] `packages/shared-types` — Zod schemas mirroring Pydantic, FE/BE shared types
- [ ] Terraform skeleton (`infra/terraform`)
- [ ] Auth (Clerk) + billing (Stripe) bootstrap
- [ ] Observability: Sentry SDK init in `apps/web` + simulation-service

## Out of scope until later phases

- `services/agent-orchestration`, `services/validation-service`, `packages/agent-tools`, `prompts/` (Phase 2+)
- Modal/E2B sandbox integration (Phase 2)
- LangSmith / Helicone, LLM cost meters (Phase 2)
- React Flow causal graph (Phase 1 — needs >1 node first)
- Monte Carlo / sensitivity endpoints (`monte_carlo`, `sensitivity` exist on `SimulationBase` but raise `NotImplementedError`)

## Architecture notes for the slice

- **Direct FE → simulation-service**: no API gateway in front yet. Acceptable for Phase 0; introduce `services/api-gateway` (Fastify + tRPC) before adding auth or a second core service.
- **Determinism**: `PlaceholderSim.simulate` is pure (no time/randomness), satisfies the caching invariant from CLAUDE.md.
- **CORS**: simulation-service allows `http://localhost:3000` only. Update when deploying.
- **Driver units**: stored as string on `Driver` and propagated through the API. `growth_rate_pct` uses `%`; integer-percent semantics handled in `simulate` (divide by 100).
