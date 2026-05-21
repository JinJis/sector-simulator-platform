-- Phase 2 epic, milestone 7: graph topology + audit log

-- CreateTable
CREATE TABLE "graph_nodes" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT '',
    "unit" TEXT,
    "description" TEXT,
    "position_x" DOUBLE PRECISION,
    "position_y" DOUBLE PRECISION,
    "equity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_edges" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "label" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "magnitude" TEXT NOT NULL DEFAULT 'med',
    "origin" TEXT NOT NULL DEFAULT 'seed',
    "author_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sector_slug" TEXT,
    "payload" JSONB NOT NULL,
    "author_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "graph_nodes_sector_slug_node_key_key" ON "graph_nodes"("sector_slug", "node_key");

-- CreateIndex
CREATE INDEX "graph_nodes_sector_slug_idx" ON "graph_nodes"("sector_slug");

-- CreateIndex
CREATE INDEX "graph_nodes_equity_id_idx" ON "graph_nodes"("equity_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_edges_sector_slug_source_key_target_key_key" ON "graph_edges"("sector_slug", "source_key", "target_key");

-- CreateIndex
CREATE INDEX "graph_edges_sector_slug_idx" ON "graph_edges"("sector_slug");

-- CreateIndex
CREATE INDEX "graph_edges_sector_slug_target_key_idx" ON "graph_edges"("sector_slug", "target_key");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_sector_slug_created_at_idx" ON "audit_logs"("sector_slug", "created_at");

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
