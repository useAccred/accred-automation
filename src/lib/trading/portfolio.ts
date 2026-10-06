import type { Mandate } from "./mandate";

/**
 * Portfolio accounting for one agent, computed from its positions and fills.
 * Pure functions: the same numbers feed the risk engine, the circuit breakers
 * and the dashboard.
 */

export interface PortfolioPosition {
  status: "open" | "closed";
  assetAddress: string;
  quantity: number;
  entryPriceUsd: number;
  lastPriceUsd: number;
  realizedPnlUsd: number;
  feesUsd: number;
  closedAt: Date | null;
}

export interface PortfolioFill {
  side: "buy" | "sell";
  status: "filled" | "failed";
  createdAt: Date;
  swapFeeUsd: number;
  networkFeeUsd: number;
  realizedPnlUsd: number;
}

export interface PortfolioState {
  allocationUsd: number;
  reserveUsd: number;
  /** Capital not in a position and not held in reserve. Never more than the allocation. */
  availableUsd: number;
  /** Open positions at entry cost. */
  openCostUsd: number;
  openValueUsd: number;
  openPositions: number;
  openAssets: string[];
  /** Closed gains and losses after every fee. */
  realizedNetUsd: number;
  realizedGrossUsd: number;
  feesUsd: number;
  unrealizedUsd: number;
  equityUsd: number;
  peakEquityUsd: number;
  drawdownPercent: number;
  /** Today's result after fees, including open positions at their last price. */
  dayNetUsd: number;
  dailyLossUsd: number;
  tradesToday: number;
  tradesLastHour: number;
  lastTradeAt: number | null;
  consecutiveLosses: number;
  lastLossAt: number | null;
}

/** Milliseconds since local midnight at an instant, by the wall clock of a timezone. */
function sinceMidnight(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return (read("hour") * 3600 + read("minute") * 60 + read("second")) * 1000 + (((instant % 1000) + 1000) % 1000);
}

/** The instant the current calendar day began in a timezone. */
export function dayStart(now: number, timezone: string): number {
  try {
    let start = now - sinceMidnight(now, timezone);
    // On a day the clocks change, the wall clock and elapsed time disagree by the shift. Land on local midnight exactly.
    const off = sinceMidnight(start, timezone);
    if (off !== 0) start += off > 43_200_000 ? 86_400_000 - off : -off;
    return Number.isFinite(start) ? start : now - (now % 86_400_000);
  } catch {
    return now - (now % 86_400_000);
  }
}

export function computePortfolio(input: {
  mandate: Pick<Mandate, "agentAllocationUsd" | "reserveUsd">;
  timezone: string;
  now: number;
  positions: PortfolioPosition[];
  /** Fills from at least the start of today and the last hour. */
  fills: PortfolioFill[];
  /** The stored high-water mark, if the monitor has recorded one. */
  peakEquityUsd: number | null;
  /** Losses before this moment do not count toward the loss streak (set when the user resumes after a breaker). */
  streakResetAt: Date | null;
}): PortfolioState {
  const { mandate, now } = input;
  const allocationUsd = mandate.agentAllocationUsd;
  const open = input.positions.filter((position) => position.status === "open");
  const closed = input.positions.filter((position) => position.status === "closed");

  const openCostUsd = open.reduce((total, position) => total + position.quantity * position.entryPriceUsd, 0);
  const openValueUsd = open.reduce((total, position) => total + position.quantity * position.lastPriceUsd, 0);
  const realizedGrossUsd = input.positions.reduce((total, position) => total + position.realizedPnlUsd, 0);
  const feesUsd = input.positions.reduce((total, position) => total + position.feesUsd, 0);
  const realizedNetUsd = realizedGrossUsd - feesUsd;
  const unrealizedUsd = openValueUsd - openCostUsd;
  const equityUsd = allocationUsd + realizedNetUsd + unrealizedUsd;

  // Losses shrink what can be deployed. Profits are not redeployed: the agent never trades more than its allocation.
  const capitalUsd = Math.min(allocationUsd, allocationUsd + realizedNetUsd);
  const availableUsd = Math.max(0, capitalUsd - openCostUsd - mandate.reserveUsd);

  const peakEquityUsd = Math.max(input.peakEquityUsd ?? allocationUsd, equityUsd);
  const drawdownPercent = peakEquityUsd > 0 ? Math.max(0, ((peakEquityUsd - equityUsd) / peakEquityUsd) * 100) : NaN;

  const startOfDay = dayStart(now, input.timezone);
  const filled = input.fills.filter((fill) => fill.status === "filled");
  const today = filled.filter((fill) => fill.createdAt.getTime() >= startOfDay);
  const realizedToday = today.reduce((total, fill) => total + fill.realizedPnlUsd - fill.swapFeeUsd - fill.networkFeeUsd, 0);
  const dayNetUsd = realizedToday + unrealizedUsd;
  const buys = filled.filter((fill) => fill.side === "buy");
  const lastTradeAt = buys.reduce<number | null>((latest, fill) => Math.max(latest ?? 0, fill.createdAt.getTime()), null);

  // The streak counts closed positions, newest first, until one that did not lose.
  const resetAt = input.streakResetAt?.getTime() ?? 0;
  const recent = closed
    .filter((position) => position.closedAt !== null && position.closedAt.getTime() > resetAt)
    .sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime());
  let consecutiveLosses = 0;
  for (const position of recent) {
    if (position.realizedPnlUsd - position.feesUsd < 0) consecutiveLosses++;
    else break;
  }
  const lastLoss = closed
    .filter((position) => position.closedAt !== null && position.realizedPnlUsd - position.feesUsd < 0)
    .reduce<number | null>((latest, position) => Math.max(latest ?? 0, position.closedAt!.getTime()), null);

  return {
    allocationUsd,
    reserveUsd: mandate.reserveUsd,
    availableUsd,
    openCostUsd,
    openValueUsd,
    openPositions: open.length,
    openAssets: open.map((position) => position.assetAddress),
    realizedNetUsd,
    realizedGrossUsd,
    feesUsd,
    unrealizedUsd,
    equityUsd,
    peakEquityUsd,
    drawdownPercent,
    dayNetUsd,
    dailyLossUsd: Math.max(0, -dayNetUsd),
    tradesToday: buys.filter((fill) => fill.createdAt.getTime() >= startOfDay).length,
    tradesLastHour: buys.filter((fill) => fill.createdAt.getTime() >= now - 3_600_000).length,
    lastTradeAt,
    consecutiveLosses,
    lastLossAt: lastLoss,
  };
}

export interface BreakerHealth {
  /** Simulations that failed in a row. */
  simulationFailures: number;
  /** Market-data requests that failed in a row. */
  dataFailures: number;
  /** How long the oldest open position has gone without a price, in milliseconds. */
  oldestPriceAgeMs: number;
  /** Largest slippage on a recent fill, as a percentage. */
  worstRecentSlippagePercent: number;
}

export const BREAKER_LIMITS = {
  simulationFailures: 3,
  dataFailures: 3,
  stalePriceMs: 5 * 60_000,
  /** A fill this many times worse than the mandate's slippage limit counts as abnormal. */
  slippageMultiple: 2,
};

/**
 * Whether new trading must pause, and why. Runs in the position monitor on every
 * tick, with no model involved. A value that cannot be determined trips the breaker.
 */
export function checkBreakers(mandate: Mandate, portfolio: PortfolioState, health: BreakerHealth): string | null {
  const finite = (value: number) => Number.isFinite(value);
  if (![portfolio.dailyLossUsd, portfolio.drawdownPercent, portfolio.equityUsd, portfolio.consecutiveLosses, portfolio.availableUsd, portfolio.openCostUsd].every(finite)) {
    return "The portfolio state could not be determined";
  }
  if (![health.simulationFailures, health.dataFailures, health.oldestPriceAgeMs, health.worstRecentSlippagePercent].every(finite)) {
    return "The agent's health could not be determined";
  }
  const dailyLimit = (mandate.agentAllocationUsd * mandate.dailyLossLimitPercent) / 100;
  if (portfolio.dailyLossUsd >= dailyLimit) return `Daily loss limit reached: down $${portfolio.dailyLossUsd.toFixed(2)} today, limit $${dailyLimit.toFixed(2)}`;
  if (portfolio.drawdownPercent >= mandate.maxDrawdownPercent) {
    return `Drawdown limit reached: ${portfolio.drawdownPercent.toFixed(2)}% below the peak, limit ${mandate.maxDrawdownPercent}%`;
  }
  if (portfolio.consecutiveLosses >= mandate.maxConsecutiveLosses) return `${portfolio.consecutiveLosses} losing trades in a row, limit ${mandate.maxConsecutiveLosses}`;
  // Exposure above the allocation should be impossible; if it is seen, stop.
  if (portfolio.openCostUsd > mandate.agentAllocationUsd * 1.0001) return "Open exposure is above the allocation: inconsistent state";
  if (health.oldestPriceAgeMs > BREAKER_LIMITS.stalePriceMs) return "Market data is stale: an open position has had no price for over 5 minutes";
  if (health.dataFailures >= BREAKER_LIMITS.dataFailures) return "The market data provider keeps failing";
  if (health.simulationFailures >= BREAKER_LIMITS.simulationFailures) return "Simulations keep failing";
  if (health.worstRecentSlippagePercent > mandate.maxSlippagePercent * BREAKER_LIMITS.slippageMultiple) {
    return `Abnormal slippage: a recent fill slipped ${health.worstRecentSlippagePercent.toFixed(2)}%`;
  }
  return null;
}

export interface PaperStats {
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
  averageWinUsd: number | null;
  averageLossUsd: number | null;
  /** Average win divided by average loss. */
  realizedRiskReward: number | null;
}

export function tradeStats(closed: Array<{ realizedPnlUsd: number; feesUsd: number }>): PaperStats {
  const results = closed.map((position) => position.realizedPnlUsd - position.feesUsd);
  const wins = results.filter((result) => result > 0);
  const losses = results.filter((result) => result < 0);
  const average = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
  const averageWinUsd = average(wins);
  const averageLoss = average(losses);
  return {
    closedTrades: results.length,
    wins: wins.length,
    losses: losses.length,
    winRatePercent: results.length ? (wins.length / results.length) * 100 : null,
    averageWinUsd,
    averageLossUsd: averageLoss === null ? null : -averageLoss,
    realizedRiskReward: averageWinUsd !== null && averageLoss !== null && averageLoss !== 0 ? averageWinUsd / -averageLoss : null,
  };
}
