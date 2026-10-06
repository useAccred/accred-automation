import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export type User = typeof users.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
