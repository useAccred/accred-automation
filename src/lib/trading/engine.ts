import { AuthenticationError, InsufficientCreditsError, type ChatCompletion, type Message, type Model } from "accred";
import { and, eq, sql } from "drizzle-orm";
import { accredFor, listModels } from "../accred";
import { RoutingError, pickRouting, worstCaseMicro } from "../agent/router";
import { toMicro } from "../credits";
import { decrypt } from "../crypto";
import { db, positions, riskEvaluations, tradeProposals, tradingAutomations, tradingRuns, users, type TradeProposal, type TradingRunStatus } from "../db";
import { audit } from "./audit";
import { networkFeeUsd } from "./chain";
import { env } from "../env";
import { executeEntry, riskInputsSnapshot } from "./execution";
import { createLiveVenue, quoteRecord, type LiveVenue, type WalletFunds } from "./live-venue";
import type { MandateAsset } from "./mandate";
import { MarketDataError, fetchSnapshots, type MarketSnapshot } from "./market-data";
import { notifyTrading } from "./notify";
import { PROPOSAL_FORMAT_REMINDER, PROPOSAL_MAX_OUTPUT, buildProposalMessages, parseProposals, type Candidate, type ModelProposal } from "./proposal";
import { paperQuote, type PaperQuote } from "./quote";
import type { LiveQuote } from "./live-venue";
import { entryBlocker, evaluateRisk, localClock, marketFilterFailure, rejectionSummary, type RiskInputs, type RiskWallet } from "./risk-engine";
import { loadAgent, loadPortfolio, moveTrade, riskAgent, tradingCreditsThisMonth, type LoadedAgent, type ProposalRef } from "./store";
import { matchingStrategies } from "./strategy";

/**
 * One cycle of a trading agent:
 *
 *   market scan → candidate filter → model → proposal → risk engine → quote and
 *   simulation → final check → execution
 *
 * Everything before the model is deterministic and free, so a cycle that could
 * not trade anyway never spends credits. Everything after the model treats its
 * reply as untrusted input.
 */

/** Everything outside this process, so tests can stand in for the market and the model. */
export interface EngineDeps {
  now(): number;
  snapshots(addresses: string[], options?: { fresh?: boolean }): Promise<Map<string, MarketSnapshot>>;
  networkFeeUsd(): Promise<number>;
  catalog(): Promise<Model[]>;
  complete(apiKey: string, params: { model: string; messages: Message[]; maxOutputTokens: number }, idempotencyKey: string): Promise<ChatCompletion>;
  notify: typeof notifyTrading;
  /** Where Live Mode trades. Paper Mode never touches it. */
  venue: LiveVenue;
}

let sharedVenue: LiveVenue | undefined;

/** A live trade needs ETH for an approval and a swap. Below this the wallet is treated as out of gas. */
export const MIN_GAS_WEI = 100_000_000_000_000n;

export function riskWallet(funds: WalletFunds | null): RiskWallet | null {
  return funds ? { usdg: funds.usdg, hasGas: funds.ethWei >= MIN_GAS_WEI } : null;
}

export const defaultDeps: EngineDeps = {
  get venue() {
    return (sharedVenue ??= createLiveVenue());
  },
  now: () => Date.now(),
  snapshots: fetchSnapshots,
  networkFeeUsd,
  catalog: listModels,
  complete: (apiKey, params, idempotencyKey) => accredFor(apiKey).chat.create(params, { idempotencyKey }),
  notify: notifyTrading,
};

/** At most this many candidates are shown to the model, to bound what a cycle can cost. */
const MAX_CANDIDATES = 12;
const usd = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;

interface Cycle {
  agent: LoadedAgent;
  runId: string;
  deps: EngineDeps;
  spent: bigint;
}

export interface CycleResult {
  runId: string;
  status: TradingRunStatus;
  summary: string;
}

/** Runs one cycle. Returns null when the agent is missing or another cycle is already running. */
export async function runTradingCycle(automationId: string, trigger: "schedule" | "manual", deps: EngineDeps = defaultDeps): Promise<CycleResult | null> {
  const agent = await loadAgent(automationId);
  if (!agent) return null;
  const [active] = await db
    .select({ id: tradingRuns.id })
    .from(tradingRuns)
    .where(and(eq(tradingRuns.automationId, automationId), eq(tradingRuns.status, "running")))
    .limit(1);
  if (active) return null;

  const [run] = await db
    .insert(tradingRuns)
    .values({
      automationId,
      userId: agent.automation.userId,
      trigger,
      mode: agent.automation.mode,
      mandateVersion: agent.mandateRow.version,
      strategyVersion: agent.strategy.version,
    })
    .returning({ id: tradingRuns.id });
  const cycle: Cycle = { agent, runId: run!.id, deps, spent: 0n };
  await db.update(tradingAutomations).set({ lastRunAt: new Date() }).where(eq(tradingAutomations.id, automationId));

  try {
    return await runCycle(cycle);
  } catch (error) {
    console.error(`[trading run ${cycle.runId}]`, error instanceof Error ? error.message : error);
    // Whatever went wrong, the cycle ends without trading further.
    return finish(cycle, "failed", describeFailure(error));
  }
}

async function runCycle(cycle: Cycle): Promise<CycleResult> {
  const { agent, deps } = cycle;
  const { automation, mandate, wallet } = agent;
  const now = deps.now();

  // An agent trades in the mode its mandate was approved for, and live only while the server's switch is on.
  if (automation.mode !== mandate.mode) return finish(cycle, "skipped", "The agent's mode does not match its mandate. Nothing was traded.");
  if (automation.mode === "live" && !env.liveTrading) return finish(cycle, "skipped", "Live trading is switched off on this server. Nothing was traded.");
  // There is no simulated trading in the product. The paper fill model only runs inside the test suite.
  if (automation.mode === "paper" && (env.liveTrading || !env.paperFixture)) {
    return finish(cycle, "skipped", "Paper Mode has been retired. Create a new agent to trade. Nothing was traded.");
  }
  if (!automation.permissions.includes("READ_MARKET_DATA")) return finish(cycle, "skipped", "The agent has no permission to read market data.");

  const portfolio = await loadPortfolio(db, automation, mandate, now);
  const blocker = entryBlocker({ now, clock: localClock(now, automation.timezone), mandate, agent: riskAgent(automation, wallet), portfolio });
  if (blocker) return finish(cycle, "skipped", `No new position can be opened. ${blocker}. The model was not called.`);

  // ── Market scan ─────────────────────────────────────────────────────────
  const blocked = new Set(mandate.blockedAssets);
  const universe = mandate.allowedAssets.filter((asset) => !blocked.has(asset.address));
  if (universe.length === 0) return finish(cycle, "skipped", "No assets are selected. Add at least one to the allowlist.");
  let snapshots: Map<string, MarketSnapshot>;
  try {
    snapshots = await deps.snapshots(universe.map((asset) => asset.address));
  } catch (error) {
    await db.update(tradingAutomations).set({ dataFailures: sql`${tradingAutomations.dataFailures} + 1` }).where(eq(tradingAutomations.id, automation.id));
    const reason = error instanceof MarketDataError ? error.message : "Market data could not be loaded.";
    return finish(cycle, "skipped", `${reason} Nothing was traded.`);
  }
  if (automation.dataFailures > 0) await db.update(tradingAutomations).set({ dataFailures: 0 }).where(eq(tradingAutomations.id, automation.id));

  // ── Candidate filter ────────────────────────────────────────────────────
  const candidates: Candidate[] = [];
  const filtered: Array<{ symbol: string; reason: string }> = [];
  for (const asset of universe) {
    const market = snapshots.get(asset.address) ?? null;
    const problem = portfolio.openAssets.includes(asset.address) ? "A position is already open" : marketFilterFailure(mandate, market, now);
    if (problem || !market) {
      filtered.push({ symbol: asset.symbol, reason: problem ?? "No market data" });
      continue;
    }
    const signals = matchingStrategies(agent.strategy.kinds, market);
    if (agent.strategy.kinds.length > 0 && signals.length === 0) {
      filtered.push({ symbol: asset.symbol, reason: "No strategy screen matched" });
      continue;
    }
    candidates.push({ market, signals });
  }
  candidates.sort((a, b) => b.signals.length - a.signals.length || (b.market.volumeH24 ?? 0) - (a.market.volumeH24 ?? 0));
  const shortlist = candidates.slice(0, MAX_CANDIDATES);
  await db.update(tradingRuns).set({ scanned: universe.length, candidates: shortlist.length }).where(eq(tradingRuns.id, cycle.runId));
  await audit({
    userId: automation.userId,
    automationId: automation.id,
    runId: cycle.runId,
    type: "run.scan",
    actor: "system",
    summary: `Scanned ${universe.length} assets: ${shortlist.length} passed the filters`,
    data: { source: [...new Set([...snapshots.values()].map((snapshot) => snapshot.source))].join(", ") || "none", candidates: shortlist.map((candidate) => candidate.market), filtered },
  });
  if (shortlist.length === 0) {
    return finish(cycle, "skipped", `None of the ${universe.length} assets passed the market filters and strategy screens. The model was not called.`);
  }
  if (!automation.permissions.includes("PROPOSE_TRADE")) return finish(cycle, "skipped", "The agent has no permission to propose trades.");

  // ── Model ───────────────────────────────────────────────────────────────
  const left = automation.maxPerMonthMicro - (await tradingCreditsThisMonth(automation.id));
  if (left <= 0n) return finish(cycle, "skipped", "This agent has reached its monthly credit cap. Raise the cap or wait for next month.");
  const budget = left < automation.maxPerRunMicro ? left : automation.maxPerRunMicro;
  const model = pickRouting(await deps.catalog(), automation.modelMode, automation.modelId).planner;
  await db.update(tradingRuns).set({ model: model.id, budgetMicro: budget }).where(eq(tradingRuns.id, cycle.runId));

  const messages = buildProposalMessages({
    mandate,
    portfolio,
    strategies: agent.strategy.kinds,
    instructions: agent.strategy.instructions,
    candidates: shortlist,
    openSymbols: await openSymbols(automation.id),
    now: new Date(now),
  });

  let parsed = parseProposals("");
  for (let attempt = 0; attempt < 2; attempt++) {
    const size = messages.reduce((total, message) => total + message.content.length + 12, 0);
    if (cycle.spent + worstCaseMicro(model, size, PROPOSAL_MAX_OUTPUT) > budget) {
      return finish(cycle, attempt === 0 ? "skipped" : "failed", "The credit budget per cycle is too small for the model call. Nothing was traded.");
    }
    const completion = await callModel(cycle, model, messages, attempt);
    parsed = parseProposals(completion.content);
    if (parsed.ok) break;
    messages.push({ role: "assistant", content: completion.content.slice(0, 1500) || "(empty reply)" }, { role: "user", content: `${parsed.error} ${PROPOSAL_FORMAT_REMINDER}` });
  }
  if (!parsed.ok) return finish(cycle, "failed", `${model.name} did not reply in the expected format. Nothing was traded.`);

  await audit({
    userId: automation.userId,
    automationId: automation.id,
    runId: cycle.runId,
    type: "run.model_reply",
    actor: "agent",
    summary: parsed.proposals.length === 0 ? "The model proposed nothing" : `The model proposed ${parsed.proposals.length} trade${parsed.proposals.length === 1 ? "" : "s"}`,
    data: { model: model.id, reasoningSummary: parsed.analysis.slice(0, 1000), dropped: parsed.dropped },
  });
  await db.update(tradingRuns).set({ proposals: parsed.proposals.length }).where(eq(tradingRuns.id, cycle.runId));

  // ── Proposals, one at a time ────────────────────────────────────────────
  let executed = 0;
  for (const proposal of parsed.proposals) {
    if (await processProposal(cycle, proposal, snapshots, model.id)) executed++;
  }
  await db.update(tradingRuns).set({ executed }).where(eq(tradingRuns.id, cycle.runId));

  const count = parsed.proposals.length;
  const summary =
    count === 0
      ? `${shortlist.length} candidate${shortlist.length === 1 ? "" : "s"} reviewed. The model proposed nothing. ${parsed.analysis}`.trim()
      : `${count} proposal${count === 1 ? "" : "s"}: ${executed} executed, ${count - executed} not executed.`;
  return finish(cycle, "completed", summary.slice(0, 600));
}

async function openSymbols(automationId: string): Promise<string[]> {
  const rows = await db
    .select({ symbol: positions.symbol })
    .from(positions)
    .where(and(eq(positions.automationId, automationId), eq(positions.status, "open")));
  return rows.map((row) => row.symbol);
}

async function callModel(cycle: Cycle, model: Model, messages: Message[], attempt: number): Promise<ChatCompletion> {
  const { automation, user } = cycle.agent;
  const completion = await cycle.deps.complete(
    decrypt(user.keyEnc),
    { model: model.id, messages, maxOutputTokens: PROPOSAL_MAX_OUTPUT },
    // The same key on a retry of this exact call means it is never charged twice.
    `trade-${cycle.runId}-p${attempt}`,
  );
  const charged = toMicro(completion.creditsChargedExact);
  cycle.spent += charged;
  await db
    .update(tradingRuns)
    .set({
      creditsMicro: sql`${tradingRuns.creditsMicro} + ${charged}`,
      inputTokens: sql`${tradingRuns.inputTokens} + ${completion.usage.inputTokens}`,
      outputTokens: sql`${tradingRuns.outputTokens} + ${completion.usage.outputTokens}`,
    })
    .where(eq(tradingRuns.id, cycle.runId));
  if (completion.remainingCreditsExact !== null) {
    await db
      .update(users)
      .set({ balanceExact: completion.remainingCreditsExact, balanceAt: new Date(), balanceSource: "reported" })
      .where(eq(users.id, automation.userId));
  }
  return completion;
}

/** Finds the allowlisted asset a model named, by address or by an unambiguous symbol. */
export function resolveAsset(name: string, allowed: MandateAsset[]): MandateAsset | null {
  const wanted = name.trim().toLowerCase();
  const byAddress = allowed.find((asset) => asset.address === wanted);
  if (byAddress) return byAddress;
  const bySymbol = allowed.filter((asset) => asset.symbol.toLowerCase() === wanted.replace(/^\$/, ""));
  return bySymbol.length === 1 ? bySymbol[0]! : null;
}

/** Takes one model proposal through the risk engine and, if it passes everything, executes it. Returns true when a position was opened. */
async function processProposal(cycle: Cycle, proposed: ModelProposal, scan: Map<string, MarketSnapshot>, modelId: string): Promise<boolean> {
  const { deps } = cycle;
  const { automation, mandate, mandateRow, strategy, wallet } = cycle.agent;
  const asset = resolveAsset(proposed.asset, mandate.allowedAssets);
  // An asset that is not on the allowlist is still recorded, so the rejection is visible.
  const symbol = asset?.symbol ?? (proposed.asset.replace(/[^A-Za-z0-9._$-]/g, "").slice(0, 16) || "UNKNOWN");
  const scanned = asset ? (scan.get(asset.address) ?? null) : null;

  const [row] = await db
    .insert(tradeProposals)
    .values({
      automationId: automation.id,
      runId: cycle.runId,
      userId: automation.userId,
      state: "DISCOVERED",
      action: "BUY",
      assetAddress: asset?.address ?? "",
      assetSymbol: symbol,
      requestedUsd: proposed.requestedPositionUsd,
      stopLossPercent: proposed.stopLossPercent ?? null,
      takeProfitPercent: proposed.takeProfitPercent ?? null,
      confidence: proposed.confidence ?? null,
      reason: proposed.entryReason.slice(0, 1000),
      model: modelId,
      market: scanned ? { ...scanned } : null,
      mandateId: mandateRow.id,
      mandateVersion: mandateRow.version,
      strategyVersion: strategy.version,
    })
    .returning();
  const proposal: TradeProposal = row!;
  const ref: ProposalRef = { id: proposal.id, automationId: proposal.automationId, userId: proposal.userId, runId: proposal.runId, state: proposal.state };
  await moveTrade(db, ref, "PROPOSED", {
    actor: "agent",
    summary: `Proposed: buy ${usd(proposal.requestedUsd)} of ${symbol}`,
    data: { proposal: proposed, model: modelId, marketDataRef: scanned ? { source: scanned.source, pairAddress: scanned.pairAddress, fetchedAt: scanned.fetchedAt } : null },
  });

  // ── Deterministic risk engine ───────────────────────────────────────────
  const now = deps.now();
  const live = automation.mode === "live";
  const inputs: RiskInputs = {
    now,
    clock: localClock(now, automation.timezone),
    mandate,
    agent: riskAgent(automation, wallet),
    proposal: {
      action: "BUY",
      assetAddress: proposal.assetAddress,
      symbol,
      requestedUsd: proposal.requestedUsd,
      stopLossPercent: proposal.stopLossPercent,
      takeProfitPercent: proposal.takeProfitPercent,
    },
    portfolio: await loadPortfolio(db, automation, mandate, now),
    market: scanned,
    quote: null,
    // Live: what the wallet really holds, read from the chain. Unreadable means no trade.
    wallet: live ? riskWallet(await deps.venue.funds(wallet.address)) : undefined,
  };
  const pre = evaluateRisk(inputs, "pre_trade");
  await db.insert(riskEvaluations).values({
    proposalId: proposal.id,
    automationId: automation.id,
    stage: "pre_trade",
    approved: pre.approved,
    passed: pre.passed,
    total: pre.total,
    checks: pre.checks,
    inputs: riskInputsSnapshot(inputs),
    mandateId: mandateRow.id,
    mandateVersion: mandateRow.version,
  });
  if (!pre.approved || !asset) {
    const reason = rejectionSummary(pre) || "The risk engine could not approve this trade.";
    await moveTrade(db, ref, "RISK_REJECTED", { actor: "risk_engine", summary: `Rejected ${symbol}: ${reason}`, outcome: reason, data: { passed: pre.passed, failed: pre.failed } });
    await deps.notify(automation, `SKIPPED — ${symbol}\n${reason}\nRisk engine: rejected automatically`);
    return false;
  }
  await moveTrade(db, ref, "APPROVED", { actor: "risk_engine", summary: `Approved ${symbol} before quoting (${pre.passed} checks passed)` });

  // ── Quote and simulation, on fresh data ─────────────────────────────────
  let market: MarketSnapshot | null = null;
  try {
    market = (await deps.snapshots([asset.address], { fresh: true })).get(asset.address) ?? null;
  } catch {
    // No fresh price means no quote; the final check fails on it below.
  }
  let quote: PaperQuote | LiveQuote;
  if (live) {
    // A real route, simulated on the chain from the wallet. USDG has six decimals; fractions of a micro-dollar are dropped.
    quote = await deps.venue.quote({
      side: "buy",
      wallet: wallet.address,
      token: asset.address,
      amountInRaw: BigInt(Math.floor(proposal.requestedUsd * 1_000_000)),
      slippagePercent: mandate.maxSlippagePercent,
      market,
      now: deps.now(),
    });
  } else {
    let fee: number | null = null;
    try {
      fee = await deps.networkFeeUsd();
    } catch {
      // An unknown fee fails the network-fee check.
    }
    quote = paperQuote({ side: "buy", market, notionalUsd: proposal.requestedUsd, networkFeeUsd: fee, now: deps.now() });
  }
  await db
    .update(tradingAutomations)
    .set({ simulationFailures: quote.simulation.ok ? 0 : sql`${tradingAutomations.simulationFailures} + 1` })
    .where(eq(tradingAutomations.id, automation.id));
  await moveTrade(db, ref, "SIMULATED", {
    actor: "execution",
    summary: quote.simulation.ok ? `Quoted and simulated ${symbol}: ${quote.simulation.detail}` : `Simulation failed for ${symbol}: ${quote.simulation.detail}`,
    data: { quote: "route" in quote ? quoteRecord(quote) : { ...quote } },
  });

  // ── Final pre-trade check and execution ─────────────────────────────────
  const outcome = await executeEntry({
    proposal: { ...proposal, state: ref.state },
    market,
    quote,
    now: deps.now(),
    wallet: live ? riskWallet(await deps.venue.funds(wallet.address)) : undefined,
    venue: live ? deps.venue : undefined,
  });
  if (outcome.status === "opened") {
    const entry = outcome.priceUsd;
    await deps.notify(
      automation,
      [
        `BUY — ${symbol}`,
        `Position ${usd(outcome.notionalUsd)} at $${entry.toPrecision(5)}`,
        `Stop loss $${outcome.stopLossPrice.toPrecision(5)}${outcome.takeProfitPrice ? ` · take profit $${outcome.takeProfitPrice.toPrecision(5)}` : ""}`,
        `Maximum planned loss ${usd(outcome.notionalUsd * (1 - outcome.stopLossPrice / entry))}`,
        ...(outcome.result ? [`Risk checks ${outcome.result.passed}/${outcome.result.total} passed`] : []),
        ...(outcome.txHash ? [`Transaction ${outcome.txHash}`] : []),
      ].join("\n"),
    );
    return true;
  }
  if (outcome.status === "rejected") {
    await deps.notify(automation, `SKIPPED — ${symbol}\n${outcome.reason}\nRisk engine: rejected automatically`);
  } else if (outcome.status === "failed") {
    await deps.notify(automation, `FAILED — ${symbol}\n${outcome.reason}\nNo position was opened.`);
  } else if (outcome.status === "pending") {
    await deps.notify(automation, `PENDING — ${symbol}\nThe swap was sent and has not confirmed yet. Its capital stays reserved until the chain settles it.`);
  }
  return false;
}

async function finish(cycle: Cycle, status: TradingRunStatus, summary: string): Promise<CycleResult> {
  const { automation } = cycle.agent;
  await db
    .update(tradingRuns)
    .set({ status, finishedAt: new Date(), ...(status === "failed" ? { error: summary } : { summary }) })
    .where(eq(tradingRuns.id, cycle.runId));
  await audit({
    userId: automation.userId,
    automationId: automation.id,
    runId: cycle.runId,
    type: `run.${status}`,
    actor: "system",
    summary: summary.slice(0, 300),
  });
  if (status === "failed") await cycle.deps.notify(automation, `Cycle failed: ${summary}`);
  return { runId: cycle.runId, status, summary };
}

function describeFailure(error: unknown): string {
  if (error instanceof InsufficientCreditsError) {
    return "Your Accred wallet does not have enough activated credit for the model call. Nothing was traded.";
  }
  if (error instanceof AuthenticationError) return "Accred rejected your API key. Replace it in Settings. Nothing was traded.";
  if (error instanceof RoutingError) return `${error.message} Nothing was traded.`;
  return `The cycle stopped on an error and nothing further was traded: ${error instanceof Error ? error.message : "unknown error"}`;
}
