# Tech Sector Simulator Platform

> AI-agent-driven analysis platform that turns industries into simulatable causal graphs and validates the future against real-time data.

This README is a code-level tour. For product vision/personas/business model, see [DESIGN.md](./DESIGN.md). For day-to-day operating context (conventions, gotchas, common tasks), see [CLAUDE.md](./CLAUDE.md).

---

## 1. Current state — Phase 0 vertical slice

The repo is in **Phase 0**: a hand-written, deterministic simulation runs end-to-end. A user opens the web app, drags sliders, and a chart re-renders against a FastAPI backend. There is no database, no auth, no agent layer yet — those come in Phases 1–3.

What is wired up right now:

| Layer | Component | Status |
|---|---|---|
| Frontend | `apps/web` — Next.js 15 App Router | ✅ Slider × chart workspace |
| Backend | `services/simulation-service` — FastAPI | ✅ `/health`, `/sims`, `/sims/{slug}`, `/sims/{slug}/run` |
| SDK | `packages/sdk-python` — `SimulationBase`, `Driver`, `Output` | ✅ Minimal contract |
| Sim | `PlaceholderSim` (compound-growth toy) | ✅ Registered |
| Infra | Turborepo + pnpm + uv workspaces | ✅ Wired |
| Infra | Docker Compose (local / dev / prod) | ✅ This commit |
| DB / Auth / Agents / API gateway | — | ⏳ Not yet (see backlog in `docs/tasks/current.md`) |

---

## 2. Repository layout

```
.
├── apps/
│   └── web/                       # Next.js 15 (App Router, RSC, Tailwind, Recharts)
│       ├── src/app/
│       │   ├── layout.tsx         # Root layout, dark theme
│       │   ├── page.tsx           # RSC: fetches sim metadata server-side
│       │   ├── sim-workspace.tsx  # Client: sliders + chart, refetches on change
│       │   └── globals.css        # Tailwind + dark scheme
│       └── src/lib/sim-client.ts  # Typed fetch wrapper for simulation-service
│
├── services/
│   └── simulation-service/        # FastAPI on :8000
│       └── simulation_service/
│           ├── main.py            # App, CORS, route handlers
│           ├── schemas.py         # Pydantic v2 I/O models
│           ├── registry.py        # slug → SimulationBase subclass
│           └── sims/
│               └── placeholder.py # PlaceholderSim (compound growth)
│
├── packages/
│   └── sdk-python/                # Importable SDK (uv workspace member)
│       └── platform_sdk/
│           └── base.py            # SimulationBase, Driver, Output, resolve_drivers
│
├── infra/
│   └── docker/                    # Dockerfiles (multi-stage: dev + prod targets)
│       ├── web.Dockerfile
│       └── simulation-service.Dockerfile
│
├── docs/
│   ├── adr/                       # Architectural Decision Records
│   └── tasks/current.md           # Active task & backlog
│
├── docker-compose.yml             # Base service definitions
├── docker-compose.local.yml       # Local override — hot reload, source bind-mounts
├── docker-compose.dev.yml         # Dev override — built images, verbose logs
├── docker-compose.prod.yml        # Prod override — optimized images, restart policies
│
├── turbo.json                     # Turborepo task graph
├── pnpm-workspace.yaml            # JS workspace (apps/*, packages/*, services/*)
├── pyproject.toml                 # uv workspace root (packages/sdk-python, services/simulation-service)
├── tsconfig.base.json             # Shared strict TS config
└── .env.example                   # NEXT_PUBLIC_SIMULATION_SERVICE_URL, plus phase-1+ placeholders
```

Per `CLAUDE.md`, additional directories (`apps/admin`, `services/api-gateway`, `services/agent-orchestration`, etc.) are reserved for later phases and not yet present.

---

## 3. Code walkthrough

### 3.1 `packages/sdk-python/platform_sdk/base.py` — the contract

The single most important file. The frontend is **sector-agnostic** because every sim conforms to this interface:

- **`Driver`** *(frozen dataclass)* — declarative input: `default`, `range=(low, high)`, optional `unit`, `description`. Validates that `default` lies inside `range` at construction.
- **`Output`** *(frozen dataclass)* — declarative output: either a `series` (per-year vector) or a `scalar`, with `unit` and `description`.
- **`SimulationBase`** *(class)* — every sim subclasses this and sets `slug`, `name`, `drivers: dict[str, Driver]`, `horizon_years`, then implements `simulate(**kwargs) -> dict[str, Output]`.
  - `resolve_drivers(supplied)` fills in defaults for any drivers the caller omitted and **raises `ValueError` on unknown driver names** — this is what backs the `400` response from the API.
  - `monte_carlo()` and `sensitivity()` exist as `NotImplementedError` stubs; intentionally deferred to a later phase.

Determinism is a hard invariant — sims must be pure functions of their drivers because the future caching layer keys on `hash(sector_id, code_version, drivers_dict)`.

### 3.2 `services/simulation-service` — execution API

A thin FastAPI shell over the SDK. There is no business logic here other than wiring.

- **`main.py`** — three routes plus `/health`:
  - `GET /sims` — list all registered sim metadata
  - `GET /sims/{slug}` — single sim metadata (drivers with ranges, units)
  - `POST /sims/{slug}/run` — body `{ drivers: {name: value, ...} }` → returns resolved drivers and computed outputs

  Unknown slug → `404`. Unknown driver name → `400` (raised by `resolve_drivers`). CORS is currently locked to `http://localhost:3000`; **update this when deploying**.

- **`schemas.py`** — Pydantic v2 mirrors of the SDK dataclasses for HTTP I/O (`DriverSchema`, `OutputSchema`, `SimMetadata`, `SimRunRequest`, `SimRunResponse`).

- **`registry.py`** — `_REGISTRY: dict[str, type[SimulationBase]]`. To add a sim: import its class and add `Cls.slug: Cls` here.

- **`sims/placeholder.py`** — `PlaceholderSim`: 2 drivers (`annual_growth_rate_pct`, `base_value`), 1 output series over an 11-year horizon (`year 0 … horizon_years`). Compound growth, fully deterministic.

### 3.3 `apps/web` — Next.js frontend

- **`src/app/page.tsx`** *(Server Component)* — fetches sim metadata at request time (`cache: "no-store"`) and either renders the workspace or an error card if the backend is unreachable.

- **`src/app/sim-workspace.tsx`** *(Client Component)* — owns slider state in a `Record<string, number>`. On every change, fires `runSim` inside `useTransition` (so the UI stays responsive), pipes outputs into a Recharts `<LineChart>`. A `cancelled` flag guards against stale responses arriving out of order — important because the user can drag a slider faster than the network round-trip.

- **`src/lib/sim-client.ts`** — typed fetch wrapper. `SIM_SERVICE_URL` reads `NEXT_PUBLIC_SIMULATION_SERVICE_URL` (default `http://localhost:8000`). Will be replaced by a generated tRPC client once `services/api-gateway` lands.

- **Tailwind** is configured in dark mode by default (`color-scheme: dark` + `bg-neutral-950`).

### 3.4 Build orchestration

- **Turborepo** (`turbo.json`) — task graph for `dev`, `build`, `lint`, `typecheck`, `test`. `pnpm dev` runs `apps/web` (`next dev`) and `services/simulation-service` (`uvicorn --reload`) in parallel.
- **uv workspace** (`pyproject.toml`) — `platform-sdk` is consumed as a workspace dependency by `simulation-service` so changes to the SDK are picked up without publishing.

---

## 4. Quickstart (without Docker)

```bash
# prerequisites: Node 20+, pnpm 9+, Python 3.12+, uv
pnpm install
uv sync
cp .env.example .env
pnpm dev
```

Open <http://localhost:3000>. Drag sliders. Chart updates on every change (compute is local, <5 ms).

API smoke-check:

```bash
curl http://localhost:8000/sims
curl -X POST http://localhost:8000/sims/placeholder/run \
  -H 'Content-Type: application/json' \
  -d '{"drivers": {"annual_growth_rate_pct": 12}}'
```

---

## 5. Docker Compose — `local` / `dev` / `prod`

Three modes, expressed as a base file plus a per-mode override. The base file (`docker-compose.yml`) defines services and networks; each override adjusts build target, mounts, command, and restart policy.

| Mode | Use case | Build target | Hot reload | Source mounts | Restart policy |
|---|---|---|---|---|---|
| `local` | Inner-loop dev on your machine | `dev` | **Yes** (Next.js + uvicorn `--reload`) | bind-mounted | `no` |
| `dev` | Shared dev/staging environment | `prod` | No | none (baked in) | `unless-stopped` |
| `prod` | Production deploy | `prod` | No | none (baked in) | `always` |

### 5.1 Running

Use `docker compose -f docker-compose.yml -f docker-compose.<mode>.yml up`:

```bash
# Local — hot reload, code edits reflect immediately
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# Dev — built images, verbose logs
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# Prod — optimized images, auto-restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Or set `COMPOSE_FILE` once in your shell:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml
docker compose up --build
```

### 5.2 What `local` mode actually does

- `apps/web` runs `pnpm dev` inside the container with `./apps/web` bind-mounted; Next.js's file watcher triggers Fast Refresh on save. `node_modules` is kept on a named volume so host/container Node ABIs don't collide.
- `services/simulation-service` runs `uvicorn --reload`; `./services/simulation-service` and `./packages/sdk-python` are both bind-mounted, so changes to either propagate without a rebuild.
- `WATCHPACK_POLLING=true` and `CHOKIDAR_USEPOLLING=true` are set so file watching works reliably on macOS/Windows Docker Desktop and on some Linux bind-mount drivers.

### 5.3 What `dev` / `prod` mode actually does

- Both build the `prod` Dockerfile stage. `apps/web` runs `next start` against the standalone build; `simulation-service` runs `uvicorn` (no `--reload`).
- `dev` keeps `NODE_ENV=production` but allows verbose logs and exposes ports directly to the host for easy probing.
- `prod` adds `restart: always` and drops the host port bindings for the API service in favor of internal networking — the gateway/ingress in front (not yet in repo) is expected to terminate TLS and forward.

### 5.4 Where the Dockerfiles live

- `infra/docker/web.Dockerfile` — multi-stage: `base` → `deps` → `dev` (target for local) → `builder` → `prod` (target for dev/prod).
- `infra/docker/simulation-service.Dockerfile` — multi-stage: `base` (uv) → `deps` → `dev` (target for local, with `--reload`) → `prod`.

Both use `corepack` / `uv` lockfile-aware installs so reproducibility holds across mode boundaries.

### 5.5 Env vars

Compose reads `.env` at the repo root (created from `.env.example`). The only required variable today is `NEXT_PUBLIC_SIMULATION_SERVICE_URL`, which in Docker defaults to `http://localhost:8000` (browser-side) — Compose maps the simulation-service port to the host so the browser can hit it directly.

---

## 6. Quality gates

```bash
pnpm typecheck     # tsc (apps/web) + mypy (simulation-service)
pnpm lint          # next lint (web) + ruff (python)
pnpm test          # placeholders, no real suite yet — see Phase 0 backlog
pnpm format:check  # prettier
```

All four must pass before a PR merges. CI (GitHub Actions) is part of the Phase 0 backlog.

---

## 7. Adding a new simulation (Phase 0/1 workflow)

Manual, no agents yet:

1. Create `services/simulation-service/simulation_service/sims/<slug>.py` with a `SimulationBase` subclass — set `slug`, `name`, `drivers`, `horizon_years`, implement `simulate`.
2. Register it in `simulation_service/registry.py`.
3. Restart the service (in `local` mode, `--reload` does this automatically).
4. The frontend will pick it up at `GET /sims/<slug>` — no frontend changes needed because the UI is metadata-driven.

Determinism is non-negotiable: same inputs → identical outputs, every time. Random sources need fixed seeds.

---

## 8. What's next

Tracked in `docs/tasks/current.md`. Highlights from the Phase 0 backlog:

- GitHub Actions CI (typecheck / lint / test gates)
- Prisma schema v1 + Postgres in `docker-compose.yml`
- First real sector ("AI Memory Demand") replacing `PlaceholderSim`
- `services/api-gateway` (Fastify + tRPC) in front of the simulation-service
- `apps/admin` skeleton
- `packages/ui`, `packages/sdk-ts`, `packages/shared-types`

Out of scope until Phase 2+: agents, sandboxed code execution, LangSmith/Helicone, Monte Carlo / sensitivity endpoints.

---

## 9. References

- [DESIGN.md](./DESIGN.md) — vision, personas, business model, roadmap
- [CLAUDE.md](./CLAUDE.md) — operating context for Claude Code (and humans)
- [docs/adr/](./docs/adr/) — Architectural Decision Records
- [docs/tasks/current.md](./docs/tasks/current.md) — active task and backlog
- [packages/sdk-python/README.md](./packages/sdk-python/README.md) — SDK usage
