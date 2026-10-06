import { and, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import { db, executions, positions, riskMandates, tradeProposals, tradingAutomations, tradingRuns, type ExitReason, type Position, type TradingAutomation } from "../db";
import { audit } from "./audit";
import { defaultDeps, runTradingCycle, type EngineDeps } from "./engine";
import { executeExit, type ExitOutcome } from "./execution";
import { decideExit } from "./exits";
import type { Mandate } from "./mandate";
import type { MarketSnapshot } from "./market-data";
import { checkBreakers } from "./portfolio";
import { MAX_MARKET_AGE_MS } from "./risk-engine";
import { IN_FLIGHT } from "./states";
import { loadAgent, loadPortfolio, moveTrade } from "./store";

/**
 * The position monitor. It enforces stop loss, take profit, trailing stops,
 * break-even moves, partial exits and time limits, and trips the circuit
 * breakers. No model is involved: it keeps working through model and API
 * outages, and it holds no state in memory, so a restart loses nothing.
 */

const IN_FLIGHT_TIMEOUT_MS = 5 * 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const usd = (value: number) => `$${Math.abs(value).toFixed(2)}`;

const EXIT_HEADLINE: Record<ExitReason, string> = {
  stop_loss: "STOP LOSS",
  take_profit: "TAKE PROFIT",
  trailing_stop: "TRAILING STOP",
  partial_take_profit: "PARTIAL PROFIT",
  timeout: "TIME LIMIT",
  agent_close: "CLOSED",
  manual_close: "CLOSED BY YOU",
  close_all: "CLOSED BY YOU",
};

async function feeOrNull(deps: EngineDeps): Promise<number | null> {
  try {
    return await deps.networkFeeUsd();
  } catch {
    return null;
  }
}

function exitMessage(reason: ExitReason, outcome: Extract<ExitOutcome, { status: "filled" }>): string {
  const net = outcome.pnlUsd - outcome.feesUsd;
  return `${EXIT_HEADLINE[reason]} — ${outcome.symbol}\nSold ${usd(outcome.soldUsd)} at $${outcome.priceUsd.toPrecision(5)}\nResult ${net >= 0 ? "+" : "-"}${usd(net)} after fees${outcome.closed ? "" : "\nThe rest of the position stays open with its stop at the entry price."}`;
}

/** Closes trades and runs that a dead process left half-finished. Nothing is ever re-executed. */
export async function recoverInterrupted(now: number): Promise<void> {
  const stuck = await db
    .select()
    .from(tradeProposals)
    .where(and(inArray(tradeProposals.state, IN_FLIGHT), lt(tradeProposals.updatedAt, new Date(now - IN_FLIGHT_TIMEOUT_MS))))
    .limit(50);
  for (const proposal of stuck) {
    const ref = { id: proposal.id, automationId: proposal.automationId, userId: proposal.userId, runId: proposal.runId, state: proposal.state };
    const reason = "Interrupted before execution. Nothing was traded.";
    await moveTrade(db, ref, proposal.state === "EXECUTING" ? "FAILED" : "CANCELLED", { actor: "system", summary: `${proposal.assetSymbol}: ${reason}`, outcome: reason }).catch(() => {});
  }
  await db
    .update(tradingRuns)
    .set({ status: "failed", error: "The cycle was interrupted. Nothing further was traded.", finishedAt: new Date(now) })
    .where(and(eq(tradingRuns.status, "running"), lt(tradingRuns.createdAt, new Date(now - RUN_TIMEOUT_MS))));
}

/** Pauses new trading. Open positions keep their protective exits. */
export async function tripBreaker(automation: TradingAutomation, reason: string, deps: EngineDeps = defaultDeps): Promise<boolean> {
  const paused = await db
    .update(tradingAutomations)
    .set({ status: "paused", pausedBy: "breaker", pauseReason: reason, nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(tradingAutomations.id, automation.id), eq(tradingAutomations.status, "running")))
    .returning({ id: tradingAutomations.id });
  if (paused.length === 0) return false;
  await audit({ userId: automation.userId, automationId: automation.id, type: "agent.auto_paused", actor: "monitor", summary: `Paused automatically: ${reason}`, data: { reason } });
  await deps.notify(automation, `AUTO-PAUSED\n${reason}\nNo new positions will be opened. Open positions keep their stop loss and take profit. Resume from the dashboard when you are ready.`);
  return true;
}

async function watchPosition(position: Position, rules: Mandate, market: MarketSnapshot | undefined, now: number, deps: EngineDeps, automation: TradingAutomation | undefined) {
  // A missing or old price is not a price. The position keeps its last known one and the stale-data breaker takes over.
  if (!market || now - market.fetchedAt > MAX_MARKET_AGE_MS) return;
  const decision = decideExit(
    {
      entryPriceUsd: position.entryPriceUsd,
      stopLossPrice: position.stopLossPrice,
      initialStopLossPrice: position.initialStopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      highestPriceUsd: position.highestPriceUsd,
      breakEvenMoved: position.breakEvenMoved,
      partialTaken: position.partialTaken,
      expiresAt: position.expiresAt?.getTime() ?? null,
    },
    market.priceUsd,
    rules,
    now,
  );
  await db
    .update(positions)
    .set({
      lastPriceUsd: market.priceUsd,
      lastPriceAt: new Date(market.fetchedAt),
      highestPriceUsd: decision.highestPriceUsd,
      stopLossPrice: decision.stopLossPrice,
      breakEvenMoved: decision.breakEvenMoved,
    })
    .where(and(eq(positions.id, position.id), eq(positions.status, "open")));
  if (decision.stopLossPrice > position.stopLossPrice) {
    await audit({
      userId: position.userId,
      automationId: position.automationId,
      positionId: position.id,
      proposalId: position.proposalId,
      type: "position.stop_moved",
      actor: "monitor",
      summary: `${position.symbol} stop raised to $${decision.stopLossPrice.toPrecision(5)}`,
      data: { from: position.stopLossPrice, to: decision.stopLossPrice, priceUsd: market.priceUsd },
    });
  }
  if (!decision.exit) return;
  const outcome = await executeExit({ positionId: position.id, reason: decision.exit.reason, fraction: decision.exit.fraction, market, networkFeeUsd: await feeOrNull(deps), now });
  if (outcome.status === "filled" && automation) await deps.notify(automation, exitMessage(decision.exit.reason, outcome));
}

/** One pass over every open position and every running agent. Safe to run from several processes at once. */
export async function monitorTick(deps: EngineDeps = defaultDeps): Promise<{ positions: number; paused: number }> {
  const now = deps.now();
  await recoverInterrupted(now).catch((error) => console.error("[trading monitor] recovery", error instanceof Error ? error.message : error));

  const open = await db.select().from(positions).where(eq(positions.status, "open"));
  const agentIds = [...new Set(open.map((position) => position.automationId))];
  const agents = await db
    .select()
    .from(tradingAutomations)
    .where(agentIds.length ? or(eq(tradingAutomations.status, "running"), inArray(tradingAutomations.id, agentIds)) : eq(tradingAutomations.status, "running"));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  if (open.length > 0) {
    const mandateIds = [...new Set(open.map((position) => position.mandateId))];
    const mandates = new Map((await db.select().from(riskMandates).where(inArray(riskMandates.id, mandateIds))).map((row) => [row.id, row.mandate]));
    let snapshots = new Map<string, MarketSnapshot>();
    try {
      snapshots = await deps.snapshots([...new Set(open.map((position) => position.assetAddress))], { fresh: true });
    } catch {
      // No prices this tick. Positions keep their last price; the stale-data breaker fires if this goes on.
    }
    for (const position of open) {
      const rules = mandates.get(position.mandateId);
      if (!rules) continue;
      try {
        await watchPosition(position, rules, snapshots.get(position.assetAddress), now, deps, agentById.get(position.automationId));
      } catch (error) {
        console.error(`[trading monitor] position ${position.id}`, error instanceof Error ? error.message : error);
      }
    }
  }

  // ── Equity, drawdown and circuit breakers ─────────────────────────────────
  let paused = 0;
  for (const agent of agents) {
    try {
      const loaded = await loadAgent(agent.id);
      if (!loaded) continue;
      const portfolio = await loadPortfolio(db, loaded.automation, loaded.mandate, now);
      const stillOpen = await db
        .select({ lastPriceAt: positions.lastPriceAt })
        .from(positions)
        .where(and(eq(positions.automationId, agent.id), eq(positions.status, "open")));
      const [worst] = await db
        .select({ slippage: executions.slippagePercent })
        .from(executions)
        .where(and(eq(executions.automationId, agent.id), gte(executions.createdAt, new Date(now - 3_600_000))))
        .orderBy(desc(executions.slippagePercent))
        .limit(1);
      await db
        .update(tradingAutomations)
        .set({ peakEquityUsd: portfolio.peakEquityUsd, maxDrawdownPercent: Math.max(loaded.automation.maxDrawdownPercent, Number.isFinite(portfolio.drawdownPercent) ? portfolio.drawdownPercent : 0) })
        .where(eq(tradingAutomations.id, agent.id));
      if (loaded.automation.status !== "running") continue;
      const reason = checkBreakers(loaded.mandate, portfolio, {
        simulationFailures: loaded.automation.simulationFailures,
        dataFailures: loaded.automation.dataFailures,
        oldestPriceAgeMs: stillOpen.reduce((oldest, position) => Math.max(oldest, now - position.lastPriceAt.getTime()), 0),
        worstRecentSlippagePercent: worst?.slippage ?? 0,
      });
      if (reason && (await tripBreaker(loaded.automation, reason, deps))) paused++;
    } catch (error) {
      // If an agent's state cannot be read, it must not keep trading.
      console.error(`[trading monitor] agent ${agent.id}`, error instanceof Error ? error.message : error);
      if (agent.status === "running" && (await tripBreaker(agent, "The agent's state could not be verified", deps).catch(() => false))) paused++;
    }
  }
  return { positions: open.length, paused };
}

/** Closes one position at the market price. Used by the dashboard's Close buttons. */
export async function closePosition(positionId: string, reason: "manual_close" | "close_all", deps: EngineDeps = defaultDeps): Promise<ExitOutcome | { status: "no_price" }> {
  const [position] = await db.select().from(positions).where(and(eq(positions.id, positionId), eq(positions.status, "open")));
  if (!position) return { status: "skipped" };
  let market: MarketSnapshot | undefined;
  try {
    market = (await deps.snapshots([position.assetAddress], { fresh: true })).get(position.assetAddress);
  } catch {
    // Reported to the caller below.
  }
  // A manual close on an unknown price would record a made-up result, so it waits for a real one.
  if (!market) return { status: "no_price" };
  return executeExit({ positionId, reason, fraction: 1, market, networkFeeUsd: await feeOrNull(deps), now: deps.now() });
}

/** Starts a cycle for every running agent whose interval has passed. An agent is claimed by moving its next run time. */
export async function tradingTick(deps: EngineDeps = defaultDeps): Promise<{ started: number }> {
  const now = new Date(deps.now());
  const due = await db
    .select()
    .from(tradingAutomations)
    .where(and(eq(tradingAutomations.status, "running"), lte(tradingAutomations.nextRunAt, now)))
    .limit(25);
  let started = 0;
  for (const agent of due) {
    const claimed = await db
      .update(tradingAutomations)
      .set({ nextRunAt: new Date(now.getTime() + agent.intervalMinutes * 60_000) })
      .where(and(eq(tradingAutomations.id, agent.id), eq(tradingAutomations.status, "running"), lte(tradingAutomations.nextRunAt, now)))
      .returning({ id: tradingAutomations.id });
    if (claimed.length === 0) continue;
    void runTradingCycle(agent.id, "schedule", deps).catch((error) => console.error("[trading]", error instanceof Error ? error.message : error));
    started++;
  }
  return { started };
}

const globalForMonitor = globalThis as unknown as { __accredTradingMonitor?: NodeJS.Timeout };

/** The monitor runs on its own short timer, separate from the scheduler that starts cycles. */
export function startTradingMonitor(intervalMs = 20_000): void {
  if (globalForMonitor.__accredTradingMonitor) return;
  let busy = false;
  globalForMonitor.__accredTradingMonitor = setInterval(() => {
    if (busy) return;
    busy = true;
    monitorTick()
      .catch((error) => console.error("[trading monitor]", error instanceof Error ? error.message : error))
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  globalForMonitor.__accredTradingMonitor.unref();
}
