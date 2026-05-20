-- CreateTable
CREATE TABLE "agent_workflows" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_workflows_kind_created_at_idx" ON "agent_workflows"("kind", "created_at");

-- CreateIndex
CREATE INDEX "agent_workflows_status_updated_at_idx" ON "agent_workflows"("status", "updated_at");
