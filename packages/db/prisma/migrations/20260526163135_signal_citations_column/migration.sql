-- Add a JSONB citations column to the signals table.
--
-- Lineage: the daily DR digest (and any other grounded-research-
-- backed fetcher) returns a list of {url, title} pairs that the
-- google_search grounding tool surfaced alongside the synthesis.
-- We were stuffing them into crawl_runs.result_summary, which is
-- fine for the admin cockpit but invisible to the user app — the
-- per-signal "where did this come from?" chips couldn't render
-- them. Storing them on the Signal row itself fixes that.
--
-- Default null (most adapter-sourced signals — arXiv / USPTO /
-- crawl4ai — leave it null since their source_url is already the
-- primary reference). JSONB so Postgres can index later if we
-- need URL-keyed queries.

ALTER TABLE "signals" ADD COLUMN "citations" JSONB;
