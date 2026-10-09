CREATE TABLE "bot_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tool" text,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"state" text DEFAULT 'awaiting_key' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"brief_hour" integer,
	"last_brief_on" text,
	"low_balance_micro" bigint DEFAULT 200000000 NOT NULL,
	"low_balance_alerted_at" timestamp with time zone,
	"max_per_message_micro" bigint DEFAULT 3000000 NOT NULL,
	"max_per_day_micro" bigint DEFAULT 50000000 NOT NULL,
	"model_mode" text DEFAULT 'auto' NOT NULL,
	"model_id" text,
	"memory" text DEFAULT '' NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"model" text,
	"credits_micro" bigint DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_actions" ADD CONSTRAINT "bot_actions_chat_id_bot_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."bot_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_actions" ADD CONSTRAINT "bot_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_chats" ADD CONSTRAINT "bot_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_turns" ADD CONSTRAINT "bot_turns_chat_id_bot_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."bot_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_turns" ADD CONSTRAINT "bot_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_actions_chat_idx" ON "bot_actions" USING btree ("chat_id","status");--> statement-breakpoint
CREATE INDEX "bot_chats_user_idx" ON "bot_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bot_turns_chat_idx" ON "bot_turns" USING btree ("chat_id","created_at");