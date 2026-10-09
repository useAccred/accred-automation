CREATE TABLE IF NOT EXISTS "web_bot_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_address" text,
	"asset_symbol" text,
	"coingecko_id" text,
	"threshold_usd" double precision,
	"agent_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"fired_count" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_bots" ADD COLUMN IF NOT EXISTS "last_watch_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_bot_watches_bot_id_web_bots_id_fk') THEN ALTER TABLE "web_bot_watches" ADD CONSTRAINT "web_bot_watches_bot_id_web_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."web_bots"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_bot_watches_user_id_users_id_fk') THEN ALTER TABLE "web_bot_watches" ADD CONSTRAINT "web_bot_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_bot_watches_bot_idx" ON "web_bot_watches" USING btree ("bot_id","status");