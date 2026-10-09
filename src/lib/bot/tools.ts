import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createRun, executeRun } from "../agent/runner";
import { ToolError, toolsFor, type ToolContext, type ToolDef } from "../agent/tools";
import { getBalance } from "../balance";
import { MICRO, formatCredits, formatUsd, toMicro } from "../credits";
import { randomToken } from "../crypto";
import { automations, connections, db, runs, tradingAutomations, type User, type WebBot } from "../db";
import { env } from "../env";
import { timeAgo } from "../format";
import { describeCron, nextRun, validateCron } from "../schedule";
import { closeAllPositions, ownedAgent, pauseAgent, resumeAgent } from "../trading/controls";
import { runTradingCycle } from "../trading/engine";
import { fmtPrice, fmtUsd, signedUsd } from "../trading/format";
import { topAssets } from "../trading/market-data";
import { agentDashboard, listPositions, listTradingAgents, listTrades } from "../trading/queries";
import { loadAgent, type LoadedAgent } from "../trading/store";
import type { ConnectionKind } from "../connections/kinds";
import { telegramTarget } from "./notify";
import { PriceError, formatQuote, quote, resolveAsset } from "./prices";
import { WatchError, agentNames, createWatch, describeWatch, listWatches, parseWatch, removeWatch } from "./watches";

/**
 * What a web bot can do: the automation tools for the user's connections
 * (web pages, mail, chat apps, GitHub, HTTP), its own memory, and a few
 * read-only views of the account. Write tools never run from the model; the
 * engine turns them into a confirmation in the thread.
 */

export interface BotToolContext extends ToolContext {
  user: User;
  bot: WebBot;
}

function define<Schema extends z.ZodType>(tool: ToolDef<z.infer<Schema>> & { schema: Schema }): ToolDef {
  return tool as unknown as ToolDef;
}

const accountBalance = define({
  name: "account.balance",
  summary: "The user's Accred credit balance.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "Check the balance",
  async run(_args, context) {
    const balance = await getBalance((context as BotToolContext).user).catch(() => null);
    if (!balance) return "Balance: not known yet. It appears after the first model call.";
    return `Balance: ${formatCredits(balance.micro)} credits (${formatUsd(balance.micro)})${balance.source === "reported" ? `, as of ${timeAgo(balance.at)}` : ""}. 100 credits = $1. Top up on the Wallet page at https://accred.sh.`;
  },
});

const automationsList = define({
  name: "automations.list",
  summary: "The user's automations with their trigger, state and last run.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "List the automations",
  async run(_args, context) {
    const { user } = context as BotToolContext;
    const rows = await db.select().from(automations).where(eq(automations.userId, user.id)).orderBy(desc(automations.createdAt));
    if (rows.length === 0) return "No automations yet. They are created on the Automations page.";
    const lines = await Promise.all(
      rows.map(async (automation) => {
        const [last] = await db.select({ status: runs.status, createdAt: runs.createdAt }).from(runs).where(eq(runs.automationId, automation.id)).orderBy(desc(runs.createdAt)).limit(1);
        const trigger = automation.triggerType === "schedule" && automation.cron ? describeCron(automation.cron) : automation.triggerType === "webhook" ? "webhook" : "manual";
        return `- ${automation.name} (${automation.enabled ? "on" : "paused"}, ${trigger}); last run: ${last ? `${last.status} ${timeAgo(last.createdAt)}` : "never"}`;
      }),
    );
    return lines.join("\n");
  },
});

const tradingOverview = define({
  name: "trading.overview",
  summary: "The user's trading agents: state, allocation, equity, today's and total profit or loss, open positions.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "Check the trading agents",
  async run(_args, context) {
    const { user } = context as BotToolContext;
    const agents = await listTradingAgents(user.id);
    if (agents.length === 0) return "No trading agents. They are created on the Trading page.";
    return agents
      .map((agent) => {
        const p = agent.portfolio;
        return `- ${agent.automation.name}: ${agent.automation.status}; allocation ${fmtUsd(p.allocationUsd)}; equity ${fmtUsd(p.equityUsd)}; realized after fees ${signedUsd(p.realizedNetUsd)}; unrealized ${signedUsd(p.unrealizedUsd)}; open positions ${p.openPositions}${p.openAssets.length ? ` (${p.openAssets.join(", ")})` : ""}.`;
      })
      .join("\n");
  },
});

// ── Prices ──────────────────────────────────────────────────────────────────

const marketPrice = define({
  name: "market.price",
  summary: "The live price of any token or coin: a symbol (ETH, BTC, SOL, CRED), a coin name, or a 0x address on Robinhood Chain. Use it for every price question instead of guessing.",
  argsHint: '{"asset": string}',
  schema: z.object({ asset: z.string().min(1).max(80) }),
  effect: "read",
  title: (args) => `Check the price of ${args.asset.toUpperCase()}`,
  async run(args) {
    const resolved = await resolveAsset(args.asset);
    if (!resolved) throw new ToolError(`I could not find "${args.asset}". Try a symbol, a coin name, or a 0x address on Robinhood Chain.`);
    try {
      return formatQuote(await quote(resolved));
    } catch (error) {
      throw new ToolError(error instanceof PriceError ? error.message : "The price could not be read right now.");
    }
  },
});

const marketTop = define({
  name: "market.top",
  summary: "The most traded tokens on Robinhood Chain with price, liquidity, volume and market cap. Use it to answer \"what trades here\" or to pick an allowlist.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "List the top tokens on Robinhood Chain",
  async run() {
    const assets = await topAssets().catch(() => []);
    if (assets.length === 0) return "The token list could not be loaded right now; the price providers may be busy. Try again in a minute.";
    return assets.map((asset) => `- ${asset.symbol} (${asset.name}) ${asset.address}: liquidity ${fmtUsd(asset.liquidityUsd)}, 24h volume ${fmtUsd(asset.volumeH24)}, market cap ${asset.marketCapUsd === null ? "unknown" : fmtUsd(asset.marketCapUsd)}`).join("\n");
  },
});

// ── Alerts ──────────────────────────────────────────────────────────────────

const alertsCreate = define({
  name: "alerts.create",
  summary:
    'Set an alert this bot checks every minute at no credit cost and delivers to this thread and to the user\'s Telegram: a price threshold ("ETH below 2000", "BTC above 70k", "CRED above 0.05"; fires once) or a standing event watch ("position closed", "run failed", "agent paused", optionally for one agent).',
  argsHint: '{"text": string}',
  schema: z.object({ text: z.string().min(3).max(160) }),
  effect: "internal",
  title: (args) => `Set alert: ${args.text}`,
  async run(args, context) {
    const { bot, user } = context as BotToolContext;
    const parsed = parseWatch(args.text);
    if (!parsed) throw new ToolError('I did not understand that alert. Examples: "ETH below 2000", "BTC above 70k", "position closed", "run failed", "agent paused Momentum".');
    try {
      const watch = await createWatch(bot, parsed);
      const telegram = await telegramTarget(user.id);
      return `Alert set: ${describeWatch(watch)}. Checked every minute, no credits. It will appear here${telegram ? " and in your Telegram" : ". Connect Telegram on the Connections page to get it on your phone too"}.`;
    } catch (error) {
      throw new ToolError(error instanceof WatchError ? error.message : "The alert could not be set.");
    }
  },
});

const alertsList = define({
  name: "alerts.list",
  summary: "This bot's alerts, numbered, with their state.",
  argsHint: "{}",
  schema: z.object({}),
  effect: "read",
  title: () => "List the alerts",
  async run(_args, context) {
    const { bot, user } = context as BotToolContext;
    const watches = await listWatches(bot.id);
    if (watches.length === 0) return "No alerts set on this bot.";
    const names = await agentNames(user.id);
    return watches.map((watch, index) => `${index + 1}. ${describeWatch(watch, watch.agentId ? names.get(watch.agentId) : undefined)}`).join("\n");
  },
});

const alertsRemove = define({
  name: "alerts.remove",
  summary: "Remove one alert by its number from alerts.list, or all of them.",
  argsHint: '{"number": number | "all"}',
  schema: z.object({ number: z.union([z.literal("all"), z.coerce.number().int().min(1)]) }),
  effect: "internal",
  title: (args) => (args.number === "all" ? "Remove all alerts" : `Remove alert ${args.number}`),
  async run(args, context) {
    const { bot } = context as BotToolContext;
    const watches = await listWatches(bot.id);
    if (watches.length === 0) return "There are no alerts to remove.";
    if (args.number === "all") {
      for (const watch of watches) await removeWatch(bot.id, watch.id);
      return `Removed ${watches.length} alert${watches.length === 1 ? "" : "s"}.`;
    }
    const watch = watches[args.number - 1];
    if (!watch) throw new ToolError(`There is no alert ${args.number}. This bot has ${watches.length}.`);
    await removeWatch(bot.id, watch.id);
    return `Removed: ${describeWatch(watch)}.`;
  },
});

// ── Routines (automations) ──────────────────────────────────────────────────

async function findAutomation(userId: string, query: string) {
  const rows = await db.select().from(automations).where(eq(automations.userId, userId)).orderBy(desc(automations.createdAt));
  if (rows.length === 0) throw new ToolError("The user has no automations yet.");
  const wanted = query.trim().toLowerCase();
  const match = rows.find((row) => row.id === wanted) ?? rows.find((row) => row.name.toLowerCase() === wanted) ?? rows.find((row) => row.name.toLowerCase().includes(wanted));
  if (!match) throw new ToolError(`No automation matches "${query}". The user's automations: ${rows.map((row) => row.name).join(", ")}.`);
  return match;
}

const RoutineArgs = z.object({
  name: z.string().min(1).max(80),
  instruction: z.string().min(10).max(4000),
  cron: z.string().max(100).optional(),
  connections: z.array(z.enum(["telegram", "gmail", "slack", "discord", "github", "http"])).max(6).optional(),
  requireApproval: z.boolean().optional(),
  modelMode: z.enum(["auto", "economy", "quality"]).optional(),
  creditsPerRun: z.coerce.number().min(0.1).max(1000).optional(),
});

const automationsCreate = define({
  name: "automations.create",
  summary:
    "Create a routine: a job the agent runs on a schedule (five-field cron, in the user's timezone; at least every 5 minutes) or when the user asks. The job can read the web, use the user's connected apps and message the user on Telegram. Write the instruction as a brief to a person: where to look, what to decide, what to send, when to do nothing. Needs confirmation.",
  argsHint:
    '{"name": string, "instruction": string, "cron"?: string (omit for a manual job), "connections"?: ("telegram"|"gmail"|"slack"|"discord"|"github"|"http")[], "requireApproval"?: boolean (default true), "modelMode"?: "auto"|"economy"|"quality", "creditsPerRun"?: number (default 10)}',
  schema: RoutineArgs,
  effect: "write",
  title: (args) => `Create routine "${args.name}"`,
  async run(args, context) {
    const { user } = context as BotToolContext;
    const timezone = "UTC";
    const cron = args.cron?.trim() || null;
    if (cron) {
      const problem = validateCron(cron, timezone);
      if (problem) throw new ToolError(`Schedule problem: ${problem}`);
    }
    const kinds = [...new Set(args.connections ?? [])];
    const rows = kinds.length ? await db.select({ id: connections.id, kind: connections.kind }).from(connections).where(eq(connections.userId, user.id)) : [];
    const missing = kinds.filter((kind) => !rows.some((row) => row.kind === kind));
    if (missing.length) throw new ToolError(`The user has no ${missing.join(", ")} connection. They can add one at ${env.appUrl}/app/connections.`);
    const connectionIds = kinds.map((kind) => rows.find((row) => row.kind === kind)!.id);
    const creditsPerRun = args.creditsPerRun ?? 10;
    const maxPerRunMicro = toMicro(creditsPerRun);
    const [created] = await db
      .insert(automations)
      .values({
        userId: user.id,
        name: args.name.trim(),
        instruction: args.instruction.trim(),
        triggerType: cron ? "schedule" : "manual",
        cron,
        timezone,
        webhookToken: randomToken(24),
        connectionIds,
        modelMode: args.modelMode ?? "auto",
        maxPerRunMicro,
        maxPerMonthMicro: maxPerRunMicro * 30n > 300n * MICRO ? maxPerRunMicro * 30n : 300n * MICRO,
        requireApproval: args.requireApproval ?? true,
        enabled: true,
        nextRunAt: cron ? nextRun(cron, timezone) : null,
      })
      .returning({ id: automations.id, nextRunAt: automations.nextRunAt });
    return `Routine "${args.name}" created: ${cron ? `${describeCron(cron)} (UTC)` : "runs when asked"}.${created!.nextRunAt ? ` First run ${timeAgo(created!.nextRunAt)}.` : ""} Page: ${env.appUrl}/app/automations/${created!.id}`;
  },
});

const automationsRun = define({
  name: "automations.run",
  summary: "Run one of the user's routines now. Needs confirmation.",
  argsHint: '{"automation": string (name or id)}',
  schema: z.object({ automation: z.string().min(1).max(120) }),
  effect: "write",
  title: (args) => `Run routine "${args.automation}"`,
  async run(args, context) {
    const { user } = context as BotToolContext;
    const automation = await findAutomation(user.id, args.automation);
    const run = await createRun(automation, "manual");
    if (!run.runnable) return `"${automation.name}" has reached its monthly credit cap, so the run was not started.`;
    void executeRun(run.id);
    return `"${automation.name}" is running. Result: ${env.appUrl}/app/runs/${run.id}`;
  },
});

const automationsSetEnabled = define({
  name: "automations.set_enabled",
  summary: "Pause or resume a routine's schedule. Needs confirmation.",
  argsHint: '{"automation": string, "enabled": boolean}',
  schema: z.object({ automation: z.string().min(1).max(120), enabled: z.boolean() }),
  effect: "write",
  title: (args) => `${args.enabled ? "Resume" : "Pause"} routine "${args.automation}"`,
  async run(args, context) {
    const { user } = context as BotToolContext;
    const automation = await findAutomation(user.id, args.automation);
    await db
      .update(automations)
      .set({ enabled: args.enabled, nextRunAt: args.enabled && automation.triggerType === "schedule" && automation.cron ? nextRun(automation.cron, automation.timezone) : null, updatedAt: new Date() })
      .where(eq(automations.id, automation.id));
    return `"${automation.name}" is ${args.enabled ? "on" : "paused"}.`;
  },
});

// ── Trading controls ────────────────────────────────────────────────────────

async function findAgent(userId: string, query: string | undefined): Promise<LoadedAgent> {
  const rows = await db.select({ id: tradingAutomations.id, name: tradingAutomations.name }).from(tradingAutomations).where(eq(tradingAutomations.userId, userId)).orderBy(desc(tradingAutomations.createdAt));
  if (rows.length === 0) throw new ToolError("The user has no trading agents yet. They are created on the Trading page.");
  const wanted = (query ?? "").trim().toLowerCase();
  let match = rows.find((row) => row.id === wanted);
  if (!match && wanted) match = rows.find((row) => row.name.toLowerCase() === wanted) ?? rows.find((row) => row.name.toLowerCase().includes(wanted));
  if (!match && !wanted && rows.length === 1) match = rows[0];
  if (!match) throw new ToolError(`No agent matches "${query}". The user's agents: ${rows.map((row) => row.name).join(", ")}.`);
  const agent = await loadAgent(match.id);
  if (!agent) throw new ToolError("That agent could not be loaded.");
  return agent;
}

const agentArg = z.object({ agent: z.string().max(120).optional() });

const tradingAgent = define({
  name: "trading.agent",
  summary: "One trading agent in detail: status, allocation, equity, PnL, open positions with their stop and target, recent trades.",
  argsHint: '{"agent"?: string (name or id; may be omitted when the user has one agent)}',
  schema: agentArg,
  effect: "read",
  title: (args) => `Check agent ${args.agent ?? ""}`.trim(),
  async run(args, context) {
    const { user } = context as BotToolContext;
    const agent = await findAgent(user.id, args.agent);
    const [dashboard, open, trades] = await Promise.all([agentDashboard(agent), listPositions(agent.automation.id, "open", 10), listTrades(agent.automation.id, 5)]);
    const p = dashboard.portfolio;
    const lines = [
      `${agent.automation.name}: ${agent.automation.status}${agent.automation.pausedBy === "breaker" ? ` (auto-paused: ${agent.automation.pauseReason ?? "safety limit"})` : ""}.`,
      `Allocation ${fmtUsd(p.allocationUsd)}, available ${fmtUsd(p.availableUsd)}, equity ${fmtUsd(p.equityUsd)}, drawdown ${p.drawdownPercent.toFixed(1)}%.`,
      `Today ${signedUsd(p.dayNetUsd)}, realized ${signedUsd(p.realizedNetUsd)}, unrealized ${signedUsd(p.unrealizedUsd)}. ${dashboard.stats.closedTrades} closed trades.`,
      `Assets: ${agent.mandate.allowedAssets.map((asset) => asset.symbol).join(", ")}.`,
    ];
    if (open.length) lines.push("Open positions:", ...open.map((position) => `- ${position.symbol}: ${position.quantity.toPrecision(5)} at ${fmtPrice(position.entryPriceUsd)}, now ${fmtPrice(position.lastPriceUsd)}, stop ${fmtPrice(position.stopLossPrice)}, target ${position.takeProfitPrice ? fmtPrice(position.takeProfitPrice) : "none"}`));
    if (trades.length) lines.push("Recent trades:", ...trades.map((trade) => `- ${timeAgo(trade.createdAt)} ${trade.side} ${trade.symbol} ${fmtUsd(trade.notionalUsd)} at ${fmtPrice(trade.priceUsd)} (${trade.reason}) ${trade.status}`));
    lines.push(`Page: ${env.appUrl}/app/trading/${agent.automation.id}`);
    return lines.join("\n");
  },
});

function control(name: string, summary: string, verb: string, act: (agent: LoadedAgent) => Promise<string>) {
  return define({
    name,
    summary,
    argsHint: '{"agent": string (name or id)}',
    schema: agentArg,
    effect: "write",
    title: (args) => `${verb} ${args.agent ?? "the trading agent"}`,
    async run(args, context) {
      const { user } = context as BotToolContext;
      const agent = await findAgent(user.id, args.agent);
      const owned = await ownedAgent(user.id, agent.automation.id);
      if (!owned) throw new ToolError("That agent no longer exists.");
      return act(owned);
    },
  });
}

const tradingPause = control("trading.pause", "Pause a trading agent: no new positions, protective exits continue. Needs confirmation.", "Pause", (agent) => pauseAgent(agent, "web"));
const tradingResume = control("trading.resume", "Resume a paused trading agent. Needs confirmation.", "Resume", (agent) => resumeAgent(agent, env.liveTrading, "web"));
const tradingCloseAll = control("trading.close_all", "Pause an agent and sell every open position back to USDG at the market price. Needs confirmation.", "Close all positions of", async (agent) => (await closeAllPositions(agent, "web")).text);
const tradingRunNow = control("trading.run_now", "Start one cycle of a running agent now instead of waiting for its interval. Needs confirmation.", "Run a cycle of", async (agent) => {
  if (agent.automation.status !== "running") return `${agent.automation.name} is ${agent.automation.status}; only a running agent can run a cycle.`;
  const result = await Promise.race([
    runTradingCycle(agent.automation.id, "manual").catch((error) => ({ runId: "", status: "failed" as const, summary: error instanceof Error ? error.message : "The cycle failed." })),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 75_000)),
  ]);
  if (result === null) return "The cycle is still running. Ask for the agent's status in a minute to see the result.";
  if (!result) return "Another cycle was already running.";
  return `Cycle ${result.status}: ${result.summary}`;
});

export const ACCOUNT_TOOLS: ToolDef[] = [
  accountBalance,
  automationsList,
  tradingOverview,
  marketPrice,
  marketTop,
  alertsCreate,
  alertsList,
  alertsRemove,
  automationsCreate,
  automationsRun,
  automationsSetEnabled,
  tradingAgent,
  tradingPause,
  tradingResume,
  tradingCloseAll,
  tradingRunNow,
];

/** The tool set for one bot, given the connection kinds the user has linked. */
export function botTools(kinds: ConnectionKind[]): Map<string, ToolDef> {
  return new Map([...toolsFor(kinds), ...ACCOUNT_TOOLS].map((tool) => [tool.name, tool]));
}
