# Current task — M55: Admin reset (SQLAdmin)

**Last updated**: 2026-05-27. Phase 4 (M48–M54) is shipped and in
steady state. M55 reset the admin surface: the `apps/admin/` Next.js
console — login, ~14 hand-rolled pages, tRPC client wrappers, repeated
drift between trigger UIs and the actual fetcher contracts — was
deleted and replaced with **SQLAdmin** mounted on the data-pipeline
FastAPI at `data-pipeline:8003/admin`.

What survived M55: the data pipeline itself (data-pipeline +
agent-orchestration), the Prisma schema, the scoring engine, the
public user app at `apps/web /visions`, and the four seeded visions.
Everything in [composition.md](../architecture/composition.md) is
still ground-truth — only the operator-facing surface changed.

Historical M48–M54 detail (milestone sequence, per-fetcher specs,
Product Polish MP1-MP7, the three architectural refactors that landed
in late May 2026) lives in git log + [docs/archive/](../archive/).

---

## Pipeline shape (current, unchanged from late-Phase-4)

```
APScheduler crons (one process, single AsyncIOScheduler):

  refresh_quotes_daily             08:30 UTC  →  yfinance quotes
  resolve_predictions_v2_hourly    :05 * * *  →  PredictionV2 resolver
  news_ingest_5min                 every 5m   →  crawl4ai Yahoo+Naver+Finviz
  research_ingest_hourly           :07 * * *  →  arXiv + USPTO
  recompute_feasibility_hourly     :25 * * *  →  ScoreUpdater per cap
  orchestrator_tick_15min          every 15m  →  M49f picker (gated off)
  digest_daily                     06:00 UTC  →  grounded gemini per vision (gated off)

Manual triggers (now via SQLAdmin row actions, not REST/tRPC):

  Vision row    →  Trigger: hello-world / Trigger: DR digest
  Capability    →  Trigger: capability DR fetch / signal ingest (scoped)
  Risk          →  Trigger: risk DR fetch
  Vision↔Actor  →  Trigger: actor DR fetch
  /admin/queue  →  Pause / resume / run-now any APScheduler job
```

Cron / queue control: SQLAdmin **Queue + Crons** page renders ARQ
depth + workers + in-flight, plus every APScheduler job with
pause/resume/run-now buttons. Permanent off is still the env gate
(`*_SCHEDULE=off`) — pause is in-memory only.

---

## M55 — Admin reset (SQLAdmin)

**Goal**: one admin surface, no hand-rolled React, every row mutation
traceable in `audit_logs`. Shipped as 6 commits on 2026-05-27.

| Step | Commit | What landed |
|---|---|---|
| 1 | `0e2e41c` | SQLAdmin mount at `/admin` + 14 read-only ModelViews + single-account env-driven auth (reuses `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`) |
| 2 | `a0c02ab` | 8 row actions: trigger hello-world / digest / capability / signal-ingest / risk / actor; approve & reject on `community_proposals` (mirrors `bulkDecide` tRPC; writes audit row) |
| 3 | `2aa1fe6` | Custom **Queue + Crons** page (`BaseView` + Jinja) — ARQ tiles + APScheduler list with pause/resume/run-now via POST forms |
| 4 | `47f888f` | Custom **Vision Builder** wizard (`BaseView` + 2 Jinja pages) — prompt → review → commit; forwards to sector-service `visionBuilder.propose` + `commit` tRPC so the heavy Prisma transaction stays in one place |
| 5 | `55d010b` | Deleted `apps/admin/` (61 files / ~6.5k lines), `services/sector-service/src/trpc/crawler.ts` (sole consumer was apps/admin), `infra/docker/admin.Dockerfile`, compose admin block + 5 admin volumes; port 3100 freed |
| 6 | (this) | Docs cleanup: CLAUDE.md / README.md / this file |

Along the way, three small infra fixes:

- `d317b19` — local-override compose: pin `data-pipeline-worker` to
  `target: dev` so both rebuilds land on the same dev image; otherwise
  the worker rebuilds prod last, overwrites the dev image, and the HTTP
  container's bind mount fails with `ModuleNotFoundError: data_pipeline`.
- `382bad3` — uvicorn `--proxy-headers --forwarded-allow-ips=*` so
  SQLAdmin renders correct `https://` static URLs when `X-Forwarded-Proto`
  is present.
- `7eebfef` + `34cc7c9` — `ADMIN_FORCE_URL_SCHEME=https` env var +
  ASGI middleware for proxies that DON'T set `X-Forwarded-Proto` (e.g.,
  Google Cloud Workstation's `*.proxy.googlers.com`). Documented in
  `.env.example`.

What's at `/admin` after M55:

```
Vision
  ├─ Visions                   (Sector — full editable list)
  ├─ Vision Builder            ← new wizard
  ├─ Capabilities              (with trigger actions)
  ├─ Capability scores         (read-only)
  ├─ Signals                   (read-only)
  ├─ Risks                     (with trigger actions)
  ├─ Actors                    (full editable list)
  ├─ Vision↔Actors             (with trigger actions)
  ├─ Capability↔Actors
  ├─ Economics datapoints      (read-only)
  └─ Feasibility snapshots     (read-only)

Operations
  ├─ Crawl runs                (read-only)
  ├─ Community proposals       (with approve/reject actions)
  ├─ Users                     (read-only)
  ├─ Audit log                 (read-only)
  └─ Queue + Crons             ← new live page
```

---

## Open questions

Park here; raise as ADR if they block a change.

1. **Bot voting** — Phase 4 said no. Could change if high-confidence
   `@feasibility_bot` suggestions deserve a baseline +1 nudge.
2. **Deep Research cost ceiling per vision** — $2/day default. Needs
   recalibration after some weeks of grounded-gemini usage.
3. **EntityDetector false positives on common names** — fuzzy-match
   alone is insufficient ("Apple Inc." vs the fruit). Plan: pair
   Jaro-Winkler with an LLM classification gate (`is_org=true` +
   `domain_relevant_to_vision=true`).
4. **SQLAdmin draft edits in Vision Builder** — M55 wizard intentionally
   dropped per-field edit. Operators who need tweaks re-prompt with the
   specific change. If that becomes painful we add HTMX inline edit on
   the review page.

---

## Deferred (still parked from Phase 3)

- M29 — OAuth providers (Google / GitHub)
- M30 — Multi-tenant scoping (`tenant_id` + Postgres RLS)
- M31 — Backtest harness (reframed as vision-feasibility backtest)
- M28b — Modal/E2B sandbox for agent-generated code
- M47 — Discussions + reputation polish (gated on real M46 production
  data; revisit after Phase 4 visions are live for 4 weeks)
- Observability — LangSmith / Helicone integration

---

## Per-change workflow

1. Read [composition.md](../architecture/composition.md) §-section
   matching the area (fetcher / bot / UX / cockpit / viz).
2. One PR per slice; each PR independently mergeable. Slice should
   trace to a one-line problem statement.
3. Mark progress here (not in README / DESIGN / CLAUDE — those link).
