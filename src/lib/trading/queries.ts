import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, db, executions, positions, riskEvaluations, riskMandates, tradeProposals, tradingAutomations, tradingRuns, tradingWallets, type RiskEvaluation } from "../db";
import { tradeStats, type PaperStats, type PortfolioState } from "./portfolio";
import { loadAgent, loadPortfolio, type LoadedAgent } from "./store";

/** Reads for the trading pages. */

export async function getTradingAgent(userId: string, id: string): Promise<LoadedAgent | undefined> {
  if (!z.uuid().safeParse(id).success) return undefined;
  const agent = await loadAgent(id);
  return agent && agent.automation.userId === userId ? agent : undefined;
}

export async function listWallets(userId: string) {
  return db
    .select({
      id: tradingWallets.id,
      name: tradingWallets.name,
      address: tradingWallets.address,
      source: tradingWallets.source,
      tradingRevokedAt: tradingWallets.tradingRevokedAt,
      createdAt: tradingWallets.createdAt,
    })
    .from(tradingWallets)
    .where(eq(tradingWallets.userId, userId))
    .orderBy(tradingWallets.createdAt);
}

export async function listTradingAgents(userId: string): Promise<Array<LoadedAgent & { portfolio: PortfolioState }>> {
  const rows = await db.select({ id: tradingAutomations.id }).from(tradingAutomations).where(eq(tradingAutomations.userId, userId)).orderBy(desc(tradingAutomations.createdAt));
  const now = Date.now();
  const agents = await Promise.all(
    rows.map(async (row) => {
      const agent = await loadAgent(row.id);
      return agent ? { ...agent, portfolio: await loadPortfolio(db, agent.automation, agent.mandate, now) } : null;
    }),
  );
  return agents.filter((agent) => agent !== null);
}

export interface Costs {
  cycles: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  creditsMicro: bigint;
}

export interface AgentDashboard {
  portfolio: PortfolioState;
  stats: PaperStats;
  costs: Costs;
  proposals: number;
  rejected: number;
  /** Failed checks across every rejected proposal, most common first. */
  rejectionReasons: Array<{ label: string; count: number }>;
  swapFeesUsd: number;
  networkFeesUsd: number;
  averageSlippagePercent: number | null;
  /** Whole days since the agent's first cycle. */
  paperDays: number;
}

export async function agentDashboard(agent: LoadedAgent): Promise<AgentDashboard> {
  const id = agent.automation.id;
  const [portfolio, closed, [runTotals], [proposalTotals], rejections, [fills]] = await Promise.all([
    loadPortfolio(db, agent.automation, agent.mandate, Date.now()),
    db
      .select({ realizedPnlUsd: positions.realizedPnlUsd, feesUsd: positions.feesUsd })
      .from(positions)
      .where(and(eq(positions.automationId, id), eq(positions.status, "closed"))),
    db
      .select({
        cycles: sql<number>`count(*)::int`,
        modelCalls: sql<number>`count(*) filter (where ${tradingRuns.model} is not null and ${tradingRuns.creditsMicro} > 0)::int`,
        inputTokens: sql<number>`coalesce(sum(${tradingRuns.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${tradingRuns.outputTokens}), 0)::int`,
        credits: sql<string>`coalesce(sum(${tradingRuns.creditsMicro}), 0)::text`,
        first: sql<Date | null>`min(${tradingRuns.createdAt})`,
      })
      .from(tradingRuns)
      .where(eq(tradingRuns.automationId, id)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        rejected: sql<number>`count(*) filter (where ${tradeProposals.state} = 'RISK_REJECTED')::int`,
      })
      .from(tradeProposals)
      .where(eq(tradeProposals.automationId, id)),
    db
      .select({ checks: riskEvaluations.checks })
      .from(riskEvaluations)
      .where(and(eq(riskEvaluations.automationId, id), eq(riskEvaluations.approved, false)))
      .orderBy(desc(riskEvaluations.createdAt))
      .limit(500),
    db
      .select({
        swap: sql<number>`coalesce(sum(${executions.swapFeeUsd}), 0)::float8`,
        network: sql<number>`coalesce(sum(${executions.networkFeeUsd}), 0)::float8`,
        slippage: sql<number | null>`avg(${executions.slippagePercent})::float8`,
      })
      .from(executions)
      .where(eq(executions.automationId, id)),
  ]);

  const reasons = new Map<string, number>();
  for (const evaluation of rejections) {
    for (const check of evaluation.checks) if (check.status === "fail") reasons.set(check.label, (reasons.get(check.label) ?? 0) + 1);
  }
  return {
    portfolio,
    stats: tradeStats(closed),
    costs: {
      cycles: runTotals?.cycles ?? 0,
      modelCalls: runTotals?.modelCalls ?? 0,
      inputTokens: runTotals?.inputTokens ?? 0,
      outputTokens: runTotals?.outputTokens ?? 0,
      creditsMicro: BigInt(runTotals?.credits ?? "0"),
    },
    proposals: proposalTotals?.total ?? 0,
    rejected: proposalTotals?.rejected ?? 0,
    rejectionReasons: [...reasons.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    swapFeesUsd: fills?.swap ?? 0,
    networkFeesUsd: fills?.network ?? 0,
    averageSlippagePercent: fills?.slippage ?? null,
    paperDays: runTotals?.first ? Math.floor((Date.now() - new Date(runTotals.first).getTime()) / 86_400_000) : 0,
  };
}

export async function listPositions(automationId: string, status: "open" | "closed", limit = 25) {
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.automationId, automationId), eq(positions.status, status)))
    .orderBy(desc(status === "open" ? positions.openedAt : positions.closedAt))
    .limit(limit);
}

/** Recent decisions, each with the risk evaluation that settled it: the final one when there is one, otherwise the first. */
export async function listDecisions(automationId: string, limit = 20) {
  const proposals = await db.select().from(tradeProposals).where(eq(tradeProposals.automationId, automationId)).orderBy(desc(tradeProposals.createdAt)).limit(limit);
  if (proposals.length === 0) return [];
  const [evaluations, fills, mandates] = await Promise.all([
    db
      .select()
      .from(riskEvaluations)
      .where(
        inArray(
          riskEvaluations.proposalId,
          proposals.map((proposal) => proposal.id),
        ),
      )
      .orderBy(riskEvaluations.createdAt),
    db
      .select()
      .from(executions)
      .where(
        and(
          inArray(
            executions.proposalId,
            proposals.map((proposal) => proposal.id),
          ),
          eq(executions.side, "buy"),
        ),
      ),
    // Each decision is shown against the mandate version that judged it, not today's.
    db
      .select()
      .from(riskMandates)
      .where(inArray(riskMandates.id, [...new Set(proposals.map((proposal) => proposal.mandateId))])),
  ]);
  const mandateById = new Map(mandates.map((row) => [row.id, row.mandate]));
  const settled = new Map<string, RiskEvaluation>();
  for (const evaluation of evaluations) settled.set(evaluation.proposalId, evaluation);
  const entries = new Map(fills.map((fill) => [fill.proposalId, fill]));
  return proposals.map((proposal) => ({
    proposal,
    evaluation: settled.get(proposal.id) ?? null,
    entry: entries.get(proposal.id) ?? null,
    mandate: mandateById.get(proposal.mandateId) ?? null,
  }));
}

/** Every fill, newest first: what was bought or sold, at what price, what it cost in fees, and its transaction. */
export async function listTrades(automationId: string, limit = 20) {
  return db.select().from(executions).where(eq(executions.automationId, automationId)).orderBy(desc(executions.createdAt)).limit(limit);
}

export async function listRuns(automationId: string, limit = 12) {
  return db.select().from(tradingRuns).where(eq(tradingRuns.automationId, automationId)).orderBy(desc(tradingRuns.createdAt)).limit(limit);
}

export async function listAudit(automationId: string, limit = 40, offset = 0) {
  return db.select().from(auditEvents).where(eq(auditEvents.automationId, automationId)).orderBy(desc(auditEvents.createdAt)).limit(limit).offset(offset);
}

export async function listWalletAudit(userId: string, limit = 20) {
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.userId, userId), sql`${auditEvents.type} like 'wallet.%'`))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
