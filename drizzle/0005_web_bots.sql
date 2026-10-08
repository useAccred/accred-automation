CREATE TABLE "web_bot_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_bot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credits_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"shape" text DEFAULT 'round' NOT NULL,
	"preset" text,
	"model_mode" text DEFAULT 'auto' NOT NULL,
	"model_id" text,
	"max_per_message_micro" bigint DEFAULT 3000000 NOT NULL,
	"max_per_day_micro" bigint DEFAULT 50000000 NOT NULL,
	"memory" text DEFAULT '' NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"busy_since" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_bot_actions" ADD CONSTRAINT "web_bot_actions_bot_id_web_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."web_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_bot_actions" ADD CONSTRAINT "web_bot_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_bot_messages" ADD CONSTRAINT "web_bot_messages_bot_id_web_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."web_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_bot_messages" ADD CONSTRAINT "web_bot_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_bots" ADD CONSTRAINT "web_bots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_bot_actions_bot_idx" ON "web_bot_actions" USING btree ("bot_id","status");--> statement-breakpoint
CREATE INDEX "web_bot_messages_bot_idx" ON "web_bot_messages" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "web_bots_user_idx" ON "web_bots" USING btree ("user_id","last_message_at");