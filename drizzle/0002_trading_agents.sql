CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"automation_id" uuid,
	"wallet_id" uuid,
	"run_id" uuid,
	"proposal_id" uuid,
	"position_id" uuid,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"proposal_id" uuid,
	"position_id" uuid,
	"idempotency_key" text NOT NULL,
	"mode" text NOT NULL,
	"side" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"asset_address" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" double precision NOT NULL,
	"price_usd" double precision NOT NULL,
	"notional_usd" double precision NOT NULL,
	"swap_fee_usd" double precision DEFAULT 0 NOT NULL,
	"network_fee_usd" double precision DEFAULT 0 NOT NULL,
	"slippage_percent" double precision DEFAULT 0 NOT NULL,
	"realized_pnl_usd" double precision DEFAULT 0 NOT NULL,
	"quote" jsonb,
	"tx_hash" text,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"asset_address" text NOT NULL,
	"symbol" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"quantity" double precision NOT NULL,
	"initial_quantity" double precision NOT NULL,
	"entry_price_usd" double precision NOT NULL,
	"stop_loss_price" double precision NOT NULL,
	"initial_stop_loss_price" double precision NOT NULL,
	"take_profit_price" double precision,
	"highest_price_usd" double precision NOT NULL,
	"last_price_usd" double precision NOT NULL,
	"last_price_at" timestamp with time zone NOT NULL,
	"break_even_moved" boolean DEFAULT false NOT NULL,
	"partial_taken" boolean DEFAULT false NOT NULL,
	"realized_pnl_usd" double precision DEFAULT 0 NOT NULL,
	"fees_usd" double precision DEFAULT 0 NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "risk_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"approved" boolean NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"checks" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"profile" text NOT NULL,
	"mandate" jsonb NOT NULL,
	"risk_increases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"action" text NOT NULL,
	"asset_address" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"requested_usd" double precision NOT NULL,
	"stop_loss_percent" double precision,
	"take_profit_percent" double precision,
	"confidence" double precision,
	"reason" text DEFAULT '' NOT NULL,
	"model" text,
	"market" jsonb,
	"outcome" text,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"strategy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"paused_by" text,
	"pause_reason" text,
	"access_revoked_at" timestamp with time zone,
	"config_version" integer DEFAULT 1 NOT NULL,
	"mandate_version" integer DEFAULT 1 NOT NULL,
	"strategy_version" integer DEFAULT 1 NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_mode" text DEFAULT 'auto' NOT NULL,
	"model_id" text,
	"max_per_run_micro" bigint NOT NULL,
	"max_per_month_micro" bigint NOT NULL,
	"interval_minutes" integer DEFAULT 15 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"connection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"peak_equity_usd" double precision,
	"max_drawdown_percent" double precision DEFAULT 0 NOT NULL,
	"simulation_failures" integer DEFAULT 0 NOT NULL,
	"data_failures" integer DEFAULT 0 NOT NULL,
	"breaker_reset_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credits_micro" bigint DEFAULT 0 NOT NULL,
	"budget_micro" bigint DEFAULT 0 NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"proposals" integer DEFAULT 0 NOT NULL,
	"executed" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"error" text,
	"mandate_version" integer NOT NULL,
	"strategy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trading_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kinds" jsonb NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"key_enc" text NOT NULL,
	"source" text NOT NULL,
	"trading_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_proposal_id_trade_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."trade_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_mandate_id_risk_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."risk_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_proposal_id_trade_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."trade_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_mandate_id_risk_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."risk_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_proposal_id_trade_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."trade_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_mandate_id_risk_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."risk_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_mandates" ADD CONSTRAINT "risk_mandates_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_run_id_trading_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trading_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_proposals" ADD CONSTRAINT "trade_proposals_mandate_id_risk_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."risk_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_automations" ADD CONSTRAINT "trading_automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_automations" ADD CONSTRAINT "trading_automations_wallet_id_trading_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."trading_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_runs" ADD CONSTRAINT "trading_runs_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_runs" ADD CONSTRAINT "trading_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_strategies" ADD CONSTRAINT "trading_strategies_automation_id_trading_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."trading_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_wallets" ADD CONSTRAINT "trading_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_automation_idx" ON "audit_events" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "executions_automation_idx" ON "executions" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "executions_position_idx" ON "executions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "positions_automation_idx" ON "positions" USING btree ("automation_id","status");--> statement-breakpoint
CREATE INDEX "positions_open_idx" ON "positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "risk_evaluations_proposal_idx" ON "risk_evaluations" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "risk_evaluations_automation_idx" ON "risk_evaluations" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_mandates_version" ON "risk_mandates" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "trade_proposals_automation_idx" ON "trade_proposals" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_proposals_state_idx" ON "trade_proposals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "trading_automations_user_idx" ON "trading_automations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_automations_due_idx" ON "trading_automations" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "trading_runs_automation_idx" ON "trading_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_strategies_version" ON "trading_strategies" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "trading_wallets_user_idx" ON "trading_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_wallets_user_address" ON "trading_wallets" USING btree ("user_id","address");