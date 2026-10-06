import { and, eq, sql } from "drizzle-orm";
import { db, executions, positions, riskEvaluations, tradeProposals, type ExitReason, type TradeProposal } from "../db";
import { audit } from "./audit";
import type { MarketSnapshot } from "./market-data";
import { paperExitFill, type PaperQuote } from "./quote";
import { evaluateRisk, localClock, rejectionSummary, type RiskInputs, type RiskResult } from "./risk-engine";
import { loadAgent, loadPortfolio, lockAgent, moveTrade, riskAgent, type ProposalRef } from "./store";

/**
 * The execution engine. It is the only code that opens or closes a position,
 * and it never takes instructions from a model: an entry is executed only if the
 * final risk check, run here on fresh state, passes all seventeen checks.
 *
 * Paper Mode fills are rows in the database. Nothing is signed or sent.
 */

export type EntryOutcome =
  | { status: "opened"; positionId: string; result: RiskResult; quote: PaperQuote }
  | { status: "rejected"; reason: string; result: RiskResult | null }
  | { status: "duplicate" };

class DuplicateExecution extends Error {}

const usd = (value: number) => `$${value.toFixed(2)}`;
/** Token prices keep significant digits: many trade at fractions of a cent. */
const price = (value: number) => `$${value >= 1 ? value.toFixed(4) : Number(value.toPrecision(5))}`;

export function riskInputsSnapshot(inputs: RiskInputs): Record<string, unknown> {
  return { now: inputs.now, clock: inputs.clock, agent: inputs.agent, proposal: inputs.proposal, portfolio: inputs.portfolio, market: inputs.market, quote: inputs.quote };
}

/**
 * The final pre-trade check and the fill, as one transaction under the agent's
 * lock. Either the trade passes every check against the state it will actually
 * change and a position is recorded, or nothing is.
 */
export async function executeEntry(input: { proposal: TradeProposal; market: MarketSnapshot | null; quote: PaperQuote; now: number }): Promise<EntryOutcome> {
  const { proposal, market, quote, now } = input;
  try {
    return await db.transaction(async (tx) => {
      await lockAgent(tx, proposal.automationId);
      // Read the trade's state under the lock. If it has already moved on, this is a repeat of an entry that was handled.
      const [current] = await tx.select({ state: tradeProposals.state }).from(tradeProposals).where(eq(tradeProposals.id, proposal.id));
      if (!current || current.state !== "SIMULATED") return { status: "duplicate" };
      const agent = await loadAgent(proposal.automationId, tx);
      const ref: ProposalRef = { id: proposal.id, automationId: proposal.automationId, userId: proposal.userId, runId: proposal.runId, state: current.state };
      if (!agent) throw new Error("The agent no longer exists.");

      // A trade is only ever executed under the mandate version that approved it.
      if (agent.mandateRow.id !== proposal.mandateId) {
        const reason = "The mandate changed while this trade was being checked.";
        await moveTrade(tx, ref, "RISK_REJECTED", { actor: "risk_engine", summary: `Rejected ${proposal.assetSymbol}: ${reason}`, outcome: reason });
        return { status: "rejected", reason, result: null };
      }

      const inputs: RiskInputs = {
        now,
        clock: localClock(now, agent.automation.timezone),
        mandate: agent.mandate,
        agent: riskAgent(agent.automation, agent.wallet),
        proposal: {
          action: "BUY",
          assetAddress: proposal.assetAddress,
          symbol: proposal.assetSymbol,
          requestedUsd: proposal.requestedUsd,
          stopLossPercent: proposal.stopLossPercent,
          takeProfitPercent: proposal.takeProfitPercent,
        },
        portfolio: await loadPortfolio(tx, agent.automation, agent.mandate, now),
        market,
        quote,
      };
      const result = evaluateRisk(inputs, "final");
      await tx.insert(riskEvaluations).values({
        proposalId: proposal.id,
        automationId: proposal.automationId,
        stage: "final",
        approved: result.approved,
        passed: result.passed,
        total: result.total,
        checks: result.checks,
        inputs: riskInputsSnapshot(inputs),
        mandateId: agent.mandateRow.id,
        mandateVersion: agent.mandateRow.version,
      });
      if (!result.approved || result.stopLossPercent === null || result.takeProfitPercent === null || !market) {
        const reason = rejectionSummary(result) || "The final pre-trade check did not pass.";
        await moveTrade(tx, ref, "RISK_REJECTED", {
          actor: "risk_engine",
          summary: `Rejected ${proposal.assetSymbol} at the final check: ${reason}`,
          outcome: reason,
          data: { passed: result.passed, total: result.total },
        });
        return { status: "rejected", reason, result };
      }
      if (agent.automation.mode !== "paper") throw new Error("Live execution is not available on this server.");

      await moveTrade(tx, ref, "EXECUTING", { actor: "execution", summary: `Executing ${proposal.assetSymbol} buy (${result.passed}/${result.total} checks passed)` });
      const [execution] = await tx
        .insert(executions)
        .values({
          automationId: proposal.automationId,
          proposalId: proposal.id,
          idempotencyKey: `entry:${proposal.id}`,
          mode: "paper",
          side: "buy",
          reason: "entry",
          status: "filled",
          assetAddress: proposal.assetAddress,
          symbol: proposal.assetSymbol,
          quantity: quote.quantity,
          priceUsd: quote.priceUsd,
          notionalUsd: quote.notionalUsd,
          swapFeeUsd: quote.swapFeeUsd,
          networkFeeUsd: quote.networkFeeUsd,
          slippagePercent: quote.slippagePercent,
          quote: { ...quote },
          mandateId: agent.mandateRow.id,
          mandateVersion: agent.mandateRow.version,
          createdAt: new Date(now),
        })
        .onConflictDoNothing({ target: executions.idempotencyKey })
        .returning({ id: executions.id });
      // The key is already taken: this entry has been executed before. Undo everything above.
      if (!execution) throw new DuplicateExecution();

      const lifetime = agent.mandate.maxPositionLifetimeHours;
      const stopLossPrice = quote.priceUsd * (1 - result.stopLossPercent / 100);
      const [position] = await tx
        .insert(positions)
        .values({
          automationId: proposal.automationId,
          userId: proposal.userId,
          proposalId: proposal.id,
          mode: "paper",
          assetAddress: proposal.assetAddress,
          symbol: proposal.assetSymbol,
          quantity: quote.quantity,
          initialQuantity: quote.quantity,
          entryPriceUsd: quote.priceUsd,
          stopLossPrice,
          initialStopLossPrice: stopLossPrice,
          takeProfitPrice: quote.priceUsd * (1 + result.takeProfitPercent / 100),
          highestPriceUsd: Math.max(quote.priceUsd, market.priceUsd),
          lastPriceUsd: market.priceUsd,
          lastPriceAt: new Date(market.fetchedAt),
          feesUsd: quote.swapFeeUsd + quote.networkFeeUsd,
          mandateId: agent.mandateRow.id,
          mandateVersion: agent.mandateRow.version,
          openedAt: new Date(now),
          expiresAt: lifetime > 0 ? new Date(now + lifetime * 3_600_000) : null,
        })
        .returning({ id: positions.id });
      await tx.update(executions).set({ positionId: position!.id }).where(eq(executions.id, execution.id));
      await moveTrade(tx, ref, "OPEN", {
        actor: "execution",
        positionId: position!.id,
        summary: `Bought ${usd(quote.notionalUsd)} of ${proposal.assetSymbol} at ${price(quote.priceUsd)} (paper)`,
        data: {
          executionId: execution.id,
          priceUsd: quote.priceUsd,
          quantity: quote.quantity,
          stopLossPrice,
          takeProfitPrice: quote.priceUsd * (1 + result.takeProfitPercent / 100),
          feesUsd: quote.swapFeeUsd + quote.networkFeeUsd,
          slippagePercent: quote.slippagePercent,
          mandateVersion: agent.mandateRow.version,
          txHash: null,
        },
      });
      return { status: "opened", positionId: position!.id, result, quote };
    });
  } catch (error) {
    if (error instanceof DuplicateExecution) return { status: "duplicate" };
    throw error;
  }
}

export type ExitOutcome =
  | { status: "filled"; closed: boolean; symbol: string; priceUsd: number; soldUsd: number; pnlUsd: number; feesUsd: number; automationId: string }
  | { status: "skipped" };

const EXIT_ACTOR = { agent_close: "agent", manual_close: "user", close_all: "user" } as const;

/**
 * Sells part or all of a position. Safe to call twice for the same exit: the
 * second call finds the position already reduced, or its key already used, and
 * does nothing.
 */
export async function executeExit(input: {
  positionId: string;
  reason: ExitReason;
  /** Share of what is still held to sell. 1 closes the position. */
  fraction: number;
  market: MarketSnapshot;
  networkFeeUsd: number | null;
  now: number;
}): Promise<ExitOutcome> {
  const { positionId, reason, market, now } = input;
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ automationId: positions.automationId }).from(positions).where(eq(positions.id, positionId));
    if (!found) return { status: "skipped" };
    await lockAgent(tx, found.automationId);
    const [position] = await tx.select().from(positions).where(eq(positions.id, positionId));
    if (!position || position.status !== "open" || !(position.quantity > 0)) return { status: "skipped" };

    const full = input.fraction >= 1;
    const quantity = full ? position.quantity : position.quantity * Math.max(0, input.fraction);
    if (!(quantity > 0)) return { status: "skipped" };
    const fill = paperExitFill(market, quantity, input.networkFeeUsd, now);
    // An exit is never recorded at a price that is not a real number.
    if (!Number.isFinite(fill.priceUsd) || fill.priceUsd <= 0) return { status: "skipped" };

    const [{ sells } = { sells: 0 }] = await tx
      .select({ sells: sql<number>`count(*)::int` })
      .from(executions)
      .where(and(eq(executions.positionId, positionId), eq(executions.side, "sell")));
    const pnlUsd = (fill.priceUsd - position.entryPriceUsd) * quantity;
    const feesUsd = fill.swapFeeUsd + fill.networkFeeUsd;
    const [execution] = await tx
      .insert(executions)
      .values({
        automationId: position.automationId,
        proposalId: position.proposalId,
        positionId,
        idempotencyKey: `exit:${positionId}:${sells}`,
        mode: "paper",
        side: "sell",
        reason,
        status: "filled",
        assetAddress: position.assetAddress,
        symbol: position.symbol,
        quantity,
        priceUsd: fill.priceUsd,
        notionalUsd: fill.notionalUsd,
        swapFeeUsd: fill.swapFeeUsd,
        networkFeeUsd: fill.networkFeeUsd,
        slippagePercent: fill.slippagePercent,
        realizedPnlUsd: pnlUsd,
        quote: { ...fill },
        mandateId: position.mandateId,
        mandateVersion: position.mandateVersion,
        createdAt: new Date(now),
      })
      .onConflictDoNothing({ target: executions.idempotencyKey })
      .returning({ id: executions.id });
    if (!execution) return { status: "skipped" };

    const remaining = position.quantity - quantity;
    // What is left after a partial exit may be too small to matter; close it out rather than keep dust.
    const closed = full || remaining * position.entryPriceUsd < 0.01;
    await tx
      .update(positions)
      .set({
        quantity: closed ? 0 : remaining,
        realizedPnlUsd: position.realizedPnlUsd + pnlUsd,
        feesUsd: position.feesUsd + feesUsd,
        lastPriceUsd: market.priceUsd,
        lastPriceAt: new Date(market.fetchedAt),
        ...(closed ? { status: "closed" as const, closedAt: new Date(now), closeReason: reason } : { partialTaken: true }),
      })
      .where(eq(positions.id, positionId));

    const [proposal] = await tx.select().from(tradeProposals).where(eq(tradeProposals.id, position.proposalId));
    const label = reason.replace(/_/g, " ");
    await moveTrade(
      tx,
      { id: proposal!.id, automationId: proposal!.automationId, userId: proposal!.userId, runId: proposal!.runId, state: proposal!.state },
      closed ? "CLOSED" : "PARTIAL_EXIT",
      {
        actor: reason in EXIT_ACTOR ? EXIT_ACTOR[reason as keyof typeof EXIT_ACTOR] : "monitor",
        positionId,
        summary: `${closed ? "Closed" : "Partly closed"} ${position.symbol} at ${price(fill.priceUsd)} (${label}): ${pnlUsd >= 0 ? "+" : "-"}${usd(Math.abs(pnlUsd))} before fees`,
        data: { executionId: execution.id, reason, priceUsd: fill.priceUsd, quantity, pnlUsd, feesUsd, slippagePercent: fill.slippagePercent, txHash: null },
      },
    );
    if (closed) {
      await audit(
        {
          userId: position.userId,
          automationId: position.automationId,
          positionId,
          proposalId: position.proposalId,
          type: "position.closed",
          actor: "execution",
          summary: `${position.symbol} position closed: net ${position.realizedPnlUsd + pnlUsd - position.feesUsd - feesUsd >= 0 ? "+" : "-"}${usd(Math.abs(position.realizedPnlUsd + pnlUsd - position.feesUsd - feesUsd))} after fees`,
          data: { realizedPnlUsd: position.realizedPnlUsd + pnlUsd, feesUsd: position.feesUsd + feesUsd, closeReason: reason },
        },
        tx,
      );
    }
    return { status: "filled", closed, symbol: position.symbol, priceUsd: fill.priceUsd, soldUsd: fill.notionalUsd, pnlUsd, feesUsd, automationId: position.automationId };
  });
}
