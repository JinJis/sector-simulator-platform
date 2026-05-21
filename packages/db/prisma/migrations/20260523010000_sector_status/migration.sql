-- M21: sector lifecycle status + traceability back to the agent
-- workflow that proposed it. Existing rows seeded as `live` since the
-- 3 in-code sims are production-grade today.

ALTER TABLE "sectors" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'live';
ALTER TABLE "sectors" ADD COLUMN "agent_workflow_id" TEXT;

CREATE INDEX "sectors_status_idx" ON "sectors"("status");
