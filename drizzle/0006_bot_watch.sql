ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "wallet_balances" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN IF NOT EXISTS "last_weekly_on" text;