ALTER TABLE "executions" ADD COLUMN "quantity_raw" text;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "approve_tx_hash" text;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "quantity_raw" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "token_decimals" integer;