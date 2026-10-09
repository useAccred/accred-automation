import { and, eq } from "drizzle-orm";
import { db, positions, tradingAutomations } from "../db";
import { audit } from "./audit";
import { closePosition } from "./monitor";
import { notifyTrading } from "./notify";
import { TRADING_AUTHORITY } from "./permissions";
import { loadAgent, loadPortfolio, type LoadedAgent } from "./store";

/**
 * The emergency controls, shared by the web buttons and the Telegram agent.
 * Each one takes the user's id and an agent of theirs, and returns what
 * happened in words. They never raise exposure: pause, close and revoke only
 * ever reduce what the agent can do.
 */

export async function ownedAgent(userId: string, id: string): Promise<LoadedAgent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const agent = await loadAgent(id);
  return agent && agent.automation.userId === userId ? agent : null;
}

/** Pause stops new positions. The monitor keeps enforcing stops and targets on what is open. */
export async function pauseAgent(agent: LoadedAgent, via: "web" | "telegram" = "web"): Promise<string> {
  const paused = await db
    .update(tradingAutomations)
    .set({ status: "paused", pausedBy: "user", pauseReason: "Paused by you.", nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(tradingAutomations.id, agent.automation.id), eq(tradingAutomations.status, "running")))
    .returning({ id: tradingAutomations.id });
  if (paused.length === 0) return `${agent.automation.name} is not running, so there is nothing to pause.`;
  await audit({ userId: agent.automation.userId, automationId: agent.automation.id, type: "agent.paused", actor: "user", summary: "Paused by the user. Protective monitoring continues.", data: { via } });
  void notifyTrading(agent.automation, "PAUSED by you\nNo new positions will be opened. Open positions keep their stop loss and take profit.");
  return `${agent.automation.name} is paused. No new positions will be opened. Open positions keep their stop loss and take profit.`;
}

export async function resumeAgent(agent: LoadedAgent, liveEnabled: boolean, via: "web" | "telegram" = "web"): Promise<string> {
  const { automation } = agent;
  if (automation.status !== "paused") return `${automation.name} is ${automation.status}, so it cannot be resumed from here.`;
  if (automation.accessRevokedAt) return `${automation.name} had its trading access revoked. Starting it again needs a fresh review and approval on the web.`;
  if (agent.wallet.tradingRevokedAt) return `Trading authority is revoked for ${automation.name}'s wallet. Restore it on the Wallets page first.`;
  if (!liveEnabled) return "Live trading is switched off on this server, so the agent cannot be resumed yet.";
  const portfolio = await loadPortfolio(db, automation, agent.mandate, Date.now());
  const resumed = await db
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
    .where(and(eq(tradingAutomations.id, automation.id), eq(tradingAutomations.status, "paused")))
    .returning({ id: tradingAutomations.id });
  if (resumed.length === 0) return `${automation.name} was changed meanwhile. Check its page.`;
  await audit({
    userId: automation.userId,
    automationId: automation.id,
    type: "agent.resumed",
    actor: "user",
    summary: `Resumed by the user${automation.pausedBy === "breaker" ? " after an automatic pause" : ""}`,
    data: { previousReason: automation.pauseReason, equityUsd: portfolio.equityUsd, via },
  });
  return `${automation.name} is running again. The next cycle starts within a minute.`;
}

export async function closeMany(ids: string[], reason: "manual_close" | "close_all"): Promise<{ closed: number; noPrice: number }> {
  let closed = 0;
  // Not closed: no current price, or the sale did not go through. Either way the position stays open under its stop.
  let noPrice = 0;
  for (const id of ids) {
    const outcome = await closePosition(id, reason).catch(() => ({ status: "no_price" as const }));
    if (outcome.status === "filled") closed++;
    else if (outcome.status === "no_price" || outcome.status === "failed") noPrice++;
  }
  return { closed, noPrice };
}

/** Close all positions: pauses the agent first so nothing new opens, then sells every open position at the market price. */
export async function closeAllPositions(agent: LoadedAgent, via: "web" | "telegram" = "web"): Promise<{ closed: number; noPrice: number; text: string }> {
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
    userId: automation.userId,
    automationId: automation.id,
    type: "agent.close_all",
    actor: "user",
    summary: `Close all positions: ${result.closed} closed${result.noPrice ? `, ${result.noPrice} could not be sold and stay open under their stops` : ""}. Agent paused.`,
    data: { ...result, via },
  });
  void notifyTrading(automation, `CLOSE ALL by you\n${result.closed} position${result.closed === 1 ? "" : "s"} closed. The agent is paused.`);
  const text =
    `${automation.name} is paused and ${result.closed} position${result.closed === 1 ? "" : "s"} ${result.closed === 1 ? "was" : "were"} sold back to USDG.` +
    (result.noPrice ? ` ${result.noPrice} could not be sold right now and stay open under their stop loss; the monitor will keep trying.` : "");
  return { ...result, text };
}

/**
 * Revoke trading access: stops the agent and removes its permission to propose
 * or open trades. Open positions keep their protective exits. Starting again
 * takes a fresh review and approval.
 */
export async function revokeAccess(agent: LoadedAgent, via: "web" | "telegram" = "web"): Promise<string> {
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
    userId: automation.userId,
    automationId: automation.id,
    type: "agent.access_revoked",
    actor: "user",
    summary: "Trading access revoked. The agent can no longer propose or open trades.",
    data: { removed: TRADING_AUTHORITY, via },
  });
  void notifyTrading(automation, "TRADING ACCESS REVOKED by you\nThe agent can no longer propose or open trades. Open positions keep their stop loss and take profit.");
  return `Trading access for ${automation.name} is revoked. It can no longer propose or open trades. Open positions keep their stop loss and take profit. Starting it again needs a fresh review and approval on the web.`;
}
