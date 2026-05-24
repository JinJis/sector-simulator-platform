-- DropForeignKey
ALTER TABLE "agent_workflows" DROP CONSTRAINT "agent_workflows_user_id_fkey";

-- AlterTable
ALTER TABLE "risks" ALTER COLUMN "affected_capability_keys" DROP DEFAULT;

-- CreateTable
CREATE TABLE "community_proposals" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_ref" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "proposed_payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "vote_score" INTEGER NOT NULL DEFAULT 0,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_evidence" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fetched_meta" JSONB,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_votes" (
    "proposal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_votes_pkey" PRIMARY KEY ("proposal_id","user_id")
);

-- CreateTable
CREATE TABLE "proposal_replies" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "parent_reply_id" TEXT,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_proposals_sector_slug_status_vote_score_idx" ON "community_proposals"("sector_slug", "status", "vote_score" DESC);

-- CreateIndex
CREATE INDEX "community_proposals_sector_slug_created_at_idx" ON "community_proposals"("sector_slug", "created_at" DESC);

-- CreateIndex
CREATE INDEX "community_proposals_status_vote_score_idx" ON "community_proposals"("status", "vote_score" DESC);

-- CreateIndex
CREATE INDEX "community_proposals_author_id_created_at_idx" ON "community_proposals"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "community_proposals_status_created_at_idx" ON "community_proposals"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "proposal_evidence_proposal_id_order_index_idx" ON "proposal_evidence"("proposal_id", "order_index");

-- CreateIndex
CREATE INDEX "proposal_votes_user_id_created_at_idx" ON "proposal_votes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "proposal_replies_proposal_id_created_at_idx" ON "proposal_replies"("proposal_id", "created_at");

-- CreateIndex
CREATE INDEX "proposal_replies_parent_reply_id_idx" ON "proposal_replies"("parent_reply_id");

-- AddForeignKey
ALTER TABLE "community_proposals" ADD CONSTRAINT "community_proposals_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_proposals" ADD CONSTRAINT "community_proposals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "community_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_votes" ADD CONSTRAINT "proposal_votes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "community_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_votes" ADD CONSTRAINT "proposal_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_replies" ADD CONSTRAINT "proposal_replies_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "community_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_replies" ADD CONSTRAINT "proposal_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_replies" ADD CONSTRAINT "proposal_replies_parent_reply_id_fkey" FOREIGN KEY ("parent_reply_id") REFERENCES "proposal_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
