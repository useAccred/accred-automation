import { and, eq, gte, sql, sum } from "drizzle-orm";
import {
  db,
  executions,
  positions,
  riskMandates,
  tradeProposals,
  tradingAutomations,
  tradingRuns,
  tradingStrategies,
  tradingWallets,
  users,
  type RiskMandateRow,
  type TradingAutomation,
  type TradingStrategyRow,
  type TradingWallet,
  type User,
} from "../db";
import { audit, type AuditEntry, type Executor } from "./audit";
import { LIVE_TRADING_AVAILABLE } from "./live";
import type { Mandate } from "./mandate";
import { computePortfolio, type PortfolioState } from "./portfolio";
import type { RiskAgent } from "./risk-engine";
import { canTransition, type TradeState } from "./states";

/** Shared database access for the engine, the monitor and the server actions. */

export interface LoadedAgent {
  automation: TradingAutomation;
  mandateRow: RiskMandateRow;
  mandate: Mandate;
  strategy: TradingStrategyRow;
  wallet: TradingWallet;
  user: User;
}

export async function loadAgent(automationId: string, executor: Executor = db): Promise<LoadedAgent | null> {
  const [automation] = await executor.select().from(tradingAutomations).where(eq(tradingAutomations.id, automationId));
  if (!automation) return null;
  const [[mandateRow], [strategy], [wallet], [user]] = await Promise.all([
    executor
      .select()
      .from(riskMandates)
      .where(and(eq(riskMandates.automationId, automation.id), eq(riskMandates.version, automation.mandateVersion))),
    executor
      .select()
      .from(tradingStrategies)
      .where(and(eq(tradingStrategies.automationId, automation.id), eq(tradingStrategies.version, automation.strategyVersion))),
    executor.select().from(tradingWallets).where(eq(tradingWallets.id, automation.walletId)),
    executor.select().from(users).where(eq(users.id, automation.userId)),
  ]);
  // An agent whose mandate cannot be found has no limits to enforce, so it does not exist as far as trading goes.
  if (!mandateRow || !strategy || !wallet || !user) return null;
  return { automation, mandateRow, mandate: mandateRow.mandate, strategy, wallet, user };
}

export function riskAgent(automation: TradingAutomation, wallet: TradingWallet): RiskAgent {
  return {
    status: automation.status,
    mode: automation.mode,
    accessRevoked: automation.accessRevokedAt !== null,
    walletRevoked: wallet.tradingRevokedAt !== null,
    permissions: automation.permissions,
    liveEnabled: LIVE_TRADING_AVAILABLE,
  };
}

/** Cooldowns can be up to seven days long, so the portfolio reads eight days of fills. */
const FILL_WINDOW_MS = 8 * 86_400_000;

export async function loadPortfolio(executor: Executor, automation: TradingAutomation, mandate: Mandate, now: number): Promise<PortfolioState> {
  const [held, fills] = await Promise.all([
    executor
      .select({
        status: positions.status,
        assetAddress: positions.assetAddress,
        quantity: positions.quantity,
        entryPriceUsd: positions.entryPriceUsd,
        lastPriceUsd: positions.lastPriceUsd,
        realizedPnlUsd: positions.realizedPnlUsd,
        feesUsd: positions.feesUsd,
        closedAt: positions.closedAt,
      })
      .from(positions)
      .where(eq(positions.automationId, automation.id)),
    executor
      .select({
        side: executions.side,
        status: executions.status,
        createdAt: executions.createdAt,
        swapFeeUsd: executions.swapFeeUsd,
        networkFeeUsd: executions.networkFeeUsd,
        realizedPnlUsd: executions.realizedPnlUsd,
      })
      .from(executions)
      .where(and(eq(executions.automationId, automation.id), gte(executions.createdAt, new Date(now - FILL_WINDOW_MS)))),
  ]);
  return computePortfolio({
    mandate,
    timezone: automation.timezone,
    now,
    positions: held,
    fills,
    peakEquityUsd: automation.peakEquityUsd,
    streakResetAt: automation.breakerResetAt,
  });
}

/**
 * Serialises everything that changes one agent's positions. Held until the
 * transaction ends, so two fills can never both pass a limit that only one fits.
 */
export async function lockAgent(tx: Executor, automationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${automationId}, 4663))`);
}

export interface ProposalRef {
  id: string;
  automationId: string;
  userId: string;
  runId: string;
  state: TradeState;
}

/** Moves a trade to its next state and records the move. Refuses a move the state machine does not allow. */
export async function moveTrade(
  executor: Executor,
  proposal: ProposalRef,
  to: TradeState,
  event: Pick<AuditEntry, "actor" | "summary"> & { outcome?: string; data?: Record<string, unknown>; positionId?: string },
): Promise<void> {
  const from = proposal.state;
  if (!canTransition(from, to)) throw new Error(`A trade cannot move from ${from} to ${to}.`);
  const moved = await executor
    .update(tradeProposals)
    .set({ state: to, updatedAt: new Date(), ...(event.outcome !== undefined ? { outcome: event.outcome } : {}) })
    .where(and(eq(tradeProposals.id, proposal.id), eq(tradeProposals.state, from)))
    .returning({ id: tradeProposals.id });
  if (moved.length === 0) throw new Error("The trade was changed by another process.");
  proposal.state = to;
  await audit(
    {
      userId: proposal.userId,
      automationId: proposal.automationId,
      runId: proposal.runId,
      proposalId: proposal.id,
      positionId: event.positionId,
      type: "trade.transition",
      actor: event.actor,
      summary: event.summary,
      data: { from, to, ...event.data },
    },
    executor,
  );
}

export async function tradingCreditsThisMonth(automationId: string): Promise<bigint> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ total: sum(tradingRuns.creditsMicro) })
    .from(tradingRuns)
    .where(and(eq(tradingRuns.automationId, automationId), gte(tradingRuns.createdAt, monthStart)));
  return BigInt(row?.total ?? 0);
}
