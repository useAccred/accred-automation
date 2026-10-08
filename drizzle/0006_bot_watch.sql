ALTER TABLE "bot_chats" ADD COLUMN "wallet_balances" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD COLUMN "last_weekly_on" text;