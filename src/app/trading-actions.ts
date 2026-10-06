"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { listModels } from "@/lib/accred";
import { usableTextModels } from "@/lib/agent/router";
import { rateLimited, requireUser } from "@/lib/auth";
import { MICRO, toMicro } from "@/lib/credits";
import { connections, db, positions, riskMandates, tradingAutomations, tradingStrategies, tradingWallets } from "@/lib/db";
import { isValidTimezone } from "@/lib/schedule";
import { audit } from "@/lib/trading/audit";
import { runTradingCycle } from "@/lib/trading/engine";
import { LIVE_TRADING_AVAILABLE } from "@/lib/trading/live";
import { MandateSchema, canonicalMandate, profileOf, riskIncreases, type Mandate } from "@/lib/trading/mandate";
import { INTERVALS, NUMERIC_KEYS, mandateLabel } from "@/lib/trading/mandate-fields";
import { cleanSymbol, fetchSnapshots } from "@/lib/trading/market-data";
import { closePosition } from "@/lib/trading/monitor";
import { notifyTrading } from "@/lib/trading/notify";
import { PERMISSIONS, REQUIRED_WITH_EXECUTE, TRADING_AUTHORITY, isPermission, type Permission } from "@/lib/trading/permissions";
import { loadAgent, loadPortfolio } from "@/lib/trading/store";
import { isStrategyKind } from "@/lib/trading/strategy";
import { WalletError, createWallet, importWallet, removeWallet, setTradingAuthority, withdraw } from "@/lib/trading/wallets";

export type TradingFormState =
  | {
      error?: string;
      /** Changes that loosen the mandate and need an explicit yes before they are saved. */
      riskIncreases?: string[];
      values?: Record<string, string>;
    }
  | undefined;

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const isUuid = (value: string) => z.uuid().safeParse(value).success;

async function ownAgent(userId: string, id: string) {
  if (!isUuid(id)) return null;
  const agent = await loadAgent(id);
  return agent && agent.automation.userId === userId ? agent : null;
}

// ── Wallets ─────────────────────────────────────────────────────────────────

export async function createTradingWallet(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  if (rateLimited(`wallet-create:${user.id}`, 6, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  try {
    const wallet = await createWallet(user.id, text(form, "name"));
    revalidatePath("/app/trading", "layout");
    return { values: { created: wallet.address } };
  } catch (error) {
    return { error: error instanceof WalletError ? error.message : "The wallet could not be created." };
  }
}

export async function importTradingWallet(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  if (rateLimited(`wallet-create:${user.id}`, 6, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  if (form.get("dedicated") !== "on") return { error: "Confirm that this wallet was made only for this agent." };
  try {
    const wallet = await importWallet(user.id, text(form, "name"), text(form, "privateKey"));
    revalidatePath("/app/trading", "layout");
    return { values: { created: wallet.address } };
  } catch (error) {
    // Only the service's own messages are shown: nothing here can echo the key back.
    return { error: error instanceof WalletError ? error.message : "The wallet could not be imported." };
  }
}

export async function removeTradingWallet(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  try {
    await removeWallet(user.id, text(form, "walletId"));
  } catch (error) {
    return { error: error instanceof WalletError ? error.message : "The wallet could not be removed." };
  }
  revalidatePath("/app/trading", "layout");
  return { values: { removed: "1" } };
}

export async function setWalletAuthority(form: FormData): Promise<void> {
  const user = await requireUser();
  const walletId = text(form, "walletId");
  if (!isUuid(walletId)) return;
  await setTradingAuthority(user.id, walletId, text(form, "allowed") === "true").catch(() => {});
  revalidatePath("/app/trading", "layout");
}

export async function withdrawFromWallet(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  if (rateLimited(`withdraw:${user.id}`, 5, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  const asset = text(form, "asset");
  const walletId = text(form, "walletId");
  if (!isUuid(walletId) || (asset !== "ETH" && asset !== "USDG")) return { error: "Choose what to withdraw." };
  if (form.get("confirm") !== "on") return { error: "Confirm the destination address. A transfer cannot be undone." };
  try {
    const result = await withdraw({ userId: user.id, walletId, asset, to: text(form, "to"), amount: text(form, "amount") });
    revalidatePath("/app/trading", "layout");
    return { values: { hash: result.hash, amount: result.amount, asset } };
  } catch (error) {
    return { error: error instanceof WalletError ? error.message : "The withdrawal could not be sent." };
  }
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface AssetLookup {
  error?: string;
  asset?: { address: string; symbol: string; name: string; liquidityUsd: number; volumeH24: number };
}

/** Looks a token address up on Robinhood Chain, for adding an asset the picker does not list. */
export async function lookupAsset(address: string): Promise<AssetLookup> {
  const user = await requireUser();
  if (rateLimited(`asset-lookup:${user.id}`, 20, 60_000)) return { error: "Too many lookups. Wait a minute and try again." };
  const wanted = String(address ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wanted)) return { error: "Paste the token's 0x address on Robinhood Chain." };
  try {
    const market = (await fetchSnapshots([wanted])).get(wanted);
    if (!market) return { error: "No pool was found for that token on Robinhood Chain." };
    return { asset: { address: wanted, symbol: cleanSymbol(market.symbol) || "TOKEN", name: market.name, liquidityUsd: market.liquidityUsd, volumeH24: market.volumeH24 ?? 0 } };
  } catch {
    return { error: "Market data could not be loaded. Try again in a moment." };
  }
}

// ── Creating and editing an agent ───────────────────────────────────────────

const credits = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, "Enter a number of credits, such as 5 or 2.5.");

const AgentInput = z.object({
  name: z.string().min(1, "Give the agent a name.").max(80),
  walletId: z.uuid("Choose the dedicated wallet for this agent."),
  modelMode: z.enum(["auto", "economy", "quality", "pinned"]),
  modelId: z.string().max(200),
  maxPerRun: credits,
  maxPerMonth: credits,
  intervalMinutes: z.coerce.number().refine((value) => INTERVALS.some((interval) => interval.minutes === value), "Choose how often the agent looks at the market."),
  timezone: z.string().max(64),
  instructions: z.string().max(2000, "Keep the strategy instructions under 2,000 characters."),
});

function parseMandate(raw: string): { mandate: Mandate } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "The mandate could not be read. Reload the page and try again." };
  }
  const parsed = MandateSchema.safeParse(value);
  if (parsed.success) return { mandate: parsed.data };
  const issue = parsed.error.issues[0];
  const key = String(issue?.path[0] ?? "");
  const message = issue?.code === "invalid_type" ? "enter a number" : (issue?.message ?? "check this value");
  return { error: key ? `${mandateLabel(key)}: ${message}` : "Check the mandate and try again." };
}

/** What changed between two mandates, in words, for the audit log. */
function mandateDiff(before: Mandate, after: Mandate): string[] {
  const changes: string[] = [];
  for (const key of NUMERIC_KEYS) if (before[key] !== after[key]) changes.push(`${mandateLabel(key)}: ${before[key]} → ${after[key]}`);
  if (before.stopLossRequired !== after.stopLossRequired) changes.push(`Stop loss required: ${before.stopLossRequired} → ${after.stopLossRequired}`);
  if (before.tradingEnabled !== after.tradingEnabled) changes.push(`Trading enabled: ${before.tradingEnabled} → ${after.tradingEnabled}`);
  const assets = (mandate: Mandate) => [...mandate.allowedAssets].sort((a, b) => (a.address < b.address ? -1 : 1));
  const list = (mandate: Mandate) => assets(mandate).map((asset) => asset.symbol).join(", ") || "none";
  if (assets(before).map((asset) => asset.address).join() !== assets(after).map((asset) => asset.address).join()) changes.push(`Allowed assets: ${list(before)} → ${list(after)}`);
  if ([...before.blockedAssets].sort().join() !== [...after.blockedAssets].sort().join()) changes.push(`Blocked assets: ${before.blockedAssets.length} → ${after.blockedAssets.length}`);
  const hours = ({ tradingHours }: Mandate) => [tradingHours.enabled, tradingHours.startHour, tradingHours.endHour, [...tradingHours.days].sort().join("")].join("|");
  if (hours(before) !== hours(after)) changes.push("Trading hours changed");
  return changes;
}

export async function saveTradingAgent(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  const parsed = AgentInput.safeParse({
    name: text(form, "name"),
    walletId: text(form, "walletId"),
    modelMode: text(form, "modelMode"),
    modelId: text(form, "modelId"),
    maxPerRun: text(form, "maxPerRun"),
    maxPerMonth: text(form, "maxPerMonth"),
    intervalMinutes: text(form, "intervalMinutes"),
    timezone: text(form, "timezone") || "UTC",
    instructions: text(form, "instructions"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const input = parsed.data;
  const timezone = isValidTimezone(input.timezone) ? input.timezone : "UTC";

  const mandateResult = parseMandate(text(form, "mandate"));
  if ("error" in mandateResult) return mandateResult;
  const mandate = mandateResult.mandate;
  if (mandate.mode !== "paper" || LIVE_TRADING_AVAILABLE) {
    return { error: "Live Mode is not available yet. Run the agent in Paper Mode: it uses the same strategy and the same risk engine, with nothing signed." };
  }
  if (mandate.allowedAssets.length === 0) return { error: "Select at least one asset the agent may trade." };

  const kinds = [...new Set(form.getAll("strategies").map(String))].filter(isStrategyKind);
  if (kinds.length === 0 && !input.instructions) return { error: "Pick at least one strategy, or describe one in your own words." };

  const permissions = [...new Set(form.getAll("permissions").map(String))].filter(isPermission);
  if (permissions.includes("EXECUTE_TRADE")) {
    const missing = REQUIRED_WITH_EXECUTE.filter((permission) => !permissions.includes(permission));
    if (missing.length > 0) return { error: `An agent that opens positions also needs: ${missing.map((permission) => PERMISSIONS[permission].label).join(", ")}.` };
  }

  const maxPerRunMicro = toMicro(input.maxPerRun);
  const maxPerMonthMicro = toMicro(input.maxPerMonth);
  if (maxPerRunMicro < MICRO / 10n) return { error: "The credit budget per cycle must be at least 0.1 credits." };
  if (maxPerRunMicro > 100n * MICRO) return { error: "The credit budget per cycle can be at most 100 credits." };
  if (maxPerMonthMicro < maxPerRunMicro) return { error: "The monthly credit cap cannot be lower than the budget per cycle." };

  const [wallet] = await db.select().from(tradingWallets).where(and(eq(tradingWallets.id, input.walletId), eq(tradingWallets.userId, user.id)));
  if (!wallet) return { error: "That wallet no longer exists. Choose another." };
  if (wallet.tradingRevokedAt) return { error: "Trading authority is revoked for that wallet. Restore it on the Wallets page first." };

  const connectionIds = [...new Set(form.getAll("connectionIds").map(String))].filter(isUuid);
  if (connectionIds.length > 0) {
    const owned = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.userId, user.id), inArray(connections.id, connectionIds)));
    if (owned.length !== connectionIds.length) return { error: "One of the selected connections no longer exists." };
  }

  let modelId: string | null = null;
  if (input.modelMode === "pinned") {
    const models = usableTextModels(await listModels().catch(() => []));
    if (!models.some((model) => model.id === input.modelId)) return { error: "Pick the model from the list. That one is not available right now." };
    modelId = input.modelId;
  }

  // Step 11 of the flow: nothing starts, and nothing changes, without this.
  if (form.get("approve") !== "on") return { error: "Review the permissions and limits, then tick the box to approve them." };

  const id = text(form, "id");
  const existing = id ? await ownAgent(user.id, id) : null;
  if (id && !existing) return { error: "This agent no longer exists." };
  const base = {
    name: input.name,
    walletId: wallet.id,
    modelMode: input.modelMode,
    modelId,
    maxPerRunMicro,
    maxPerMonthMicro,
    intervalMinutes: input.intervalMinutes,
    timezone,
    connectionIds,
    permissions,
    updatedAt: new Date(),
  };

  if (!existing) {
    const targetId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tradingAutomations)
        .values({ ...base, userId: user.id, mode: "paper", status: "running", approvedAt: new Date(), nextRunAt: new Date(), peakEquityUsd: mandate.agentAllocationUsd })
        .returning({ id: tradingAutomations.id });
      await tx.insert(riskMandates).values({ automationId: created!.id, version: 1, profile: profileOf(mandate), mandate });
      await tx.insert(tradingStrategies).values({ automationId: created!.id, version: 1, kinds, instructions: input.instructions });
      await audit(
        {
          userId: user.id,
          automationId: created!.id,
          walletId: wallet.id,
          type: "agent.approved",
          actor: "user",
          summary: `Approved and started in Paper Mode with a $${mandate.agentAllocationUsd.toLocaleString("en-US")} allocation`,
          data: { mandateVersion: 1, strategyVersion: 1, mandate, strategies: kinds, permissions, wallet: wallet.address },
        },
        tx,
      );
      return created!.id;
    });
    revalidatePath("/app/trading", "layout");
    redirect(`/app/trading/${targetId}`);
  }

  // ── Editing: every change is a new version, and anything riskier needs an explicit yes ──
  const { automation } = existing;
  const increases = riskIncreases(existing.mandate, mandate);
  for (const permission of permissions) {
    if (!automation.permissions.includes(permission)) increases.push(`Permission granted: ${PERMISSIONS[permission].label}`);
  }
  if (increases.length > 0 && form.get("confirmRisk") !== "on") {
    return { error: "These changes let the agent risk more. Tick the confirmation above to save them.", riskIncreases: increases };
  }
  const [stillOpen] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.automationId, automation.id), eq(positions.status, "open")))
    .limit(1);
  if (stillOpen && permissions.length < automation.permissions.length) {
    const lost = (["CLOSE_POSITION", "MANAGE_PROTECTIVE_ORDERS"] as Permission[]).filter((permission) => !permissions.includes(permission));
    if (lost.length > 0) return { error: "Positions are open. Their protective exits cannot be switched off; close the positions first." };
  }

  // Compared in a fixed key order: the database does not keep the order a mandate was saved in.
  const mandateChanged = canonicalMandate(existing.mandate) !== canonicalMandate(mandate);
  const strategyChanged = JSON.stringify([existing.strategy.kinds, existing.strategy.instructions]) !== JSON.stringify([kinds, input.instructions]);
  const reapproved = automation.accessRevokedAt !== null || automation.status === "stopped";
  await db.transaction(async (tx) => {
    const mandateVersion = automation.mandateVersion + (mandateChanged ? 1 : 0);
    const strategyVersion = automation.strategyVersion + (strategyChanged ? 1 : 0);
    if (mandateChanged) {
      await tx.insert(riskMandates).values({ automationId: automation.id, version: mandateVersion, profile: profileOf(mandate), mandate, riskIncreases: increases });
    }
    if (strategyChanged) await tx.insert(tradingStrategies).values({ automationId: automation.id, version: strategyVersion, kinds, instructions: input.instructions });
    await tx
      .update(tradingAutomations)
      .set({
        ...base,
        mandateVersion,
        strategyVersion,
        configVersion: automation.configVersion + 1,
        // Approving again after access was revoked is what grants it back.
        ...(reapproved ? { status: "running" as const, accessRevokedAt: null, pausedBy: null, pauseReason: null, approvedAt: new Date(), nextRunAt: new Date(), breakerResetAt: new Date() } : {}),
      })
      .where(eq(tradingAutomations.id, automation.id));
    await audit(
      {
        userId: user.id,
        automationId: automation.id,
        type: "config.changed",
        actor: "user",
        summary: `Configuration changed${mandateChanged ? ` · mandate v${mandateVersion}` : ""}${strategyChanged ? ` · strategy v${strategyVersion}` : ""}${reapproved ? " · access approved again" : ""}`,
        data: {
          configVersion: automation.configVersion + 1,
          mandateVersion,
          strategyVersion,
          changes: mandateChanged ? mandateDiff(existing.mandate, mandate) : [],
          riskIncreasesConfirmed: increases,
          permissions,
        },
      },
      tx,
    );
  });
  revalidatePath("/app/trading", "layout");
  redirect(`/app/trading/${automation.id}`);
}

// ── Emergency controls ──────────────────────────────────────────────────────

/** Pause stops new positions. The monitor keeps enforcing stops and targets on what is open. */
export async function pauseTradingAgent(form: FormData): Promise<void> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  if (!agent) return;
  const paused = await db
    .update(tradingAutomations)
    .set({ status: "paused", pausedBy: "user", pauseReason: "Paused by you.", nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(tradingAutomations.id, agent.automation.id), eq(tradingAutomations.status, "running")))
    .returning({ id: tradingAutomations.id });
  if (paused.length > 0) {
    await audit({ userId: user.id, automationId: agent.automation.id, type: "agent.paused", actor: "user", summary: "Paused by the user. Protective monitoring continues." });
    after(() => notifyTrading(agent.automation, "PAUSED by you\nNo new positions will be opened. Open positions keep their stop loss and take profit."));
  }
  revalidatePath("/app/trading", "layout");
}

export async function resumeTradingAgent(form: FormData): Promise<void> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  // After a revoke, only a fresh review and approval (the edit form) starts the agent again.
  if (!agent || agent.automation.status !== "paused" || agent.automation.accessRevokedAt || agent.wallet.tradingRevokedAt) {
    revalidatePath("/app/trading", "layout");
    return;
  }
  const portfolio = await loadPortfolio(db, agent.automation, agent.mandate, Date.now());
  await db
    .update(tradingAutomations)
    .set({
      status: "running",
      pausedBy: null,
      pauseReason: null,
      // Resuming is a deliberate restart: the loss streak and the drawdown high-water mark start again from here.
      breakerResetAt: new Date(),
      peakEquityUsd: portfolio.equityUsd,
      simulationFailures: 0,
      dataFailures: 0,
      nextRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(tradingAutomations.id, agent.automation.id), eq(tradingAutomations.status, "paused")));
  await audit({
    userId: user.id,
    automationId: agent.automation.id,
    type: "agent.resumed",
    actor: "user",
    summary: `Resumed by the user${agent.automation.pausedBy === "breaker" ? " after an automatic pause" : ""}`,
    data: { previousReason: agent.automation.pauseReason, equityUsd: portfolio.equityUsd },
  });
  revalidatePath("/app/trading", "layout");
}

async function closeMany(ids: string[], reason: "manual_close" | "close_all") {
  let closed = 0;
  let noPrice = 0;
  for (const id of ids) {
    const outcome = await closePosition(id, reason).catch(() => ({ status: "no_price" as const }));
    if (outcome.status === "filled") closed++;
    else if (outcome.status === "no_price") noPrice++;
  }
  return { closed, noPrice };
}

/** Close all positions: pauses the agent first so nothing new opens, then sells every open position at the market price. */
export async function closeAllPositions(form: FormData): Promise<void> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  if (!agent) return;
  const { automation } = agent;
  await db
    .update(tradingAutomations)
    .set({ status: "paused", pausedBy: "user", pauseReason: "Paused when you closed all positions.", nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(tradingAutomations.id, automation.id), eq(tradingAutomations.status, "running")));
  const open = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.automationId, automation.id), eq(positions.status, "open")));
  const result = await closeMany(
    open.map((position) => position.id),
    "close_all",
  );
  await audit({
    userId: user.id,
    automationId: automation.id,
    type: "agent.close_all",
    actor: "user",
    summary: `Close all positions: ${result.closed} closed${result.noPrice ? `, ${result.noPrice} could not be priced and stay open under their stops` : ""}. Agent paused.`,
    data: result,
  });
  after(() => notifyTrading(automation, `CLOSE ALL by you\n${result.closed} position${result.closed === 1 ? "" : "s"} closed. The agent is paused.`));
  revalidatePath("/app/trading", "layout");
  redirect(`/app/trading/${automation.id}${result.noPrice ? "?notice=no_price" : ""}`);
}

export async function closeOnePosition(form: FormData): Promise<void> {
  const user = await requireUser();
  const positionId = text(form, "positionId");
  if (!isUuid(positionId)) return;
  const [position] = await db
    .select({ id: positions.id, automationId: positions.automationId })
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.userId, user.id)));
  if (!position) return;
  const result = await closeMany([position.id], "manual_close");
  revalidatePath("/app/trading", "layout");
  redirect(`/app/trading/${position.automationId}${result.noPrice ? "?notice=no_price" : ""}`);
}

/**
 * Revoke trading access: stops the agent and removes its permission to propose
 * or open trades. Open positions keep their protective exits. Starting again
 * takes a fresh review and approval.
 */
export async function revokeTradingAccess(form: FormData): Promise<void> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  if (!agent) return;
  const { automation } = agent;
  await db
    .update(tradingAutomations)
    .set({
      status: "stopped",
      accessRevokedAt: new Date(),
      pausedBy: "user",
      pauseReason: "Trading access revoked by you.",
      permissions: automation.permissions.filter((permission) => !TRADING_AUTHORITY.includes(permission)),
      nextRunAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tradingAutomations.id, automation.id));
  await audit({
    userId: user.id,
    automationId: automation.id,
    type: "agent.access_revoked",
    actor: "user",
    summary: "Trading access revoked. The agent can no longer propose or open trades.",
    data: { removed: TRADING_AUTHORITY },
  });
  after(() => notifyTrading(automation, "TRADING ACCESS REVOKED by you\nThe agent can no longer propose or open trades. Open positions keep their stop loss and take profit."));
  revalidatePath("/app/trading", "layout");
}

export async function runTradingCycleNow(form: FormData): Promise<void> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  if (!agent || rateLimited(`trading-run:${agent.automation.id}`, 4, 60_000)) return;
  after(() => runTradingCycle(agent.automation.id, "manual").then(() => undefined));
  revalidatePath("/app/trading", "layout");
}

export async function deleteTradingAgent(_previous: TradingFormState, form: FormData): Promise<TradingFormState> {
  const user = await requireUser();
  const agent = await ownAgent(user.id, text(form, "id"));
  if (!agent) redirect("/app/trading");
  const [open] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.automationId, agent.automation.id), eq(positions.status, "open")))
    .limit(1);
  if (open) return { error: "This agent has open positions. Close them first." };
  await db.delete(tradingAutomations).where(eq(tradingAutomations.id, agent.automation.id));
  await audit({ userId: user.id, walletId: agent.wallet.id, type: "agent.deleted", actor: "user", summary: `Deleted trading agent "${agent.automation.name}"` });
  revalidatePath("/app/trading", "layout");
  redirect("/app/trading");
}
