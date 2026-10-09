import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { automations, db, positions, runs, tradingAutomations, webBotWatches, webBots, type BotWatchKind, type WebBot, type WebBotWatch } from "../db";
import { timeAgo } from "../format";
import { fetchSnapshots } from "../trading/market-data";
import { fmtPrice, signedUsd } from "../trading/format";
import { notify } from "./notify";
import { coinPrices, resolveAsset } from "./prices";

/**
 * Alerts a web bot keeps for its user. A price watch fires once when the
 * price crosses; event watches (a position closed, a run failed, an agent
 * auto-paused) are standing and fire for every new event. The watcher checks
 * them once a minute with no model call, so they cost no credits, and each
 * notice lands in the bot's thread and in the user's Telegram.
 */

export const MAX_WATCHES = 30;

export interface ParsedWatch {
  kind: BotWatchKind;
  asset?: string;
  threshold?: number;
  agent?: string;
}

/**
 * "ETH below 2000", "eth < 2000", "alert me when btc goes above 70k",
 * "cred falls to 0.05", "position closed", "run failed", "agent paused Momentum".
 * Case never matters.
 */
export function parseWatch(text: string): ParsedWatch | null {
  let clean = text.trim().replace(/[$,]/g, "").replace(/\s+/g, " ");
  clean = clean.replace(/^(?:please\s+)?(?:tell me|notify me|alert me|ping me|warn me|message me|msg me|alert|notify|watch)?\s*(?:on telegram\s*)?(?:when|if|once)?\s*(?:the\s+)?(?:price of\s+)?/i, "").trim();
  const price = /^([a-z0-9.]{2,16}|0x[0-9a-f]{40})\s*(?:price\s*)?(?:is\s+|goes\s+|gets\s+|falls?\s+|drops?\s+|rises?\s+|climbs?\s+|moves?\s+)?(below|under|<|<=|to|above|over|>|>=|reaches|hits|crosses|past)\s*([0-9]+(?:\.[0-9]+)?)\s*(k|m)?\s*(?:usd|dollars?)?$/i.exec(clean);
  if (price) {
    const [, asset, direction, amount, unit] = price;
    const factor = unit?.toLowerCase() === "k" ? 1_000 : unit?.toLowerCase() === "m" ? 1_000_000 : 1;
    const verb = /falls?|drops?/i.exec(clean)?.[0];
    const below = /below|under|^<=?$/i.test(direction!) || (direction!.toLowerCase() === "to" && Boolean(verb));
    return { kind: below ? "price_below" : "price_above", asset: asset!, threshold: Number(amount) * factor };
  }
  const event = /^(?:a\s+|an\s+|any\s+)?(position(?:s)? (?:is |gets )?closed?|closed? position|run(?:s)? (?:is |gets )?fail(?:ed|s)?|fail(?:ed|ing)? runs?|automation(?:s)? fail(?:ed|s)?|agent(?:s)? (?:is |gets )?(?:auto-?)?paused?|paused? agents?)(?:\s+(?:for\s+|on\s+)?(.+))?$/i.exec(clean);
  if (event) {
    const [, which, agent] = event;
    const kind: BotWatchKind = /position/i.test(which!) ? "position_closed" : /run|fail|automation/i.test(which!) ? "run_failed" : "agent_paused";
    return { kind, agent: agent?.trim() || undefined };
  }
  return null;
}

export const WATCH_LABEL: Record<BotWatchKind, string> = {
  price_below: "price below",
  price_above: "price above",
  position_closed: "a position closes",
  run_failed: "an automation run fails",
  agent_paused: "an agent is auto-paused",
};

export function describeWatch(watch: WebBotWatch, agentName?: string): string {
  if (watch.kind === "price_below" || watch.kind === "price_above") {
    return `${watch.assetSymbol} ${watch.kind === "price_below" ? "below" : "above"} ${fmtPrice(watch.thresholdUsd ?? 0)}${watch.status === "fired" ? " (fired)" : ""}`;
  }
  return `${WATCH_LABEL[watch.kind]}${agentName ? ` (${agentName})` : ""}`;
}

export class WatchError extends Error {}

export async function listWatches(botId: string): Promise<WebBotWatch[]> {
  return db.select().from(webBotWatches).where(and(eq(webBotWatches.botId, botId), inArray(webBotWatches.status, ["active", "fired"]))).orderBy(desc(webBotWatches.createdAt));
}

export async function createWatch(bot: Pick<WebBot, "id" | "userId">, parsed: ParsedWatch): Promise<WebBotWatch> {
  const existing = await listWatches(bot.id);
  if (existing.length >= MAX_WATCHES) throw new WatchError(`This bot already keeps ${MAX_WATCHES} alerts. Remove one first.`);
  let assetAddress: string | null = null;
  let assetSymbol: string | null = null;
  let coingeckoId: string | null = null;
  let agentId: string | null = null;
  if (parsed.kind === "price_below" || parsed.kind === "price_above") {
    if (!(parsed.threshold! > 0)) throw new WatchError("Give a price above zero.");
    const resolved = await resolveAsset(parsed.asset!);
    if (!resolved) throw new WatchError(`I could not find "${parsed.asset}". Use a token symbol, a coin name, or a 0x address on Robinhood Chain.`);
    assetAddress = resolved.address ?? null;
    coingeckoId = resolved.coingeckoId ?? null;
    assetSymbol = resolved.symbol;
  } else if (parsed.agent) {
    const rows = await db.select({ id: tradingAutomations.id, name: tradingAutomations.name }).from(tradingAutomations).where(eq(tradingAutomations.userId, bot.userId));
    const wanted = parsed.agent.toLowerCase();
    const match = rows.find((row) => row.name.toLowerCase() === wanted) ?? rows.find((row) => row.name.toLowerCase().includes(wanted));
    if (!match) throw new WatchError(`No trading agent matches "${parsed.agent}". The user's agents: ${rows.map((row) => row.name).join(", ") || "none"}.`);
    agentId = match.id;
  }
  const duplicate = existing.find(
    (watch) =>
      watch.status === "active" && watch.kind === parsed.kind && watch.assetAddress === assetAddress && watch.coingeckoId === coingeckoId && watch.thresholdUsd === (parsed.threshold ?? null) && watch.agentId === agentId,
  );
  if (duplicate) return duplicate;
  const [watch] = await db
    .insert(webBotWatches)
    .values({ botId: bot.id, userId: bot.userId, kind: parsed.kind, assetAddress, assetSymbol, coingeckoId, thresholdUsd: parsed.threshold ?? null, agentId })
    .returning();
  return watch!;
}

export async function removeWatch(botId: string, id: string): Promise<boolean> {
  const rows = await db.update(webBotWatches).set({ status: "off" }).where(and(eq(webBotWatches.id, id), eq(webBotWatches.botId, botId))).returning({ id: webBotWatches.id });
  return rows.length > 0;
}

export async function agentNames(userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: tradingAutomations.id, name: tradingAutomations.name }).from(tradingAutomations).where(eq(tradingAutomations.userId, userId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Price watches that crossed their threshold. Pure, so it can be tested without a network. */
export function pricesCrossed(watches: WebBotWatch[], prices: Map<string, number>): Array<{ watch: WebBotWatch; price: number }> {
  const hits: Array<{ watch: WebBotWatch; price: number }> = [];
  for (const watch of watches) {
    if (watch.status !== "active" || watch.thresholdUsd === null) continue;
    const key = watch.assetAddress ?? watch.coingeckoId;
    if (!key) continue;
    const price = prices.get(key);
    if (price === undefined || !Number.isFinite(price)) continue;
    if (watch.kind === "price_below" && price <= watch.thresholdUsd) hits.push({ watch, price });
    if (watch.kind === "price_above" && price >= watch.thresholdUsd) hits.push({ watch, price });
  }
  return hits;
}

export interface WatchDeps {
  chainPrices(addresses: string[]): Promise<Map<string, number>>;
  coinPrices(ids: string[]): Promise<Map<string, number>>;
  now(): number;
}

export const defaultWatchDeps: WatchDeps = {
  chainPrices: async (addresses) => new Map([...(await fetchSnapshots(addresses, { fresh: true })).entries()].map(([address, snapshot]) => [address, snapshot.priceUsd])),
  coinPrices: async (ids) => new Map([...(await coinPrices(ids)).entries()].map(([id, row]) => [id, row.priceUsd])),
  now: () => Date.now(),
};

/** What a bot should tell its user now. Fired price watches are marked; event watches stay active. */
export async function checkWatches(bot: WebBot, deps: WatchDeps = defaultWatchDeps): Promise<Array<{ title: string; text: string }>> {
  const watches = await listWatches(bot.id);
  const now = deps.now();
  const since = bot.lastWatchAt ?? new Date(now - 60_000);
  const notices: Array<{ title: string; text: string }> = [];
  const names = await agentNames(bot.userId);

  const priceWatches = watches.filter((watch) => watch.status === "active" && (watch.assetAddress || watch.coingeckoId));
  if (priceWatches.length) {
    const addresses = [...new Set(priceWatches.map((watch) => watch.assetAddress).filter((value): value is string => Boolean(value)))];
    const ids = [...new Set(priceWatches.map((watch) => watch.coingeckoId).filter((value): value is string => Boolean(value)))];
    const prices = new Map<string, number>();
    if (addresses.length) for (const [key, value] of await deps.chainPrices(addresses).catch(() => new Map<string, number>())) prices.set(key, value);
    if (ids.length) for (const [key, value] of await deps.coinPrices(ids).catch(() => new Map<string, number>())) prices.set(key, value);
    for (const { watch, price } of pricesCrossed(priceWatches, prices)) {
      await db.update(webBotWatches).set({ status: "fired", firedCount: watch.firedCount + 1, lastFiredAt: new Date(now) }).where(eq(webBotWatches.id, watch.id));
      notices.push({
        title: `Alert · ${watch.assetSymbol} ${watch.kind === "price_below" ? "below" : "above"} ${fmtPrice(watch.thresholdUsd ?? 0)}`,
        text: `${watch.assetSymbol} is at ${fmtPrice(price)}, ${watch.kind === "price_below" ? "below" : "above"} your ${fmtPrice(watch.thresholdUsd ?? 0)} alert.`,
      });
    }
  }

  const eventWatches = watches.filter((watch) => watch.status === "active" && !watch.assetAddress && !watch.coingeckoId);
  const wants = (kind: BotWatchKind, agentId: string | null) => eventWatches.filter((watch) => watch.kind === kind && (!watch.agentId || watch.agentId === agentId));
  const bump = async (hit: WebBotWatch[], by = 1) => {
    if (hit.length) await db.update(webBotWatches).set({ firedCount: hit[0]!.firedCount + by, lastFiredAt: new Date(now) }).where(inArray(webBotWatches.id, hit.map((watch) => watch.id)));
  };

  if (eventWatches.some((watch) => watch.kind === "position_closed")) {
    const closed = await db
      .select({ automationId: positions.automationId, symbol: positions.symbol, realizedPnlUsd: positions.realizedPnlUsd, feesUsd: positions.feesUsd, closeReason: positions.closeReason })
      .from(positions)
      .where(and(eq(positions.userId, bot.userId), eq(positions.status, "closed"), gte(positions.closedAt, since)))
      .limit(20);
    for (const position of closed) {
      const hit = wants("position_closed", position.automationId);
      if (hit.length === 0) continue;
      const name = names.get(position.automationId) ?? "An agent";
      notices.push({ title: `Alert · ${name} closed ${position.symbol}`, text: `${name} closed ${position.symbol}: ${signedUsd(position.realizedPnlUsd - position.feesUsd)} after fees (${(position.closeReason ?? "closed").replace(/_/g, " ")}).` });
      await bump(hit);
    }
  }
  if (eventWatches.some((watch) => watch.kind === "run_failed")) {
    const failed = await db
      .select({ name: automations.name, error: runs.error, finishedAt: runs.finishedAt })
      .from(runs)
      .innerJoin(automations, eq(automations.id, runs.automationId))
      .where(and(eq(runs.userId, bot.userId), inArray(runs.status, ["failed", "stopped_budget"]), gte(runs.finishedAt, since)))
      .limit(20);
    for (const run of failed) notices.push({ title: `Alert · "${run.name}" failed`, text: `Automation "${run.name}" failed ${timeAgo(run.finishedAt)}: ${(run.error ?? "no details").slice(0, 200)}` });
    if (failed.length) await bump(wants("run_failed", null), failed.length);
  }
  if (eventWatches.some((watch) => watch.kind === "agent_paused")) {
    const paused = await db
      .select({ id: tradingAutomations.id, name: tradingAutomations.name, reason: tradingAutomations.pauseReason })
      .from(tradingAutomations)
      .where(and(eq(tradingAutomations.userId, bot.userId), eq(tradingAutomations.status, "paused"), eq(tradingAutomations.pausedBy, "breaker"), gte(tradingAutomations.updatedAt, since)));
    for (const agent of paused) {
      const hit = wants("agent_paused", agent.id);
      if (hit.length === 0) continue;
      notices.push({ title: `Alert · ${agent.name} auto-paused`, text: `${agent.name} was auto-paused: ${agent.reason ?? "a safety limit was reached"}. Resume it from the Trading page or ask me.` });
      await bump(hit);
    }
  }
  return notices;
}

const EVERY_MS = 60_000;
let lastRun = 0;

/** One pass over every bot that has an active watch. Called by the watcher once a minute. */
export async function watchTick(deps: WatchDeps = defaultWatchDeps): Promise<number> {
  const now = deps.now();
  if (now - lastRun < EVERY_MS) return 0;
  lastRun = now;
  const active = await db.selectDistinct({ botId: webBotWatches.botId }).from(webBotWatches).where(eq(webBotWatches.status, "active"));
  let sent = 0;
  for (const { botId } of active) {
    const [bot] = await db.select().from(webBots).where(eq(webBots.id, botId));
    if (!bot) continue;
    try {
      const notices = await checkWatches(bot, deps);
      await db.update(webBots).set({ lastWatchAt: new Date(now) }).where(eq(webBots.id, bot.id));
      for (const notice of notices) {
        await notify({ botId: bot.id, userId: bot.userId, botName: bot.name, title: notice.title, text: notice.text, kind: "alert" });
        sent++;
      }
    } catch (error) {
      console.error(`[bot-watch ${bot.id}]`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}

const globalForWatcher = globalThis as unknown as { __accredBotWatcher?: ReturnType<typeof setInterval> };

/** Starts the once-a-minute watcher inside the server process. Safe to call more than once. */
export function startBotWatcher(intervalMs = 30_000): void {
  if (globalForWatcher.__accredBotWatcher) return;
  globalForWatcher.__accredBotWatcher = setInterval(() => {
    watchTick().catch((error) => console.error("[bot-watch]", error instanceof Error ? error.message : error));
  }, intervalMs);
  globalForWatcher.__accredBotWatcher.unref();
}
