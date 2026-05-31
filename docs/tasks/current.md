# Current tasks — M55 (admin reset) + M56 (ingest pipeline verify) + M57 (dynamic lookback & JobConfig tuning)

**Last updated**: 2026-05-31. Phase 4 (M48–M54) is shipped and in steady state.
- **M55** reset the admin surface, deleting the tangled Next.js `apps/admin/` console and replacing it with **SQLAdmin** mounted on `data-pipeline:8003/admin`.
- **M56** verified the ingest pipeline against live arXiv + Google News RSS feeds, fixing six critical asyncpg timezone and HTTP redirection bugs.
- **M57** shipped dynamic lookback recompute windows (`RECOMPUTE_WINDOW_DAYS=7` and signal query limit `RECOMPUTE_LIMIT=100`) by seeding parameter keys into the database as `JobConfig` rows and surfacing a custom, real-time **Job Configs** tuning dashboard directly within SQLAdmin.

Everything in [composition.md](../architecture/composition.md) and the new [system-design.md](../architecture/system-design.md) remains ground-truth.

Historical details (milestones, fetcher specs, product polish, refactoring baselines) live in the git log and under [docs/archive/](../archive/).

---

## Pipeline shape (current, unchanged from late-Phase-4)

```
APScheduler crons (one process, single AsyncIOScheduler):

  refresh_quotes_daily             08:30 UTC  →  yfinance quotes
  resolve_predictions_v2_hourly    :05 * * *  →  PredictionV2 resolver
  news_ingest_5min                 every 5m   →  Google News RSS (default; NEWS_INGEST_USE_CRAWL4AI=1 → Yahoo+Naver+Finviz)
  research_ingest_hourly           :07 * * *  →  arXiv (USPTO behind ENABLE_USPTO=1)
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

## M56 — Ingest pipeline verify (2026-05-28)

**Goal**: stand up the data-pipeline stack against live data sources
and confirm signals actually land in Postgres. Operator reported "내가
보니까 cron이 매분 돌고 있는데 데이터가 적재되지 않는거 같아." A 1-hour
trace surfaced six independent bugs that each silently broke an
ingest path. After M56, `research_ingest_hourly` writes a real arxiv
paper into `signals` on every tick (verified by query — 91 → 92 rows
with title "TCBiRRT: Rapid Motion Planning for Tightly Coupled Dual-
arm Space Manipulator...").

| Bug | Root cause | Fix |
|---|---|---|
| **M56-1** orchestrator tick raised `TypeError` every minute | `pick_for_tick` passed aware `since` to asyncpg, but `crawl_runs.ended_at` is Prisma-default `timestamp` (no tz) | Strip tz at the call site — `(now - timedelta(hours=24)).replace(tzinfo=None)` |
| **M56-2** arxiv returned 0 signals every fetch | arxiv moved to https-only; old http URL returned 301; httpx doesn't follow by default | Pin `https://export.arxiv.org/api/query` |
| **M56-3** `/signal-extractor/score` returned 422 (digest + 3 fetchers) | DR digest output ~10KB busted `SignalExtractorRequest.signal_summary` max_length=4000 | Added `_clip_for_extractor` inside `HttpAgentClient.score_signal` — clips signal_title 500, signal_summary 4000, capability_description 2000, capability_rationale 2000 |
| **M56-4** USPTO API not usable from operator's network | n/a — env policy | Default `research_ingest_hourly` sources to `[ArxivSource()]`; gate USPTO behind `ENABLE_USPTO=1` env |
| **M56-5** Yahoo / Finviz / Naver all returned `list-page empty` | Yahoo redesigned the news-list DOM mid-2026; the CSS selector matched zero rows | Switch from `JsonCssExtractionStrategy` to per-source markdown-regex extraction; tests rewritten to render `[title](href)` markdown |
| **M56-6** `upsert_signal` raised `DataError` after M56-1+M56-2 unblocked the path | `signals.published_at` is naive `timestamp`; adapters return aware `datetime` | Strip tz in `PostgresSignalRepository.upsert_signal` (same family as M56-1) |

**Bonus diagnosis — env typo trap**: the operator's `.env` contained
six leading-`i` typos (`iNEWS_INGEST_INTERVAL_MIN`, `iDIGEST_CRON`,
etc.) that silently no-op'd. Documented in [.env.example](../../.env.example);
worth adding a startup sanity check in a follow-up. For now: if
something cron-shaped isn't behaving, double-check that the env var
spelling matches the documentation exactly (case-sensitive, no leading
prefix).

**What needs Vertex SA on the operator's machine** (already configured
on theirs, not on the verification sandbox): SignalExtractor scoring
fills the per-dim deltas, ScoreUpdater writes `capability_scores`,
DR digest writes its own signals + crawl_runs. Without the SA every
LLM-dependent path 503s gracefully and raw signals still land
(verified — extractor unreachable in sandbox, signal still written
with null deltas).

---

## Post-M56 follow-ups (2026-05-28)

### Admin / DX
| Tag | What |
|---|---|
| **Q1** | ModelView lists show FK row's `__str__` next to the opaque id (CapabilityScore + Signal + VisionActor + CapabilityActor all gained joined-name columns) |
| **Q2** | Vision Dashboard removed — overlapped with the per-model views; one less surface to maintain |
| **Q3** | `SEED_DATA` env toggle on db-migrate + graph-bootstrap so the operator can boot an empty DB and test ingest from scratch |

### Schema / infra
| Tag | What |
|---|---|
| **P2** | Every Prisma `DateTime` migrated to `@db.Timestamptz(3)`. One ALTER migration (133 lines, 30 tables) drops the M56-1 / M56-6 family of asyncpg tz bugs at the root. Surface-level `replace(tzinfo=None)` workarounds removed from orchestrator + signal_repo. asyncpg now returns aware datetimes everywhere. |
| **P3** | agent-orchestration boots without LLM auth — lifespan catches `LLMClient()` RuntimeError, stores `app.state.llm=None`, and a new `_require_llm(app)` helper returns 503 from the 15 LLM-using endpoints. Non-LLM paths (health, workflow list) stay live. Dev sandbox + CI without Vertex SA now usable. |

### Ingest quality
| Tag | What |
|---|---|
| **P4** | Keyword files for fusion-power / memory-semi / sofc (were missing — those visions ingested zero signals). Existing space-data-center keywords broadened (drop "semiconductor" suffix, add "rad-tolerant" / "free-space optical" / etc.). |
| **F1** | arxiv lookback default 3d → 7d, env-overridable. Low-publication-rate fields (fusion, sofc) now have a fighting chance at non-zero hits. |
| **F2** | crawl4ai playwright cleanup error no longer aborts news_ingest_5min. Two-layer fix: per-source try/except in signal_ingest + manual `_safe_close` in crawl4ai_news. |
| **F3** | **Google News RSS source** (keyword-driven, no API key, no Playwright) replaces Yahoo/Finviz/Naver as the default for news_ingest_5min. One verified tick wrote 13 capability-relevant signals across 3 visions vs 0 from the ticker crawlers. `NEWS_INGEST_USE_CRAWL4AI=1` falls back to the old path. |

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
