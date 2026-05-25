"""Phase 4 crawler service.

Houses per-surface fetchers (capability / actor / signal / risk /
economics) + the Gemini Deep Research Agent. Writes `CrawlRun` rows
that the admin cockpit (`/admin/crawler`) reads to render live-jobs,
per-source health, and the bot proposal queue.

M48c ships only the smoke `HelloWorldFetcher` + the `CrawlRun`
repository + FastAPI surface. The 5 production fetchers land in M49.
"""
