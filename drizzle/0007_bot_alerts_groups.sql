CREATE TABLE IF NOT EXISTS "bot_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_address" text,
	"asset_symbol" text,
	"threshold_usd" double precision,
	"agent_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"fired_count" integer DEFAULT 0 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "chat_kind" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "owner_telegram_id" text;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "brief_sections" jsonb DEFAULT '["balance","spend","agents","automations"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "last_watch_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_watches_chat_id_bot_chats_chat_id_fk') THEN ALTER TABLE "bot_watches" ADD CONSTRAINT "bot_watches_chat_id_bot_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."bot_chats"("chat_id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_watches_user_id_users_id_fk') THEN ALTER TABLE "bot_watches" ADD CONSTRAINT "bot_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_watches_chat_idx" ON "bot_watches" USING btree ("chat_id","status");