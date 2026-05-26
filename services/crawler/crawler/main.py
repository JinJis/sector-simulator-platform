"""crawler FastAPI app — backward-compat shim.

The crawler service was merged into data-pipeline in commit 3/6 of the
two-service merger (see plan
`/home/ext_chungjin_google_com/.claude/plans/fyi-frontend-apps-web-shimmering-crane.md`).
All endpoints, scheduler jobs, and per-fetcher state now live in
`data_pipeline.main`; this module just re-exports `app` so docker-
compose's existing `crawler:` service block (which runs
`uvicorn crawler.main:app`) keeps working until commit 6 deletes the
container.

The same `app` object is bound here as in data-pipeline — running both
containers from one repo deploys the same surface twice. Production
should pick one (data-pipeline) and disable the other; the orchestrator
+ schedulers are independently env-gated so dual-arming won't double-
fire scheduled crons unless explicitly enabled in both.
"""

from data_pipeline.main import app, create_app

__all__ = ["app", "create_app"]
