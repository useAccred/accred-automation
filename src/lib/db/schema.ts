import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Mandate } from "../trading/mandate";
import type { TradeState } from "../trading/states";
import type { RiskCheck } from "../trading/risk-engine";
import type { StrategyKind } from "../trading/strategy";
import type { Permission } from "../trading/permissions";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
// Credit amounts are stored as integer microcredits (1 credit = 1,000,000), matching the Accred ledger.
const micro = (name: string) => bigint(name, { mode: "bigint" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256 of the Accred API key; signing in looks the account up by it. */
  keyHash: text("key_hash").notNull().unique(),
  keyEnc: text("key_enc").notNull(),
  keyHint: text("key_hint").notNull(),
  /** Most recent balance known from Accred, for display only. */
  balanceExact: text("balance_exact"),
  balanceAt: timestamp("balance_at", { withTimezone: true }),
  /** "live" when read from the balance endpoint, "reported" when taken from a model call's response. */
  balanceSource: text("balance_source").$type<"live" | "reported">(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** Every field, secret or not, encrypted as one JSON blob. */
    configEnc: text("config_enc").notNull(),
    /** Non-secret fields repeated in the clear so the UI can show them. */
    display: jsonb("display").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index("connections_user_idx").on(table.userId)],
);

/** One-time codes that tie a Telegram chat to a user when they press Start in the shared bot. */
export const telegramLinks = pgTable("telegram_links", {
  code: text("code").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Set when the code is for the user's own bot: that bot's token, encrypted. Null for the shared bot. */
  botTokenEnc: text("bot_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instruction: text("instruction").notNull(),
    triggerType: text("trigger_type").$type<"manual" | "schedule" | "webhook">().notNull(),
    cron: text("cron"),
    timezone: text("timezone").notNull().default("UTC"),
    /** Capability token in the webhook URL. */
    webhookToken: text("webhook_token").notNull().unique(),
    connectionIds: jsonb("connection_ids").$type<string[]>().notNull().default([]),
    modelMode: text("model_mode").$type<"auto" | "economy" | "quality" | "pinned">().notNull().default("auto"),
    /** In "pinned" mode: the brain model, and optionally a separate model for condensing long output. */
    modelId: text("model_id"),
    readerModelId: text("reader_model_id"),
    maxPerRunMicro: micro("max_per_run_micro").notNull(),
    maxPerMonthMicro: micro("max_per_month_micro").notNull(),
    requireApproval: boolean("require_approval").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    /** Notes the agent keeps between runs. */
    memory: text("memory").notNull().default(""),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("automations_user_idx").on(table.userId), index("automations_due_idx").on(table.nextRunAt)],
);

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "stopped_budget"
  | "cancelled";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    trigger: text("trigger").$type<"manual" | "schedule" | "webhook">().notNull(),
    payload: text("payload"),
    creditsMicro: micro("credits_micro").notNull().default(sql`0`),
    /** The cap this run was started with: the lower of the per-run cap and what was left this month. */
    budgetMicro: micro("budget_micro").notNull(),
    plannerModel: text("planner_model"),
    readerModel: text("reader_model"),
    result: text("result"),
    error: text("error"),
    /** Agent transcript, kept so a run can resume after an approval. */
    state: jsonb("state"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runs_automation_idx").on(table.automationId, table.createdAt),
    index("runs_user_idx").on(table.userId, table.createdAt),
    index("runs_status_idx").on(table.status),
  ],
);

export type StepKind = "decision" | "tool" | "condense" | "approval" | "note";
export type StepStatus = "ok" | "error" | "waiting" | "approved" | "rejected";

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    kind: text("kind").$type<StepKind>().notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    model: text("model"),
    tool: text("tool"),
    args: jsonb("args").$type<Record<string, unknown>>(),
    creditsMicro: micro("credits_micro").notNull().default(sql`0`),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").$type<StepStatus>().notNull().default("ok"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (table) => [index("run_steps_run_idx").on(table.runId, table.idx)],
);

// ── Trading agents ──────────────────────────────────────────────────────────
// Dollar amounts and token quantities are double precision: paper accounting, rounded when shown.

const at = (name: string) => timestamp(name, { withTimezone: true });
const usd = (name: string) => doublePrecision(name);

/**
 * A dedicated trading wallet on Robinhood Chain. The key is encrypted with the
 * wallet key (see crypto.ts), separate from the key that protects API keys, and
 * is only ever read by the wallet service for a withdrawal the user asked for.
 */
export const tradingWallets = pgTable(
  "trading_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lowercase 0x address. */
    address: text("address").notNull(),
    keyEnc: text("key_enc").notNull(),
    source: text("source").$type<"created" | "imported">().notNull(),
    /** Set when the user revokes trading authority: no agent may use this wallet until it is restored. */
    tradingRevokedAt: at("trading_revoked_at"),
    createdAt: createdAt(),
  },
  (table) => [index("trading_wallets_user_idx").on(table.userId), uniqueIndex("trading_wallets_user_address").on(table.userId, table.address)],
);

export type TradingStatus = "running" | "paused" | "stopped";

export const tradingAutomations = pgTable(
  "trading_automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // No cascade: a wallet in use cannot be removed. Checked at the end of the statement, so deleting the account still works.
    walletId: uuid("wallet_id").notNull().references(() => tradingWallets.id),
    name: text("name").notNull(),
    mode: text("mode").$type<"paper" | "live">().notNull().default("paper"),
    /** "paused" stops new positions while protective monitoring continues. "stopped" has never been approved, or access was revoked. */
    status: text("status").$type<TradingStatus>().notNull().default("stopped"),
    pausedBy: text("paused_by").$type<"user" | "breaker">(),
    pauseReason: text("pause_reason"),
    accessRevokedAt: at("access_revoked_at"),
    /** Bumped on every configuration change, so the audit log can name the exact configuration. */
    configVersion: integer("config_version").notNull().default(1),
    mandateVersion: integer("mandate_version").notNull().default(1),
    strategyVersion: integer("strategy_version").notNull().default(1),
    permissions: jsonb("permissions").$type<Permission[]>().notNull().default([]),
    modelMode: text("model_mode").$type<"auto" | "economy" | "quality" | "pinned">().notNull().default("auto"),
    modelId: text("model_id"),
    maxPerRunMicro: micro("max_per_run_micro").notNull(),
    maxPerMonthMicro: micro("max_per_month_micro").notNull(),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    timezone: text("timezone").notNull().default("UTC"),
    connectionIds: jsonb("connection_ids").$type<string[]>().notNull().default([]),
    /** Highest equity seen, for drawdown. Maintained by the position monitor, not the model. */
    peakEquityUsd: usd("peak_equity_usd"),
    maxDrawdownPercent: usd("max_drawdown_percent").notNull().default(0),
    /** Health counters behind the circuit breakers. */
    simulationFailures: integer("simulation_failures").notNull().default(0),
    dataFailures: integer("data_failures").notNull().default(0),
    /** Set when the user resumes after a breaker: earlier losses stop counting toward the loss streak. */
    breakerResetAt: at("breaker_reset_at"),
    approvedAt: at("approved_at"),
    nextRunAt: at("next_run_at"),
    lastRunAt: at("last_run_at"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [index("trading_automations_user_idx").on(table.userId), index("trading_automations_due_idx").on(table.nextRunAt)],
);

/** Every version of an agent's mandate. Rows are never changed; an edit adds a version. */
export const riskMandates = pgTable(
  "risk_mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    profile: text("profile").$type<"conservative" | "balanced" | "aggressive" | "custom">().notNull(),
    mandate: jsonb("mandate").$type<Mandate>().notNull(),
    /** Fields this version loosened compared with the one before, which the user confirmed. */
    riskIncreases: jsonb("risk_increases").$type<string[]>().notNull().default([]),
    approvedAt: at("approved_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("risk_mandates_version").on(table.automationId, table.version)],
);

export const tradingStrategies = pgTable(
  "trading_strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kinds: jsonb("kinds").$type<StrategyKind[]>().notNull(),
    instructions: text("instructions").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("trading_strategies_version").on(table.automationId, table.version)],
);

export type TradingRunStatus = "running" | "completed" | "skipped" | "failed";

/** One cycle of the agent: scan, filter, ask the model, check, execute. */
export const tradingRuns = pgTable(
  "trading_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<TradingRunStatus>().notNull().default("running"),
    trigger: text("trigger").$type<"schedule" | "manual">().notNull(),
    mode: text("mode").$type<"paper" | "live">().notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    creditsMicro: micro("credits_micro").notNull().default(sql`0`),
    budgetMicro: micro("budget_micro").notNull().default(sql`0`),
    scanned: integer("scanned").notNull().default(0),
    candidates: integer("candidates").notNull().default(0),
    proposals: integer("proposals").notNull().default(0),
    executed: integer("executed").notNull().default(0),
    summary: text("summary"),
    error: text("error"),
    mandateVersion: integer("mandate_version").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    createdAt: createdAt(),
    finishedAt: at("finished_at"),
  },
  (table) => [index("trading_runs_automation_idx").on(table.automationId, table.createdAt)],
);

export const tradeProposals = pgTable(
  "trade_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => tradingRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    state: text("state").$type<TradeState>().notNull(),
    action: text("action").$type<"BUY">().notNull(),
    /** Empty when the model named an asset that is not on the allowlist. */
    assetAddress: text("asset_address").notNull(),
    assetSymbol: text("asset_symbol").notNull(),
    requestedUsd: usd("requested_usd").notNull(),
    stopLossPercent: usd("stop_loss_percent"),
    takeProfitPercent: usd("take_profit_percent"),
    confidence: usd("confidence"),
    reason: text("reason").notNull().default(""),
    model: text("model"),
    /** The market data the decision was made on. */
    market: jsonb("market").$type<Record<string, unknown>>(),
    /** Why it stopped, in words, when it did not become a position. */
    outcome: text("outcome"),
    mandateId: uuid("mandate_id").notNull().references(() => riskMandates.id),
    mandateVersion: integer("mandate_version").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [index("trade_proposals_automation_idx").on(table.automationId, table.createdAt), index("trade_proposals_state_idx").on(table.state)],
);

export const riskEvaluations = pgTable(
  "risk_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").notNull().references(() => tradeProposals.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    /** "pre_trade" runs before a quote exists; "final" runs with a fresh quote, immediately before execution. */
    stage: text("stage").$type<"pre_trade" | "final">().notNull(),
    approved: boolean("approved").notNull(),
    passed: integer("passed").notNull(),
    total: integer("total").notNull(),
    checks: jsonb("checks").$type<RiskCheck[]>().notNull(),
    /** Everything the engine was given, so a decision can be replayed. */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    mandateId: uuid("mandate_id").notNull().references(() => riskMandates.id),
    mandateVersion: integer("mandate_version").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("risk_evaluations_proposal_idx").on(table.proposalId), index("risk_evaluations_automation_idx").on(table.automationId, table.createdAt)],
);

export type ExitReason = "stop_loss" | "take_profit" | "trailing_stop" | "partial_take_profit" | "timeout" | "agent_close" | "manual_close" | "close_all";

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").notNull().references(() => tradeProposals.id, { onDelete: "cascade" }),
    mode: text("mode").$type<"paper" | "live">().notNull(),
    assetAddress: text("asset_address").notNull(),
    symbol: text("symbol").notNull(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    /** What is still held. */
    quantity: usd("quantity").notNull(),
    initialQuantity: usd("initial_quantity").notNull(),
    entryPriceUsd: usd("entry_price_usd").notNull(),
    stopLossPrice: usd("stop_loss_price").notNull(),
    initialStopLossPrice: usd("initial_stop_loss_price").notNull(),
    takeProfitPrice: usd("take_profit_price"),
    highestPriceUsd: usd("highest_price_usd").notNull(),
    lastPriceUsd: usd("last_price_usd").notNull(),
    lastPriceAt: at("last_price_at").notNull(),
    breakEvenMoved: boolean("break_even_moved").notNull().default(false),
    partialTaken: boolean("partial_taken").notNull().default(false),
    /** Price gains and losses on what has been sold, before fees. */
    realizedPnlUsd: usd("realized_pnl_usd").notNull().default(0),
    /** Swap and network fees on the entry and every exit. */
    feesUsd: usd("fees_usd").notNull().default(0),
    /** The mandate version that approved the entry; its exit rules govern this position for life. */
    mandateId: uuid("mandate_id").notNull().references(() => riskMandates.id),
    mandateVersion: integer("mandate_version").notNull(),
    openedAt: at("opened_at").notNull().defaultNow(),
    expiresAt: at("expires_at"),
    closedAt: at("closed_at"),
    closeReason: text("close_reason").$type<ExitReason>(),
  },
  (table) => [index("positions_automation_idx").on(table.automationId, table.status), index("positions_open_idx").on(table.status)],
);

export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id").notNull().references(() => tradingAutomations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").references(() => tradeProposals.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "cascade" }),
    /** One per intended fill. The unique index is what makes a repeated attempt a no-op. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    mode: text("mode").$type<"paper" | "live">().notNull(),
    side: text("side").$type<"buy" | "sell">().notNull(),
    reason: text("reason").$type<"entry" | ExitReason>().notNull(),
    status: text("status").$type<"filled" | "failed">().notNull(),
    assetAddress: text("asset_address").notNull(),
    symbol: text("symbol").notNull(),
    quantity: usd("quantity").notNull(),
    priceUsd: usd("price_usd").notNull(),
    notionalUsd: usd("notional_usd").notNull(),
    swapFeeUsd: usd("swap_fee_usd").notNull().default(0),
    networkFeeUsd: usd("network_fee_usd").notNull().default(0),
    slippagePercent: usd("slippage_percent").notNull().default(0),
    /** Sells only: gain or loss on the quantity sold, before fees. */
    realizedPnlUsd: usd("realized_pnl_usd").notNull().default(0),
    quote: jsonb("quote").$type<Record<string, unknown>>(),
    /** Null in paper mode: nothing is signed or sent. */
    txHash: text("tx_hash"),
    mandateId: uuid("mandate_id").notNull().references(() => riskMandates.id),
    mandateVersion: integer("mandate_version").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("executions_automation_idx").on(table.automationId, table.createdAt), index("executions_position_idx").on(table.positionId)],
);

/** Append-only history of everything that happened to an agent or wallet. Never holds keys or secrets. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references(() => tradingAutomations.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id"),
    runId: uuid("run_id"),
    proposalId: uuid("proposal_id"),
    positionId: uuid("position_id"),
    type: text("type").notNull(),
    actor: text("actor").$type<"user" | "agent" | "risk_engine" | "execution" | "monitor" | "system">().notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index("audit_events_automation_idx").on(table.automationId, table.createdAt), index("audit_events_user_idx").on(table.userId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type TradingWallet = typeof tradingWallets.$inferSelect;
export type TradingAutomation = typeof tradingAutomations.$inferSelect;
export type RiskMandateRow = typeof riskMandates.$inferSelect;
export type TradingStrategyRow = typeof tradingStrategies.$inferSelect;
export type TradingRun = typeof tradingRuns.$inferSelect;
export type TradeProposal = typeof tradeProposals.$inferSelect;
export type RiskEvaluation = typeof riskEvaluations.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
