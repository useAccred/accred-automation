import { and, eq, gte, lt, sql } from "drizzle-orm";
import { formatUnits, type Hex } from "viem";
import { db, executions, positions, riskEvaluations, riskMandates, tradeProposals, tradingAutomations, tradingWallets, type Execution, type ExitReason, type TradeProposal } from "../db";
import { env } from "../env";
import { audit } from "./audit";
import { USDG } from "./chain";
import { quoteRecord, type Fill, type LiveQuote, type LiveVenue } from "./live-venue";
import type { MarketSnapshot } from "./market-data";
import { paperExitFill, type PaperQuote } from "./quote";
import { evaluateRisk, localClock, rejectionSummary, type RiskInputs, type RiskResult, type RiskWallet } from "./risk-engine";
import { loadAgent, loadPortfolio, lockAgent, moveTrade, riskAgent, type ProposalRef } from "./store";

/**
 * The execution engine. It is the only code that opens or closes a position,
 * and it never takes instructions from a model: an entry is executed only if the
 * final risk check, run here on fresh state, passes all seventeen checks.
 *
 * Paper Mode fills are rows in the database; nothing is signed or sent.
 *
 * Live Mode fills are real swaps, in three steps so that no crash can lose
 * track of money:
 *   1. reserve: under the agent's lock, the final check runs and a "pending"
 *      fill is recorded. From this moment the capital counts as used.
 *   2. trade:   the venue simulates, signs and sends. The transaction hash is
 *      saved before the transaction is broadcast.
 *   3. settle:  the amounts are read from the receipt and the books updated.
 * A pending fill that is never settled is picked up by `settlePending`.
 */

export type EntryOutcome =
  | { status: "opened"; positionId: string; result: RiskResult | null; priceUsd: number; notionalUsd: number; stopLossPrice: number; takeProfitPrice: number | null; txHash: string | null }
  | { status: "rejected"; reason: string; result: RiskResult | null }
  | { status: "failed"; reason: string }
  /** A live swap was sent and has not confirmed yet. Recovery settles it. */
  | { status: "pending"; reason: string }
  | { status: "duplicate" };

export type ExitOutcome =
  | { status: "filled"; closed: boolean; symbol: string; priceUsd: number; soldUsd: number; pnlUsd: number; feesUsd: number; automationId: string; txHash: string | null }
  | { status: "failed"; reason: string }
  | { status: "skipped" };

class DuplicateExecution extends Error {}

const usd = (value: number) => `$${value.toFixed(2)}`;
/** Token prices keep significant digits: many trade at fractions of a cent. */
const price = (value: number) => `$${value >= 1 ? value.toFixed(4) : Number(value.toPrecision(5))}`;
const tokens = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));
const EXIT_ACTOR = { agent_close: "agent", manual_close: "user", close_all: "user" } as const;
const exitActor = (reason: ExitReason) => (reason in EXIT_ACTOR ? EXIT_ACTOR[reason as keyof typeof EXIT_ACTOR] : "monitor");

export function riskInputsSnapshot(inputs: RiskInputs): Record<string, unknown> {
  const quote = inputs.quote && "route" in inputs.quote ? quoteRecord(inputs.quote as LiveQuote) : inputs.quote;
  return { now: inputs.now, clock: inputs.clock, agent: inputs.agent, proposal: inputs.proposal, portfolio: inputs.portfolio, market: inputs.market, quote, wallet: inputs.wallet ?? null };
}

/** Puts a signed swap's hash and nonce on record before it is broadcast, so its fate can always be read from the chain. */
async function recordSigned(executionId: string, hash: Hex, nonce: number): Promise<void> {
  await db
    .update(executions)
    .set({ txHash: hash, quote: sql`coalesce(${executions.quote}, '{}'::jsonb) || ${JSON.stringify({ nonce })}::jsonb` })
    .where(eq(executions.id, executionId));
}

interface EntryPlan {
  executionId: string;
  walletId: string;
  result: RiskResult;
}

/**
 * The final pre-trade check and the fill. In Paper Mode both happen in one
 * transaction under the agent's lock. In Live Mode the same transaction
 * reserves the trade, and the swap and settlement follow.
 */
export async function executeEntry(input: {
  proposal: TradeProposal;
  market: MarketSnapshot | null;
  quote: PaperQuote | LiveQuote;
  now: number;
  /** Live Mode: the wallet's real balances, for the final check. */
  wallet?: RiskWallet | null;
  venue?: LiveVenue;
}): Promise<EntryOutcome> {
  const { proposal, market, quote, now } = input;
  let reserved: EntryOutcome | EntryPlan;
  try {
    reserved = await db.transaction(async (tx): Promise<EntryOutcome | EntryPlan> => {
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

      const live = agent.automation.mode === "live";
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
        wallet: live ? (input.wallet ?? null) : undefined,
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
      // The quote must be the kind this agent's mode trades on: a paper quote can never stand in for a live one, or the other way round.
      const rightKind = live ? "route" in quote && quote.kind === "live" : !("route" in quote);
      if (!result.approved || result.stopLossPercent === null || result.takeProfitPercent === null || !market || !rightKind) {
        const reason = rejectionSummary(result) || (rightKind ? "The final pre-trade check did not pass." : "The quote does not match the agent's mode.");
        await moveTrade(tx, ref, "RISK_REJECTED", {
          actor: "risk_engine",
          summary: `Rejected ${proposal.assetSymbol} at the final check: ${reason}`,
          outcome: reason,
          data: { passed: result.passed, total: result.total },
        });
        return { status: "rejected", reason, result };
      }

      await moveTrade(tx, ref, "EXECUTING", { actor: "execution", summary: `Executing ${proposal.assetSymbol} buy (${result.passed}/${result.total} checks passed)` });
      const lifetime = agent.mandate.maxPositionLifetimeHours;
      const common = {
        automationId: proposal.automationId,
        proposalId: proposal.id,
        idempotencyKey: `entry:${proposal.id}`,
        side: "buy" as const,
        reason: "entry" as const,
        assetAddress: proposal.assetAddress,
        symbol: proposal.assetSymbol,
        mandateId: agent.mandateRow.id,
        mandateVersion: agent.mandateRow.version,
        createdAt: new Date(now),
      };

      if (live) {
        // Three independent switches must all be on before a live trade is reserved.
        if (!env.liveTrading || !input.venue) throw new Error("Live trading is switched off on this server.");
        const liveQuote = quote as LiveQuote;
        const [execution] = await tx
          .insert(executions)
          .values({
            ...common,
            mode: "live",
            status: "pending",
            quantity: liveQuote.quantity,
            quantityRaw: liveQuote.simulatedOutRaw,
            priceUsd: liveQuote.priceUsd,
            // Reserved at the full requested size until the receipt says what was really spent.
            notionalUsd: proposal.requestedUsd,
            slippagePercent: liveQuote.slippagePercent,
            quote: {
              ...quoteRecord(liveQuote),
              stopLossPercent: result.stopLossPercent,
              takeProfitPercent: result.takeProfitPercent,
              marketPriceUsd: market.priceUsd,
              lifetimeHours: lifetime,
            },
          })
          .onConflictDoNothing({ target: executions.idempotencyKey })
          .returning({ id: executions.id });
        if (!execution) throw new DuplicateExecution();
        return { executionId: execution.id, walletId: agent.wallet.id, result };
      }

      const paper = quote as PaperQuote;
      const [execution] = await tx
        .insert(executions)
        .values({
          ...common,
          mode: "paper",
          status: "filled",
          quantity: paper.quantity,
          priceUsd: paper.priceUsd,
          notionalUsd: paper.notionalUsd,
          swapFeeUsd: paper.swapFeeUsd,
          networkFeeUsd: paper.networkFeeUsd,
          slippagePercent: paper.slippagePercent,
          quote: { ...paper },
        })
        .onConflictDoNothing({ target: executions.idempotencyKey })
        .returning({ id: executions.id });
      // The key is already taken: this entry has been executed before. Undo everything above.
      if (!execution) throw new DuplicateExecution();

      const stopLossPrice = paper.priceUsd * (1 - result.stopLossPercent / 100);
      const takeProfitPrice = paper.priceUsd * (1 + result.takeProfitPercent / 100);
      const [position] = await tx
        .insert(positions)
        .values({
          automationId: proposal.automationId,
          userId: proposal.userId,
          proposalId: proposal.id,
          mode: "paper",
          assetAddress: proposal.assetAddress,
          symbol: proposal.assetSymbol,
          quantity: paper.quantity,
          initialQuantity: paper.quantity,
          entryPriceUsd: paper.priceUsd,
          stopLossPrice,
          initialStopLossPrice: stopLossPrice,
          takeProfitPrice,
          highestPriceUsd: Math.max(paper.priceUsd, market.priceUsd),
          lastPriceUsd: market.priceUsd,
          lastPriceAt: new Date(market.fetchedAt),
          feesUsd: paper.swapFeeUsd + paper.networkFeeUsd,
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
        summary: `Bought ${usd(paper.notionalUsd)} of ${proposal.assetSymbol} at ${price(paper.priceUsd)} (paper)`,
        data: {
          executionId: execution.id,
          priceUsd: paper.priceUsd,
          quantity: paper.quantity,
          stopLossPrice,
          takeProfitPrice,
          feesUsd: paper.swapFeeUsd + paper.networkFeeUsd,
          slippagePercent: paper.slippagePercent,
          mandateVersion: agent.mandateRow.version,
          txHash: null,
        },
      });
      return { status: "opened", positionId: position!.id, result, priceUsd: paper.priceUsd, notionalUsd: paper.notionalUsd, stopLossPrice, takeProfitPrice, txHash: null };
    });
  } catch (error) {
    if (error instanceof DuplicateExecution) return { status: "duplicate" };
    throw error;
  }
  if (!("executionId" in reserved)) return reserved;

  // ── Live: trade on the chain, then settle from the receipt ──────────────────
  const plan = reserved;
  const fill = await input.venue!.execute({
    walletId: plan.walletId,
    quote: quote as LiveQuote,
    onSigned: (hash, nonce) => recordSigned(plan.executionId, hash, nonce),
  });
  const settled = await settleEntry(plan.executionId, fill, now);
  return settled.status === "opened" ? { ...settled, result: plan.result } : settled;
}

/** Records the outcome of a live entry. Safe to call again for the same fill: only a pending fill is ever settled. */
export async function settleEntry(executionId: string, fill: Fill, now: number): Promise<EntryOutcome> {
  return db.transaction(async (tx): Promise<EntryOutcome> => {
    const [found] = await tx.select({ automationId: executions.automationId }).from(executions).where(eq(executions.id, executionId));
    if (!found) return { status: "duplicate" };
    await lockAgent(tx, found.automationId);
    const [execution] = await tx.select().from(executions).where(eq(executions.id, executionId));
    if (!execution || execution.status !== "pending" || !execution.proposalId) return { status: "duplicate" };
    const [proposal] = await tx.select().from(tradeProposals).where(eq(tradeProposals.id, execution.proposalId));
    if (!proposal) return { status: "duplicate" };
    const ref: ProposalRef = { id: proposal.id, automationId: proposal.automationId, userId: proposal.userId, runId: proposal.runId, state: proposal.state };
    const plan = (execution.quote ?? {}) as { stopLossPercent?: number; takeProfitPercent?: number; marketPriceUsd?: number; lifetimeHours?: number; tokenDecimals?: number };

    if (!fill.ok) {
      if (fill.uncertain) {
        // Sent, fate unknown. The capital stays reserved and recovery looks the transaction up.
        await tx.update(executions).set({ error: fill.reason, ...(fill.txHash ? { txHash: fill.txHash } : {}), ...(fill.approveTxHash ? { approveTxHash: fill.approveTxHash } : {}) }).where(eq(executions.id, executionId));
        return { status: "pending", reason: fill.reason };
      }
      await tx
        .update(executions)
        .set({ status: "failed", error: fill.reason, networkFeeUsd: fill.gasUsd, quantity: 0, notionalUsd: 0, ...(fill.txHash ? { txHash: fill.txHash } : {}), ...(fill.approveTxHash ? { approveTxHash: fill.approveTxHash } : {}) })
        .where(eq(executions.id, executionId));
      await moveTrade(tx, ref, "FAILED", {
        actor: "execution",
        summary: `${proposal.assetSymbol} buy failed (${fill.stage}): ${fill.reason}`,
        outcome: fill.reason,
        data: { executionId, stage: fill.stage, txHash: fill.txHash ?? null, networkFeeUsd: fill.gasUsd },
      });
      return { status: "failed", reason: fill.reason };
    }

    const decimals = plan.tokenDecimals;
    const stopPercent = plan.stopLossPercent;
    if (decimals === undefined || stopPercent === undefined || !(stopPercent > 0)) throw new Error("The reserved trade has no plan to settle against.");
    // The books record what the receipt says moved: dollars out of the wallet, tokens into it.
    const spentUsd = tokens(fill.inRaw, USDG.decimals);
    const quantity = tokens(fill.outRaw, decimals);
    const entryPriceUsd = spentUsd / quantity;
    const mid = plan.marketPriceUsd ?? entryPriceUsd;
    const stopLossPrice = entryPriceUsd * (1 - stopPercent / 100);
    const takeProfitPrice = plan.takeProfitPercent ? entryPriceUsd * (1 + plan.takeProfitPercent / 100) : null;
    const lifetime = plan.lifetimeHours ?? 0;

    const [position] = await tx
      .insert(positions)
      .values({
        automationId: proposal.automationId,
        userId: proposal.userId,
        proposalId: proposal.id,
        mode: "live",
        assetAddress: proposal.assetAddress,
        symbol: proposal.assetSymbol,
        quantity,
        initialQuantity: quantity,
        quantityRaw: fill.outRaw.toString(),
        tokenDecimals: decimals,
        entryPriceUsd,
        stopLossPrice,
        initialStopLossPrice: stopLossPrice,
        takeProfitPrice,
        highestPriceUsd: Math.max(entryPriceUsd, mid),
        lastPriceUsd: mid,
        lastPriceAt: new Date(now),
        feesUsd: fill.gasUsd,
        mandateId: execution.mandateId,
        mandateVersion: execution.mandateVersion,
        openedAt: new Date(now),
        expiresAt: lifetime > 0 ? new Date(now + lifetime * 3_600_000) : null,
      })
      .returning({ id: positions.id });
    await tx
      .update(executions)
      .set({
        status: "filled",
        positionId: position!.id,
        quantity,
        quantityRaw: fill.outRaw.toString(),
        priceUsd: entryPriceUsd,
        notionalUsd: spentUsd,
        networkFeeUsd: fill.gasUsd,
        slippagePercent: Math.max(0, (entryPriceUsd / mid - 1) * 100),
        txHash: fill.txHash,
        approveTxHash: fill.approveTxHash ?? null,
        error: null,
      })
      .where(eq(executions.id, executionId));
    await moveTrade(tx, ref, "OPEN", {
      actor: "execution",
      positionId: position!.id,
      summary: `Bought ${usd(spentUsd)} of ${proposal.assetSymbol} at ${price(entryPriceUsd)} (live)`,
      data: { executionId, priceUsd: entryPriceUsd, quantity, quantityRaw: fill.outRaw.toString(), spentUsd, stopLossPrice, takeProfitPrice, networkFeeUsd: fill.gasUsd, mandateVersion: execution.mandateVersion, txHash: fill.txHash },
    });
    return { status: "opened", positionId: position!.id, result: null, priceUsd: entryPriceUsd, notionalUsd: spentUsd, stopLossPrice, takeProfitPrice, txHash: fill.txHash };
  });
}

/**
 * Sells part or all of a position. Safe to call twice for the same exit: the
 * second call finds the position already reduced, its key already used, or a
 * sale already on its way, and does nothing.
 */
export async function executeExit(input: {
  positionId: string;
  reason: ExitReason;
  /** Share of what is still held to sell. 1 closes the position. */
  fraction: number;
  market: MarketSnapshot;
  networkFeeUsd: number | null;
  now: number;
  venue?: LiveVenue;
}): Promise<ExitOutcome> {
  const [found] = await db.select({ mode: positions.mode }).from(positions).where(eq(positions.id, input.positionId));
  if (!found) return { status: "skipped" };
  return found.mode === "live" ? liveExit(input) : paperExit(input);
}

async function paperExit(input: { positionId: string; reason: ExitReason; fraction: number; market: MarketSnapshot; networkFeeUsd: number | null; now: number }): Promise<ExitOutcome> {
  const { positionId, reason, market, now } = input;
  return db.transaction(async (tx): Promise<ExitOutcome> => {
    const [found] = await tx.select({ automationId: positions.automationId }).from(positions).where(eq(positions.id, positionId));
    if (!found) return { status: "skipped" };
    await lockAgent(tx, found.automationId);
    const [position] = await tx.select().from(positions).where(eq(positions.id, positionId));
    if (!position || position.status !== "open" || position.mode !== "paper" || !(position.quantity > 0)) return { status: "skipped" };

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
    await recordExit(tx, position, { executionId: execution.id, reason, closed, priceUsd: fill.priceUsd, quantity, pnlUsd, feesUsd, slippagePercent: fill.slippagePercent, txHash: null });
    return { status: "filled", closed, symbol: position.symbol, priceUsd: fill.priceUsd, soldUsd: fill.notionalUsd, pnlUsd, feesUsd, automationId: position.automationId, txHash: null };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Moves the trade's state and writes the audit entries for a sale that has been recorded. */
async function recordExit(
  tx: Tx,
  position: typeof positions.$inferSelect,
  exit: { executionId: string; reason: ExitReason; closed: boolean; priceUsd: number; quantity: number; pnlUsd: number; feesUsd: number; slippagePercent: number; txHash: string | null },
): Promise<void> {
  const [proposal] = await tx.select().from(tradeProposals).where(eq(tradeProposals.id, position.proposalId));
  const label = exit.reason.replace(/_/g, " ");
  await moveTrade(
    tx,
    { id: proposal!.id, automationId: proposal!.automationId, userId: proposal!.userId, runId: proposal!.runId, state: proposal!.state },
    exit.closed ? "CLOSED" : "PARTIAL_EXIT",
    {
      actor: exitActor(exit.reason),
      positionId: position.id,
      summary: `${exit.closed ? "Closed" : "Partly closed"} ${position.symbol} at ${price(exit.priceUsd)} (${label}): ${exit.pnlUsd >= 0 ? "+" : "-"}${usd(Math.abs(exit.pnlUsd))} before fees`,
      data: { executionId: exit.executionId, reason: exit.reason, priceUsd: exit.priceUsd, quantity: exit.quantity, pnlUsd: exit.pnlUsd, feesUsd: exit.feesUsd, slippagePercent: exit.slippagePercent, txHash: exit.txHash },
    },
  );
  if (!exit.closed) return;
  const net = position.realizedPnlUsd + exit.pnlUsd - position.feesUsd - exit.feesUsd;
  await audit(
    {
      userId: position.userId,
      automationId: position.automationId,
      positionId: position.id,
      proposalId: position.proposalId,
      type: "position.closed",
      actor: "execution",
      summary: `${position.symbol} position closed: net ${net >= 0 ? "+" : "-"}${usd(Math.abs(net))} after fees`,
      data: { realizedPnlUsd: position.realizedPnlUsd + exit.pnlUsd, feesUsd: position.feesUsd + exit.feesUsd, closeReason: exit.reason },
    },
    tx,
  );
}

/** A protective exit must get out. Each failed attempt in the last hour doubles the slippage it will accept, up to this. */
const MAX_EXIT_SLIPPAGE_PERCENT = 25;
const MIN_EXIT_SLIPPAGE_PERCENT = 2;

async function liveExit(input: { positionId: string; reason: ExitReason; fraction: number; market: MarketSnapshot; now: number; venue?: LiveVenue }): Promise<ExitOutcome> {
  const { positionId, reason, market, now, venue } = input;
  if (!venue) return { status: "failed", reason: "No live venue is available to sell through." };

  // ── Reserve ─────────────────────────────────────────────────────────────────
  const plan = await db.transaction(async (tx) => {
    const [found] = await tx.select({ automationId: positions.automationId }).from(positions).where(eq(positions.id, positionId));
    if (!found) return null;
    await lockAgent(tx, found.automationId);
    const [position] = await tx.select().from(positions).where(eq(positions.id, positionId));
    if (!position || position.status !== "open" || position.mode !== "live" || !position.quantityRaw || position.tokenDecimals === null) return null;
    const sales = await tx
      .select({ status: executions.status, createdAt: executions.createdAt })
      .from(executions)
      .where(and(eq(executions.positionId, positionId), eq(executions.side, "sell")));
    // A sale already on its way must finish before another is tried.
    if (sales.some((sale) => sale.status === "pending")) return null;
    const held = BigInt(position.quantityRaw);
    const full = input.fraction >= 1;
    const sellRaw = full ? held : (held * BigInt(Math.round(Math.max(0, Math.min(1, input.fraction)) * 1_000_000))) / 1_000_000n;
    if (sellRaw <= 0n) return null;

    const [automation] = await tx.select({ walletId: tradingAutomations.walletId }).from(tradingAutomations).where(eq(tradingAutomations.id, position.automationId));
    const [wallet] = automation ? await tx.select().from(tradingWallets).where(eq(tradingWallets.id, automation.walletId)) : [];
    const [mandateRow] = await tx.select().from(riskMandates).where(eq(riskMandates.id, position.mandateId));
    if (!wallet || !mandateRow) return null;
    const recentFailures = sales.filter((sale) => sale.status === "failed" && sale.createdAt.getTime() > now - 3_600_000).length;
    const slippagePercent = Math.min(MAX_EXIT_SLIPPAGE_PERCENT, Math.max(mandateRow.mandate.maxSlippagePercent, MIN_EXIT_SLIPPAGE_PERCENT) * 2 ** recentFailures);
    const quantity = tokens(sellRaw, position.tokenDecimals);
    const [execution] = await tx
      .insert(executions)
      .values({
        automationId: position.automationId,
        proposalId: position.proposalId,
        positionId,
        idempotencyKey: `exit:${positionId}:${sales.length}`,
        mode: "live",
        side: "sell",
        reason,
        status: "pending",
        assetAddress: position.assetAddress,
        symbol: position.symbol,
        quantity,
        quantityRaw: sellRaw.toString(),
        priceUsd: market.priceUsd,
        notionalUsd: quantity * market.priceUsd,
        quote: { full, slippageLimitPercent: slippagePercent, marketPriceUsd: market.priceUsd },
        mandateId: position.mandateId,
        mandateVersion: position.mandateVersion,
        createdAt: new Date(now),
      })
      .onConflictDoNothing({ target: executions.idempotencyKey })
      .returning({ id: executions.id });
    if (!execution) return null;
    return { executionId: execution.id, walletId: wallet.id, walletAddress: wallet.address, token: position.assetAddress, sellRaw, slippagePercent };
  });
  if (!plan) return { status: "skipped" };

  // ── Trade ───────────────────────────────────────────────────────────────────
  const quote = await venue.quote({ side: "sell", wallet: plan.walletAddress, token: plan.token, amountInRaw: plan.sellRaw, slippagePercent: plan.slippagePercent, market, now });
  const fill: Fill = quote.simulation.ok
    ? await venue.execute({
        walletId: plan.walletId,
        quote,
        onSigned: (hash, nonce) => recordSigned(plan.executionId, hash, nonce),
      })
    : { ok: false, stage: "simulate", reason: quote.simulation.detail, gasUsd: 0, uncertain: false };

  return settleExit(plan.executionId, fill, now);
}

/** Records the outcome of a live sale. Only a pending sale is ever settled. */
export async function settleExit(executionId: string, fill: Fill, now: number): Promise<ExitOutcome> {
  return db.transaction(async (tx): Promise<ExitOutcome> => {
    const [found] = await tx.select({ automationId: executions.automationId }).from(executions).where(eq(executions.id, executionId));
    if (!found) return { status: "skipped" };
    await lockAgent(tx, found.automationId);
    const [execution] = await tx.select().from(executions).where(eq(executions.id, executionId));
    if (!execution || execution.status !== "pending" || !execution.positionId) return { status: "skipped" };
    const [position] = await tx.select().from(positions).where(eq(positions.id, execution.positionId));
    if (!position || !position.quantityRaw || position.tokenDecimals === null) return { status: "skipped" };
    const reason = execution.reason as ExitReason;

    if (!fill.ok) {
      if (fill.uncertain) {
        await tx.update(executions).set({ error: fill.reason, ...(fill.txHash ? { txHash: fill.txHash } : {}) }).where(eq(executions.id, executionId));
        return { status: "skipped" };
      }
      await tx
        .update(executions)
        .set({ status: "failed", error: fill.reason, networkFeeUsd: fill.gasUsd, quantity: 0, notionalUsd: 0, ...(fill.txHash ? { txHash: fill.txHash } : {}), ...(fill.approveTxHash ? { approveTxHash: fill.approveTxHash } : {}) })
        .where(eq(executions.id, executionId));
      // Gas spent on a sale that did not go through is still a cost of this position.
      if (fill.gasUsd > 0) await tx.update(positions).set({ feesUsd: position.feesUsd + fill.gasUsd }).where(eq(positions.id, position.id));
      await tx.update(tradingAutomations).set({ simulationFailures: sql`${tradingAutomations.simulationFailures} + 1` }).where(eq(tradingAutomations.id, position.automationId));
      await audit(
        {
          userId: position.userId,
          automationId: position.automationId,
          positionId: position.id,
          proposalId: position.proposalId,
          type: "position.exit_failed",
          actor: "execution",
          summary: `${position.symbol} sale failed (${reason.replace(/_/g, " ")}, ${fill.stage}): ${fill.reason}. The position stays open and the sale will be retried.`,
          data: { executionId, stage: fill.stage, txHash: fill.txHash ?? null, networkFeeUsd: fill.gasUsd },
        },
        tx,
      );
      return { status: "failed", reason: fill.reason };
    }

    const held = BigInt(position.quantityRaw);
    const soldRaw = fill.inRaw > held ? held : fill.inRaw;
    const quantity = tokens(soldRaw, position.tokenDecimals);
    const proceedsUsd = tokens(fill.outRaw, USDG.decimals);
    const priceUsd = proceedsUsd / quantity;
    // Dollars received, less what those tokens cost. Both sides come from receipts.
    const pnlUsd = proceedsUsd - position.entryPriceUsd * quantity;
    const remainingRaw = held - soldRaw;
    const remaining = tokens(remainingRaw, position.tokenDecimals);
    const asked = (execution.quote ?? {}) as { full?: boolean; marketPriceUsd?: number };
    const closed = asked.full === true || remainingRaw === 0n || remaining * position.entryPriceUsd < 0.01;
    const mid = asked.marketPriceUsd ?? priceUsd;

    await tx
      .update(executions)
      .set({
        status: "filled",
        quantity,
        quantityRaw: soldRaw.toString(),
        priceUsd,
        notionalUsd: proceedsUsd,
        networkFeeUsd: fill.gasUsd,
        slippagePercent: Math.max(0, (1 - priceUsd / mid) * 100),
        realizedPnlUsd: pnlUsd,
        txHash: fill.txHash,
        approveTxHash: fill.approveTxHash ?? null,
        error: null,
      })
      .where(eq(executions.id, executionId));
    await tx
      .update(positions)
      .set({
        quantity: closed ? 0 : remaining,
        quantityRaw: closed ? "0" : remainingRaw.toString(),
        realizedPnlUsd: position.realizedPnlUsd + pnlUsd,
        feesUsd: position.feesUsd + fill.gasUsd,
        lastPriceUsd: priceUsd,
        lastPriceAt: new Date(now),
        ...(closed ? { status: "closed" as const, closedAt: new Date(now), closeReason: reason } : { partialTaken: true }),
      })
      .where(eq(positions.id, position.id));
    await recordExit(tx, position, { executionId, reason, closed, priceUsd, quantity, pnlUsd, feesUsd: fill.gasUsd, slippagePercent: Math.max(0, (1 - priceUsd / mid) * 100), txHash: fill.txHash });
    return { status: "filled", closed, symbol: position.symbol, priceUsd, soldUsd: proceedsUsd, pnlUsd, feesUsd: fill.gasUsd, automationId: position.automationId, txHash: fill.txHash };
  });
}

const SETTLE_AFTER_MS = 3 * 60_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;

/**
 * Settles live fills that were left pending: by a crash, a restart, or a
 * transaction that took too long to confirm. The chain is the source of truth.
 * A fill that was signed is looked up by its hash; one that was never signed
 * was never sent.
 */
export async function settlePending(now: number, venue: LiveVenue): Promise<number> {
  const stuck = await db
    .select()
    .from(executions)
    .where(and(eq(executions.status, "pending"), lt(executions.createdAt, new Date(now - SETTLE_AFTER_MS)), gte(executions.createdAt, new Date(now - 30 * 86_400_000))))
    .limit(25);
  let settled = 0;
  for (const execution of stuck) {
    try {
      const fill = await lookUp(execution, now, venue);
      if (!fill) continue;
      const outcome = execution.side === "buy" ? await settleEntry(execution.id, fill, now) : await settleExit(execution.id, fill, now);
      if (outcome.status !== "pending" && outcome.status !== "skipped") settled++;
    } catch (error) {
      console.error(`[trading] could not settle fill ${execution.id}`, error instanceof Error ? error.message : error);
    }
  }
  return settled;
}

async function lookUp(execution: Execution, now: number, venue: LiveVenue): Promise<Fill | null> {
  const never = (reason: string): Fill => ({ ok: false, stage: "send", reason, gasUsd: 0, uncertain: false });
  if (!execution.txHash) return never("The swap was never signed or sent. No funds moved.");
  const [wallet] = await db
    .select({ address: tradingWallets.address })
    .from(tradingAutomations)
    .innerJoin(tradingWallets, eq(tradingWallets.id, tradingAutomations.walletId))
    .where(eq(tradingAutomations.id, execution.automationId));
  if (!wallet) return null;
  const buy = execution.side === "buy";
  const fill = await venue.inspect({
    txHash: execution.txHash as Hex,
    wallet: wallet.address,
    tokenIn: buy ? USDG.address : execution.assetAddress,
    tokenOut: buy ? execution.assetAddress : USDG.address,
  });
  if (fill) {
    // A receipt exists, so the outcome is known one way or the other.
    return fill.ok ? fill : { ...fill, uncertain: false };
  }
  // The chain has no record of it yet. Give it time.
  if (now - execution.createdAt.getTime() <= GIVE_UP_AFTER_MS) return null;

  // Still nothing. Whether it can still land depends on its nonce: once the wallet has confirmed
  // that nonce or a later one without this transaction, this transaction can never be included.
  const nonce = (execution.quote as { nonce?: unknown } | null)?.nonce;
  const used = typeof nonce === "number" ? await venue.nonceUsed(wallet.address, nonce) : null;
  if (used === true) {
    const again = await venue.inspect({ txHash: execution.txHash as Hex, wallet: wallet.address, tokenIn: buy ? USDG.address : execution.assetAddress, tokenOut: buy ? execution.assetAddress : USDG.address });
    if (again) return again.ok ? again : { ...again, uncertain: false };
    return never("The swap never appeared on the chain and its place was taken by a later transaction. No funds moved.");
  }
  if (!buy) {
    // A protective exit must not stay blocked. The sale is written off so it can be retried; the retry takes the
    // same place on the chain, so at most one of the two can ever land.
    return never("The sale was not confirmed after 15 minutes. It has been written off so the exit can be retried.");
  }
  // A buy whose place on the chain is still open could, in principle, still land. Its capital stays reserved,
  // and new trading pauses until a person has looked or a later transaction settles the question.
  if (execution.error !== UNCONFIRMED) {
    await db.update(executions).set({ error: UNCONFIRMED }).where(eq(executions.id, execution.id));
    const [agent] = await db
      .update(tradingAutomations)
      .set({ status: "paused", pausedBy: "breaker", pauseReason: UNCONFIRMED, nextRunAt: null, updatedAt: new Date() })
      .where(and(eq(tradingAutomations.id, execution.automationId), eq(tradingAutomations.status, "running")))
      .returning({ userId: tradingAutomations.userId });
    const [owner] = agent ? [agent] : await db.select({ userId: tradingAutomations.userId }).from(tradingAutomations).where(eq(tradingAutomations.id, execution.automationId));
    if (owner) {
      await audit({
        userId: owner.userId,
        automationId: execution.automationId,
        proposalId: execution.proposalId ?? undefined,
        type: "execution.unconfirmed",
        actor: "monitor",
        summary: `${UNCONFIRMED} Transaction ${execution.txHash}.`,
        data: { executionId: execution.id, txHash: execution.txHash, nonce: typeof nonce === "number" ? nonce : null },
      });
    }
  }
  return null;
}

const UNCONFIRMED = "A buy was sent but has not been confirmed or ruled out after 15 minutes. Its capital stays reserved and new trading is paused until it is settled.";
