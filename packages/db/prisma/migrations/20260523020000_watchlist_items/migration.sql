-- M24a: per-user watchlist of equities. One row per (user, equity) pair.

CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "equity_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "watchlist_items_user_id_equity_id_key"
    ON "watchlist_items"("user_id", "equity_id");

CREATE INDEX "watchlist_items_user_id_created_at_idx"
    ON "watchlist_items"("user_id", "created_at" DESC);

ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_equity_id_fkey"
    FOREIGN KEY ("equity_id") REFERENCES "sector_equities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
