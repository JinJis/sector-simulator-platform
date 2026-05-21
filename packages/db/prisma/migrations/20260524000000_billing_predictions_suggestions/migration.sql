-- M26 + M27 + M32:
--   billing_customers / billing_subscriptions / billing_events
--   agent_workflows.user_id
--   predictions / prediction_results / user_scores
--   sector_suggestions / sector_suggestion_votes

-- ---------------------------------------------------------------------------
-- M26 — Stripe billing
-- ---------------------------------------------------------------------------

CREATE TABLE "billing_customers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_customers_user_id_key" ON "billing_customers"("user_id");
CREATE UNIQUE INDEX "billing_customers_stripe_customer_id_key" ON "billing_customers"("stripe_customer_id");

ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_subscriptions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "stripe_price_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_subscriptions_stripe_subscription_id_key" ON "billing_subscriptions"("stripe_subscription_id");
CREATE INDEX "billing_subscriptions_customer_id_status_idx" ON "billing_subscriptions"("customer_id", "status");
CREATE INDEX "billing_subscriptions_status_current_period_end_idx" ON "billing_subscriptions"("status", "current_period_end");

ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "billing_customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "billing_events"("stripe_event_id");
CREATE INDEX "billing_events_type_received_at_idx" ON "billing_events"("type", "received_at");

-- ---------------------------------------------------------------------------
-- M27 — agent_workflows ownership
-- ---------------------------------------------------------------------------
-- Existing rows get NULL (legacy admin-driven runs). New rows are populated
-- by the orchestration service.

ALTER TABLE "agent_workflows" ADD COLUMN "user_id" TEXT;

CREATE INDEX "agent_workflows_user_id_created_at_idx" ON "agent_workflows"("user_id", "created_at" DESC);

ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- M32 — Community: predictions + suggestions
-- ---------------------------------------------------------------------------

CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equity_id" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "predicted_pct" DOUBLE PRECISION NOT NULL,
    "anchor_close" DOUBLE PRECISION NOT NULL,
    "predicted_close" DOUBLE PRECISION NOT NULL,
    "anchor_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_date" TIMESTAMP(3) NOT NULL,
    "scenario_id" TEXT,
    "rationale" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "predictions_user_id_created_at_idx" ON "predictions"("user_id", "created_at" DESC);
CREATE INDEX "predictions_equity_id_created_at_idx" ON "predictions"("equity_id", "created_at" DESC);
CREATE INDEX "predictions_resolved_target_date_idx" ON "predictions"("resolved", "target_date");

ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "predictions" ADD CONSTRAINT "predictions_equity_id_fkey"
    FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "prediction_results" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "actual_close" DOUBLE PRECISION NOT NULL,
    "actual_pct" DOUBLE PRECISION NOT NULL,
    "abs_error" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prediction_results_prediction_id_key" ON "prediction_results"("prediction_id");

ALTER TABLE "prediction_results" ADD CONSTRAINT "prediction_results_prediction_id_fkey"
    FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_scores" (
    "user_id" TEXT NOT NULL,
    "total_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "predictions_made" INTEGER NOT NULL DEFAULT 0,
    "predictions_resolved" INTEGER NOT NULL DEFAULT 0,
    "hit_rate_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "best_streak" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_scores_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX "user_scores_total_points_idx" ON "user_scores"("total_points" DESC);

ALTER TABLE "user_scores" ADD CONSTRAINT "user_scores_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sector_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sector_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sector_suggestions_sector_slug_status_score_idx" ON "sector_suggestions"("sector_slug", "status", "score" DESC);
CREATE INDEX "sector_suggestions_user_id_created_at_idx" ON "sector_suggestions"("user_id", "created_at" DESC);

ALTER TABLE "sector_suggestions" ADD CONSTRAINT "sector_suggestions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sector_suggestion_votes" (
    "suggestion_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_suggestion_votes_pkey" PRIMARY KEY ("suggestion_id", "user_id")
);

CREATE INDEX "sector_suggestion_votes_user_id_created_at_idx" ON "sector_suggestion_votes"("user_id", "created_at" DESC);

ALTER TABLE "sector_suggestion_votes" ADD CONSTRAINT "sector_suggestion_votes_suggestion_id_fkey"
    FOREIGN KEY ("suggestion_id") REFERENCES "sector_suggestions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sector_suggestion_votes" ADD CONSTRAINT "sector_suggestion_votes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
