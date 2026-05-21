-- M33: store LLM-generated rationale analysis on predictions.

ALTER TABLE "predictions" ADD COLUMN "rationale_analysis" JSONB;
