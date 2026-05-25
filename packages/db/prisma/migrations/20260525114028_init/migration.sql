-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vision_question" TEXT,
    "is_vision_eligible" BOOLEAN NOT NULL DEFAULT true,
    "source_module" TEXT,
    "status" TEXT NOT NULL DEFAULT 'live',
    "agent_workflow_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sector_equities" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "iso_country" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_name_local" TEXT,
    "sector_exposure_pct" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "currency" TEXT,
    "last_close_local" DOUBLE PRECISION,
    "last_close_usd" DOUBLE PRECISION,
    "last_close_date" TIMESTAMP(3),
    "market_cap_usd" DOUBLE PRECISION,
    "driver_links" JSONB NOT NULL DEFAULT '[]',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sector_equities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_financials" (
    "equity_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_quarter" INTEGER NOT NULL,
    "period_end" DATE NOT NULL,
    "revenue_usd" DOUBLE PRECISION,
    "cogs_usd" DOUBLE PRECISION,
    "gross_profit_usd" DOUBLE PRECISION,
    "opex_usd" DOUBLE PRECISION,
    "ebitda_usd" DOUBLE PRECISION,
    "net_income_usd" DOUBLE PRECISION,
    "capex_usd" DOUBLE PRECISION,
    "total_assets_usd" DOUBLE PRECISION,
    "total_liabilities_usd" DOUBLE PRECISION,
    "total_equity_usd" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'mock',
    "inserted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_financials_pkey" PRIMARY KEY ("equity_id","fiscal_year","fiscal_quarter")
);

-- CreateTable
CREATE TABLE "equity_quotes" (
    "equity_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "close_local" DOUBLE PRECISION NOT NULL,
    "close_usd" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'yfinance',
    "inserted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_quotes_pkey" PRIMARY KEY ("equity_id","trade_date")
);

-- CreateTable
CREATE TABLE "agent_workflows" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workflows_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT,
    "theme" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equity_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "driver_overrides" JSONB NOT NULL,
    "author_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_customers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "rationale_analysis" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "user_scores" (
    "user_id" TEXT NOT NULL,
    "total_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "predictions_made" INTEGER NOT NULL DEFAULT 0,
    "predictions_resolved" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "hit_rate_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "best_streak" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_scores_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "sector_suggestion_votes" (
    "suggestion_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_suggestion_votes_pkey" PRIMARY KEY ("suggestion_id","user_id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "description" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "primary_driver_name" TEXT,
    "signal_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_scores" (
    "id" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "technical" DOUBLE PRECISION,
    "economic" DOUBLE PRECISION,
    "regulatory" DOUBLE PRECISION,
    "supply" DOUBLE PRECISION,
    "composite" DOUBLE PRECISION,
    "composite_p10" DOUBLE PRECISION,
    "composite_p90" DOUBLE PRECISION,
    "as_of" TIMESTAMP(3) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_dependencies" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "capability_id" TEXT,
    "actor_id" TEXT,
    "source_kind" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_id_ext" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "delta_technical" DOUBLE PRECISION,
    "delta_economic" DOUBLE PRECISION,
    "delta_regulatory" DOUBLE PRECISION,
    "delta_supply" DOUBLE PRECISION,
    "is_highlight" BOOLEAN NOT NULL DEFAULT false,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "likelihood" TEXT NOT NULL,
    "time_horizon" TEXT NOT NULL,
    "mitigations" TEXT,
    "affected_capability_keys" TEXT[],
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_feasibility" (
    "id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "composite" DOUBLE PRECISION NOT NULL,
    "composite_p10" DOUBLE PRECISION,
    "composite_p90" DOUBLE PRECISION,
    "binding_capability_key" TEXT,
    "eta_median_years" DOUBLE PRECISION,
    "eta_p10_years" DOUBLE PRECISION,
    "eta_p90_years" DOUBLE PRECISION,
    "delta_90d" DOUBLE PRECISION,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_feasibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actors" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "name_local" TEXT,
    "iso_country" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ticker" TEXT,
    "exchange" TEXT,
    "blurb" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL,
    "logo_url" TEXT,
    "website" TEXT,
    "signal_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_actors" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "sector_slug" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION,
    "rationale" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_actors" (
    "id" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'competitor',
    "stage" TEXT,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_actors_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "predictions_v2" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equity_id" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "expected_price_min" DOUBLE PRECISION NOT NULL,
    "expected_price_max" DOUBLE PRECISION NOT NULL,
    "anchor_price" DOUBLE PRECISION NOT NULL,
    "anchor_date" TIMESTAMP(3) NOT NULL,
    "tier" TEXT NOT NULL,
    "tier_explanation" TEXT,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolves_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "actual_price" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "reward_points" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predictions_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_reputation" (
    "user_id" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'newcomer',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_reputation_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "point_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "refers_to_kind" TEXT,
    "refers_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_follows" (
    "follower_id" TEXT NOT NULL,
    "followed_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("follower_id","followed_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_slug_key" ON "sectors"("slug");

-- CreateIndex
CREATE INDEX "sectors_status_idx" ON "sectors"("status");

-- CreateIndex
CREATE INDEX "sectors_created_by_user_id_idx" ON "sectors"("created_by_user_id");

-- CreateIndex
CREATE INDEX "sectors_is_vision_eligible_idx" ON "sectors"("is_vision_eligible");

-- CreateIndex
CREATE INDEX "sector_equities_sector_slug_idx" ON "sector_equities"("sector_slug");

-- CreateIndex
CREATE INDEX "sector_equities_iso_country_idx" ON "sector_equities"("iso_country");

-- CreateIndex
CREATE UNIQUE INDEX "sector_equities_sector_slug_ticker_exchange_key" ON "sector_equities"("sector_slug", "ticker", "exchange");

-- CreateIndex
CREATE INDEX "equity_financials_equity_id_period_end_idx" ON "equity_financials"("equity_id", "period_end" DESC);

-- CreateIndex
CREATE INDEX "equity_quotes_equity_id_trade_date_idx" ON "equity_quotes"("equity_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "agent_workflows_kind_created_at_idx" ON "agent_workflows"("kind", "created_at");

-- CreateIndex
CREATE INDEX "agent_workflows_status_updated_at_idx" ON "agent_workflows"("status", "updated_at");

-- CreateIndex
CREATE INDEX "agent_workflows_user_id_created_at_idx" ON "agent_workflows"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "graph_nodes_sector_slug_idx" ON "graph_nodes"("sector_slug");

-- CreateIndex
CREATE INDEX "graph_nodes_equity_id_idx" ON "graph_nodes"("equity_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_nodes_sector_slug_node_key_key" ON "graph_nodes"("sector_slug", "node_key");

-- CreateIndex
CREATE INDEX "graph_edges_sector_slug_idx" ON "graph_edges"("sector_slug");

-- CreateIndex
CREATE INDEX "graph_edges_sector_slug_target_key_idx" ON "graph_edges"("sector_slug", "target_key");

-- CreateIndex
CREATE UNIQUE INDEX "graph_edges_sector_slug_source_key_target_key_key" ON "graph_edges"("sector_slug", "source_key", "target_key");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_sector_slug_created_at_idx" ON "audit_logs"("sector_slug", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "watchlist_items_user_id_created_at_idx" ON "watchlist_items"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_user_id_equity_id_key" ON "watchlist_items"("user_id", "equity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "scenarios_sector_slug_idx" ON "scenarios"("sector_slug");

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_user_id_key" ON "billing_customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_stripe_customer_id_key" ON "billing_customers"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_stripe_subscription_id_key" ON "billing_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "billing_subscriptions_customer_id_status_idx" ON "billing_subscriptions"("customer_id", "status");

-- CreateIndex
CREATE INDEX "billing_subscriptions_status_current_period_end_idx" ON "billing_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "billing_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX "billing_events_type_received_at_idx" ON "billing_events"("type", "received_at");

-- CreateIndex
CREATE INDEX "predictions_user_id_created_at_idx" ON "predictions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_equity_id_created_at_idx" ON "predictions"("equity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_resolved_target_date_idx" ON "predictions"("resolved", "target_date");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_results_prediction_id_key" ON "prediction_results"("prediction_id");

-- CreateIndex
CREATE INDEX "user_scores_total_points_idx" ON "user_scores"("total_points" DESC);

-- CreateIndex
CREATE INDEX "sector_suggestions_sector_slug_status_score_idx" ON "sector_suggestions"("sector_slug", "status", "score" DESC);

-- CreateIndex
CREATE INDEX "sector_suggestions_user_id_created_at_idx" ON "sector_suggestions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sector_suggestion_votes_user_id_created_at_idx" ON "sector_suggestion_votes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "capabilities_sector_slug_idx" ON "capabilities"("sector_slug");

-- CreateIndex
CREATE INDEX "capabilities_sector_slug_display_order_idx" ON "capabilities"("sector_slug", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "capabilities_sector_slug_key_key" ON "capabilities"("sector_slug", "key");

-- CreateIndex
CREATE INDEX "capability_scores_capability_id_as_of_idx" ON "capability_scores"("capability_id", "as_of" DESC);

-- CreateIndex
CREATE INDEX "capability_scores_capability_id_is_current_idx" ON "capability_scores"("capability_id", "is_current");

-- CreateIndex
CREATE INDEX "capability_dependencies_target_id_idx" ON "capability_dependencies"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "capability_dependencies_source_id_target_id_key" ON "capability_dependencies"("source_id", "target_id");

-- CreateIndex
CREATE INDEX "signals_sector_slug_published_at_idx" ON "signals"("sector_slug", "published_at" DESC);

-- CreateIndex
CREATE INDEX "signals_capability_id_published_at_idx" ON "signals"("capability_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "signals_actor_id_published_at_idx" ON "signals"("actor_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "signals_sector_slug_is_highlight_published_at_idx" ON "signals"("sector_slug", "is_highlight", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "signals_source_url_capability_id_key" ON "signals"("source_url", "capability_id");

-- CreateIndex
CREATE INDEX "risks_sector_slug_idx" ON "risks"("sector_slug");

-- CreateIndex
CREATE INDEX "risks_sector_slug_severity_idx" ON "risks"("sector_slug", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "risks_sector_slug_key_key" ON "risks"("sector_slug", "key");

-- CreateIndex
CREATE INDEX "vision_feasibility_sector_slug_as_of_idx" ON "vision_feasibility"("sector_slug", "as_of" DESC);

-- CreateIndex
CREATE INDEX "vision_feasibility_sector_slug_is_current_idx" ON "vision_feasibility"("sector_slug", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "actors_key_key" ON "actors"("key");

-- CreateIndex
CREATE INDEX "actors_category_idx" ON "actors"("category");

-- CreateIndex
CREATE INDEX "actors_iso_country_idx" ON "actors"("iso_country");

-- CreateIndex
CREATE INDEX "vision_actors_sector_slug_idx" ON "vision_actors"("sector_slug");

-- CreateIndex
CREATE INDEX "vision_actors_sector_slug_relevance_idx" ON "vision_actors"("sector_slug", "relevance" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vision_actors_actor_id_sector_slug_key" ON "vision_actors"("actor_id", "sector_slug");

-- CreateIndex
CREATE INDEX "capability_actors_capability_id_idx" ON "capability_actors"("capability_id");

-- CreateIndex
CREATE INDEX "capability_actors_capability_id_role_idx" ON "capability_actors"("capability_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "capability_actors_capability_id_actor_id_key" ON "capability_actors"("capability_id", "actor_id");

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

-- CreateIndex
CREATE INDEX "predictions_v2_user_id_placed_at_idx" ON "predictions_v2"("user_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_v2_status_resolves_at_idx" ON "predictions_v2"("status", "resolves_at");

-- CreateIndex
CREATE INDEX "predictions_v2_equity_id_placed_at_idx" ON "predictions_v2"("equity_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "predictions_v2_status_reward_points_idx" ON "predictions_v2"("status", "reward_points" DESC);

-- CreateIndex
CREATE INDEX "user_reputation_total_points_idx" ON "user_reputation"("total_points" DESC);

-- CreateIndex
CREATE INDEX "point_events_user_id_created_at_idx" ON "point_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "point_events_kind_created_at_idx" ON "point_events"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_follows_followed_id_created_at_idx" ON "user_follows"("followed_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_follows_follower_id_created_at_idx" ON "user_follows"("follower_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_equities" ADD CONSTRAINT "sector_equities_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_financials" ADD CONSTRAINT "equity_financials_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_quotes" ADD CONSTRAINT "equity_quotes_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_results" ADD CONSTRAINT "prediction_results_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scores" ADD CONSTRAINT "user_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_suggestions" ADD CONSTRAINT "sector_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_suggestion_votes" ADD CONSTRAINT "sector_suggestion_votes_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "sector_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_suggestion_votes" ADD CONSTRAINT "sector_suggestion_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_scores" ADD CONSTRAINT "capability_scores_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_dependencies" ADD CONSTRAINT "capability_dependencies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_dependencies" ADD CONSTRAINT "capability_dependencies_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_feasibility" ADD CONSTRAINT "vision_feasibility_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_actors" ADD CONSTRAINT "vision_actors_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_actors" ADD CONSTRAINT "vision_actors_sector_slug_fkey" FOREIGN KEY ("sector_slug") REFERENCES "sectors"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_actors" ADD CONSTRAINT "capability_actors_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_actors" ADD CONSTRAINT "capability_actors_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "predictions_v2" ADD CONSTRAINT "predictions_v2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions_v2" ADD CONSTRAINT "predictions_v2_equity_id_fkey" FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reputation" ADD CONSTRAINT "user_reputation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followed_id_fkey" FOREIGN KEY ("followed_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
