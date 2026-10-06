import { positionCapUsd, withinTradingHours, type Mandate } from "./mandate";
import type { Permission } from "./permissions";
import type { PortfolioState } from "./portfolio";

/**
 * The deterministic risk engine. It is a pure function of its inputs: no model
 * output reaches it except the proposal's numbers, and nothing it returns can be
 * overridden. Paper and Live use this same code.
 *
 * Fail closed: a value that is missing or not a finite number fails its check.
 */

export type CheckStatus = "pass" | "fail" | "pending";

export interface RiskCheck {
  id: number;
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface RiskProposal {
  action: "BUY";
  /** Lowercase token address. Empty when the model named something that is not on the allowlist. */
  assetAddress: string;
  symbol: string;
  requestedUsd: number;
  stopLossPercent: number | null;
  takeProfitPercent: number | null;
}

export interface RiskAgent {
  status: "running" | "paused" | "stopped";
  mode: "paper" | "live";
  accessRevoked: boolean;
  walletRevoked: boolean;
  permissions: Permission[];
  /** Whether this server may execute live trades at all. */
  liveEnabled: boolean;
}

export interface RiskMarket {
  network: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number | null;
  /** When the deepest pool was created, in milliseconds. */
  pairCreatedAt: number | null;
  fetchedAt: number;
}

export interface RiskQuote {
  priceUsd: number;
  priceImpactPercent: number;
  slippagePercent: number;
  networkFeeUsd: number;
  quotedAt: number;
  simulation: { ok: boolean; detail: string };
}

export interface RiskInputs {
  now: number;
  /** Weekday (0 is Sunday) and hour in the agent's timezone. */
  clock: { day: number; hour: number };
  mandate: Mandate;
  agent: RiskAgent;
  proposal: RiskProposal;
  portfolio: PortfolioState;
  market: RiskMarket | null;
  /** Null before a quote exists. The final stage requires one. */
  quote: RiskQuote | null;
}

export interface RiskResult {
  stage: "pre_trade" | "final";
  approved: boolean;
  passed: number;
  failed: number;
  total: number;
  checks: RiskCheck[];
  /** The stop and target the trade will carry, after mandate defaults are applied. */
  stopLossPercent: number | null;
  takeProfitPercent: number | null;
  plannedLossUsd: number | null;
}

/** Market data older than this is treated as unknown. */
export const MAX_MARKET_AGE_MS = 90_000;
/** The mandate's network name as each data source spells it. */
export const NETWORK_IDS: Record<string, string> = { "robinhood-chain": "robinhood" };

const EPSILON = 1e-9;
const ok = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const usd = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : value >= 1 ? 2 : 4 })}`;
const pct = (value: number) => `${Math.round(value * 100) / 100}%`;
const minutes = (ms: number) => `${Math.max(1, Math.ceil(ms / 60_000))} min`;

type Verdict = string | { fail: string };
const fail = (detail: string): Verdict => ({ fail: detail });

/**
 * The stop loss and take profit a proposal ends up with. A missing take profit
 * takes the mandate default. A missing stop loss takes the default only when the
 * mandate does not require the model to state one.
 */
export function resolveStops(mandate: Mandate, proposal: Pick<RiskProposal, "stopLossPercent" | "takeProfitPercent">) {
  const stopLossPercent = ok(proposal.stopLossPercent) ? proposal.stopLossPercent : mandate.stopLossRequired ? null : mandate.defaultStopLossPercent;
  const takeProfitPercent = ok(proposal.takeProfitPercent) ? proposal.takeProfitPercent : mandate.defaultTakeProfitPercent;
  return { stopLossPercent, takeProfitPercent };
}

function tradingEnabled({ mandate, agent, clock }: RiskInputs): Verdict {
  if (!mandate.tradingEnabled) return fail("Trading is switched off in the mandate");
  if (agent.accessRevoked) return fail("Trading access has been revoked");
  if (agent.walletRevoked) return fail("The wallet's trading authority has been revoked");
  if (agent.status !== "running") return fail(agent.status === "paused" ? "The agent is paused" : "The agent has not been started");
  if (agent.mode !== mandate.mode) return fail("The agent's mode does not match its mandate");
  if (agent.mode === "live" && !agent.liveEnabled) return fail("Live trading is not enabled on this server");
  for (const permission of ["PROPOSE_TRADE", "EXECUTE_TRADE"] as const) {
    if (!agent.permissions.includes(permission)) return fail(`The ${permission} permission has not been granted`);
  }
  if (!ok(clock.day) || !ok(clock.hour)) return fail("The time could not be determined");
  if (!withinTradingHours(mandate.tradingHours, clock.day, clock.hour)) return fail("Outside the trading hours you set");
  return agent.mode === "paper" ? "Running in Paper Mode" : "Running in Live Mode";
}

function allocationAvailable({ proposal, portfolio }: RiskInputs): Verdict {
  if (!ok(proposal.requestedUsd) || proposal.requestedUsd <= 0) return fail("The requested size is not a positive amount");
  if (!ok(portfolio.availableUsd)) return fail("Available capital could not be determined");
  const detail = `Requested ${usd(proposal.requestedUsd)} · available ${usd(portfolio.availableUsd)} of ${usd(portfolio.allocationUsd)} allocation`;
  return proposal.requestedUsd <= portfolio.availableUsd + EPSILON ? detail : fail(detail);
}

function positionSize({ proposal, mandate }: RiskInputs): Verdict {
  const cap = positionCapUsd(mandate);
  if (!ok(proposal.requestedUsd) || !ok(cap)) return fail("The position size could not be determined");
  const detail = `Requested ${usd(proposal.requestedUsd)} · largest position ${usd(cap)}`;
  return proposal.requestedUsd <= cap + EPSILON ? detail : fail(detail);
}

function totalExposure({ proposal, portfolio, mandate }: RiskInputs): Verdict {
  const cap = (mandate.agentAllocationUsd * mandate.maxTotalExposurePercent) / 100;
  const after = portfolio.openCostUsd + proposal.requestedUsd;
  if (!ok(after) || !ok(cap)) return fail("Open exposure could not be determined");
  const detail = `Exposure after this trade ${usd(after)} · limit ${usd(cap)} (${pct(mandate.maxTotalExposurePercent)})`;
  return after <= cap + EPSILON ? detail : fail(detail);
}

function openPositions({ proposal, portfolio, mandate }: RiskInputs): Verdict {
  if (!ok(portfolio.openPositions)) return fail("Open positions could not be determined");
  if (proposal.assetAddress && portfolio.openAssets.includes(proposal.assetAddress)) return fail(`A ${proposal.symbol} position is already open`);
  const detail = `${portfolio.openPositions} open · limit ${mandate.maxOpenPositions}`;
  return portfolio.openPositions < mandate.maxOpenPositions ? detail : fail(detail);
}

function tradeFrequency({ portfolio, mandate, now }: RiskInputs): Verdict {
  if (!ok(portfolio.tradesLastHour) || !ok(portfolio.tradesToday)) return fail("Recent trades could not be determined");
  if (portfolio.tradesLastHour >= mandate.maxTradesPerHour) return fail(`${portfolio.tradesLastHour} trades in the last hour · limit ${mandate.maxTradesPerHour}`);
  if (portfolio.tradesToday >= mandate.maxTradesPerDay) return fail(`${portfolio.tradesToday} trades today · limit ${mandate.maxTradesPerDay}`);
  if (portfolio.lastTradeAt !== null && mandate.cooldownBetweenTradesMinutes > 0) {
    const wait = portfolio.lastTradeAt + mandate.cooldownBetweenTradesMinutes * 60_000 - now;
    if (!ok(wait)) return fail("The time since the last trade could not be determined");
    if (wait > 0) return fail(`Cooling down between trades · ${minutes(wait)} left`);
  }
  return `${portfolio.tradesToday} of ${mandate.maxTradesPerDay} trades today · ${portfolio.tradesLastHour} of ${mandate.maxTradesPerHour} this hour`;
}

function dailyLoss({ portfolio, mandate }: RiskInputs): Verdict {
  const limit = (mandate.agentAllocationUsd * mandate.dailyLossLimitPercent) / 100;
  if (!ok(portfolio.dailyLossUsd) || !ok(limit)) return fail("Today's loss could not be determined");
  const detail = `Loss today ${usd(portfolio.dailyLossUsd)} · limit ${usd(limit)} (${pct(mandate.dailyLossLimitPercent)})`;
  return portfolio.dailyLossUsd < limit - EPSILON ? detail : fail(detail);
}

function drawdown({ portfolio, mandate }: RiskInputs): Verdict {
  if (!ok(portfolio.drawdownPercent)) return fail("Drawdown could not be determined");
  const detail = `Drawdown ${pct(portfolio.drawdownPercent)} · limit ${pct(mandate.maxDrawdownPercent)}`;
  return portfolio.drawdownPercent < mandate.maxDrawdownPercent - EPSILON ? detail : fail(detail);
}

function consecutiveLosses({ portfolio, mandate, now }: RiskInputs): Verdict {
  if (!ok(portfolio.consecutiveLosses)) return fail("The loss streak could not be determined");
  if (portfolio.consecutiveLosses >= mandate.maxConsecutiveLosses) {
    return fail(`${portfolio.consecutiveLosses} losses in a row · limit ${mandate.maxConsecutiveLosses}`);
  }
  if (portfolio.lastLossAt !== null && mandate.cooldownAfterLossMinutes > 0) {
    const wait = portfolio.lastLossAt + mandate.cooldownAfterLossMinutes * 60_000 - now;
    if (!ok(wait)) return fail("The time since the last loss could not be determined");
    if (wait > 0) return fail(`Cooling down after a loss · ${minutes(wait)} left`);
  }
  return `${portfolio.consecutiveLosses} losses in a row · limit ${mandate.maxConsecutiveLosses}`;
}

function assetPermitted({ proposal, mandate, market }: RiskInputs): Verdict {
  if (!/^0x[0-9a-f]{40}$/.test(proposal.assetAddress)) return fail(`${proposal.symbol || "The asset"} is not on your allowlist`);
  if (mandate.blockedAssets.includes(proposal.assetAddress)) return fail(`${proposal.symbol} is on your blocklist`);
  if (!mandate.allowedAssets.some((asset) => asset.address === proposal.assetAddress)) return fail(`${proposal.symbol} is not on your allowlist`);
  if (market && market.network !== NETWORK_IDS[mandate.allowedNetwork]) return fail("The asset is not on Robinhood Chain");
  return `${proposal.symbol} is on your allowlist · Robinhood Chain`;
}

function marketFilters({ market, mandate, now }: RiskInputs): Verdict {
  if (!market) return fail("No market data for this asset");
  const age = now - market.fetchedAt;
  if (!ok(age) || age > MAX_MARKET_AGE_MS || age < -5_000) return fail("Market data is stale");
  if (!ok(market.priceUsd) || market.priceUsd <= 0) return fail("The price could not be determined");
  if (!ok(market.liquidityUsd)) return fail("Liquidity could not be determined");
  if (market.liquidityUsd < mandate.minimumLiquidityUsd) {
    return fail(`Liquidity ${usd(market.liquidityUsd)} · required minimum ${usd(mandate.minimumLiquidityUsd)}`);
  }
  if (mandate.minimumMarketCapUsd > 0) {
    if (!ok(market.marketCapUsd)) return fail("Market cap could not be determined");
    if (market.marketCapUsd < mandate.minimumMarketCapUsd) {
      return fail(`Market cap ${usd(market.marketCapUsd)} · required minimum ${usd(mandate.minimumMarketCapUsd)}`);
    }
  }
  if (mandate.minimumTokenAgeHours > 0) {
    if (!ok(market.pairCreatedAt)) return fail("The token's age could not be determined");
    const hours = (now - market.pairCreatedAt) / 3_600_000;
    if (hours < mandate.minimumTokenAgeHours) return fail(`Trading for ${Math.floor(hours)} h · required minimum ${mandate.minimumTokenAgeHours} h`);
  }
  return `Liquidity ${usd(market.liquidityUsd)} · required minimum ${usd(mandate.minimumLiquidityUsd)}`;
}

function validStopLoss(inputs: RiskInputs, stopLossPercent: number | null): Verdict {
  const { mandate, proposal } = inputs;
  if (stopLossPercent === null) return fail("The proposal has no stop loss and your mandate requires one");
  if (!ok(stopLossPercent) || stopLossPercent <= 0) return fail("The stop loss is not a positive distance");
  if (stopLossPercent > mandate.maxStopLossPercent + EPSILON) {
    return fail(`Stop loss ${pct(stopLossPercent)} below entry · widest allowed ${pct(mandate.maxStopLossPercent)}`);
  }
  const planned = (proposal.requestedUsd * stopLossPercent) / 100;
  const limit = (mandate.agentAllocationUsd * mandate.maxLossPerTradePercent) / 100;
  if (!ok(planned) || !ok(limit)) return fail("The planned loss could not be determined");
  const detail = `Stop ${pct(stopLossPercent)} below entry · planned loss ${usd(planned)} · limit ${usd(limit)}`;
  return planned <= limit + EPSILON ? detail : fail(detail);
}

function riskReward({ mandate }: RiskInputs, stopLossPercent: number | null, takeProfitPercent: number | null): Verdict {
  if (!ok(stopLossPercent) || stopLossPercent <= 0) return fail("Risk/reward needs a valid stop loss");
  if (!ok(takeProfitPercent) || takeProfitPercent <= 0) return fail("The take profit is not a positive distance");
  const ratio = takeProfitPercent / stopLossPercent;
  const detail = `Reward ${pct(takeProfitPercent)} to risk ${pct(stopLossPercent)} = ${Math.round(ratio * 100) / 100} · minimum ${mandate.minimumRiskReward}`;
  return ratio >= mandate.minimumRiskReward - EPSILON ? detail : fail(detail);
}

function slippage({ quote, mandate, market }: RiskInputs): Verdict {
  if (!quote) return fail("No quote");
  if (!ok(quote.slippagePercent) || !ok(quote.priceImpactPercent) || quote.slippagePercent < 0 || quote.priceImpactPercent < 0) {
    return fail("Slippage could not be determined");
  }
  if (quote.priceImpactPercent > mandate.maxPriceImpactPercent + EPSILON) {
    return fail(`Price impact ${pct(quote.priceImpactPercent)} · limit ${pct(mandate.maxPriceImpactPercent)}`);
  }
  if (quote.slippagePercent > mandate.maxSlippagePercent + EPSILON) {
    return fail(`Slippage ${pct(quote.slippagePercent)} · limit ${pct(mandate.maxSlippagePercent)}`);
  }
  // The quote must be for the market the earlier checks looked at.
  if (!market || !ok(quote.priceUsd) || quote.priceUsd <= 0) return fail("The quoted price could not be determined");
  const drift = (Math.abs(quote.priceUsd - market.priceUsd) / market.priceUsd) * 100;
  if (!ok(drift) || drift > mandate.maxSlippagePercent + mandate.maxPriceImpactPercent + EPSILON) {
    return fail(`The quoted price is ${pct(drift)} away from the market price`);
  }
  return `Slippage ${pct(quote.slippagePercent)} of ${pct(mandate.maxSlippagePercent)} · impact ${pct(quote.priceImpactPercent)} of ${pct(mandate.maxPriceImpactPercent)}`;
}

function simulation({ quote }: RiskInputs): Verdict {
  if (!quote) return fail("No simulation was run");
  return quote.simulation.ok === true ? quote.simulation.detail : fail(quote.simulation.detail || "The simulation failed");
}

function networkFee({ quote, mandate }: RiskInputs): Verdict {
  if (!quote || !ok(quote.networkFeeUsd) || quote.networkFeeUsd < 0) return fail("The network fee could not be determined");
  const detail = `Network fee ${usd(quote.networkFeeUsd)} · limit ${usd(mandate.maxNetworkFeeUsd)}`;
  return quote.networkFeeUsd <= mandate.maxNetworkFeeUsd + EPSILON ? detail : fail(detail);
}

function freshQuote({ quote, mandate, now }: RiskInputs): Verdict {
  if (!quote) return fail("No quote");
  const age = now - quote.quotedAt;
  if (!ok(age) || age < -5_000) return fail("The quote's age could not be determined");
  const detail = `Quote is ${Math.max(0, Math.round(age / 1000))} s old · expires after ${mandate.quoteExpirySeconds} s`;
  return age <= mandate.quoteExpirySeconds * 1000 ? detail : fail(detail);
}

export const CHECK_LABELS = [
  ["trading_enabled", "Trading enabled"],
  ["allocation", "Allocation available"],
  ["position_size", "Position-size limit"],
  ["exposure", "Total exposure limit"],
  ["open_positions", "Open-position limit"],
  ["frequency", "Trade-frequency limit"],
  ["daily_loss", "Daily loss limit"],
  ["drawdown", "Drawdown limit"],
  ["loss_streak", "Consecutive-loss breaker"],
  ["asset", "Asset permitted"],
  ["market", "Liquidity and market filters"],
  ["stop_loss", "Valid stop loss"],
  ["risk_reward", "Minimum risk/reward"],
  ["slippage", "Slippage and price impact"],
  ["simulation", "Transaction simulation"],
  ["network_fee", "Network fee"],
  ["fresh_quote", "Fresh quote"],
] as const;

/** Checks from here on need a quote, so the first stage leaves them pending. */
const FIRST_QUOTE_CHECK = 14;

/**
 * Runs all seventeen checks. "pre_trade" runs before a quote exists and leaves
 * the four quote checks pending. "final" runs immediately before execution with
 * a fresh quote and fresh portfolio, and approves only when all seventeen pass.
 */
export function evaluateRisk(inputs: RiskInputs, stage: "pre_trade" | "final"): RiskResult {
  const { stopLossPercent, takeProfitPercent } = resolveStops(inputs.mandate, inputs.proposal);
  const run: Array<() => Verdict> = [
    () => tradingEnabled(inputs),
    () => allocationAvailable(inputs),
    () => positionSize(inputs),
    () => totalExposure(inputs),
    () => openPositions(inputs),
    () => tradeFrequency(inputs),
    () => dailyLoss(inputs),
    () => drawdown(inputs),
    () => consecutiveLosses(inputs),
    () => assetPermitted(inputs),
    () => marketFilters(inputs),
    () => validStopLoss(inputs, stopLossPercent),
    () => riskReward(inputs, stopLossPercent, takeProfitPercent),
    () => slippage(inputs),
    () => simulation(inputs),
    () => networkFee(inputs),
    () => freshQuote(inputs),
  ];

  const checks: RiskCheck[] = run.map((check, index) => {
    const id = index + 1;
    const [key, label] = CHECK_LABELS[index]!;
    if (stage === "pre_trade" && id >= FIRST_QUOTE_CHECK) return { id, key, label, status: "pending", detail: "Checked on a fresh quote, immediately before execution" };
    let verdict: Verdict;
    try {
      verdict = check();
    } catch {
      // A check that cannot finish has not passed.
      verdict = fail("This check could not be completed");
    }
    return typeof verdict === "string" ? { id, key, label, status: "pass", detail: verdict } : { id, key, label, status: "fail", detail: verdict.fail };
  });

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const required = stage === "final" ? checks.length : FIRST_QUOTE_CHECK - 1;
  const plannedLossUsd = ok(stopLossPercent) && ok(inputs.proposal.requestedUsd) ? (inputs.proposal.requestedUsd * stopLossPercent) / 100 : null;
  return { stage, approved: failed === 0 && passed === required, passed, failed, total: checks.length, checks, stopLossPercent, takeProfitPercent, plannedLossUsd };
}

/** The first failed check in words, for the decision log and notifications. */
export function rejectionSummary(result: RiskResult): string {
  const failed = result.checks.filter((check) => check.status === "fail");
  if (failed.length === 0) return "";
  const [first] = failed;
  return failed.length === 1 ? `${first!.label}: ${first!.detail}` : `${first!.label}: ${first!.detail} (and ${failed.length - 1} more)`;
}

/** Weekday and hour in a timezone, for the trading-hours rule. */
export function localClock(now: number, timezone: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return { day: day === -1 ? NaN : day, hour };
  } catch {
    return { day: NaN, hour: NaN };
  }
}

type AgentState = Pick<RiskInputs, "now" | "clock" | "mandate" | "agent" | "portfolio">;

const NO_PROPOSAL: RiskProposal = { action: "BUY", assetAddress: "", symbol: "", requestedUsd: 0, stopLossPercent: null, takeProfitPercent: null };

/**
 * Why no new position could be opened right now, whatever the model proposed,
 * or null when one could. Used before the model is called, so a cycle that
 * cannot trade costs no credits. It runs the same checks the engine runs later.
 */
export function entryBlocker(state: AgentState): string | null {
  const inputs: RiskInputs = { ...state, proposal: NO_PROPOSAL, market: null, quote: null };
  const gates: Array<[string, () => Verdict]> = [
    ["Trading enabled", () => tradingEnabled(inputs)],
    ["Open-position limit", () => openPositions(inputs)],
    ["Trade-frequency limit", () => tradeFrequency(inputs)],
    ["Daily loss limit", () => dailyLoss(inputs)],
    ["Drawdown limit", () => drawdown(inputs)],
    ["Consecutive-loss breaker", () => consecutiveLosses(inputs)],
  ];
  for (const [label, gate] of gates) {
    let verdict: Verdict;
    try {
      verdict = gate();
    } catch {
      verdict = fail("This check could not be completed");
    }
    if (typeof verdict !== "string") return `${label}: ${verdict.fail}`;
  }
  if (!ok(state.portfolio.availableUsd) || state.portfolio.availableUsd < 1) return "Allocation available: no capital is free for a new position";
  return null;
}

/** Why an asset fails the mandate's liquidity and market filters, or null when it passes. */
export function marketFilterFailure(mandate: Mandate, market: RiskMarket | null, now: number): string | null {
  const verdict = marketFilters({ mandate, market, now } as RiskInputs);
  return typeof verdict === "string" ? null : verdict.fail;
}
