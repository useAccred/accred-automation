import type { MarketSnapshot } from "./market-data";
import type { RiskQuote } from "./risk-engine";

/**
 * Paper Mode quotes and fills. Nothing here signs or sends anything: a fill is
 * modelled from the pool's depth, with the same fee and slippage a real swap
 * would pay, so paper results are not flattered.
 */

/** Pool fee assumed for a paper swap. The most common Uniswap tier for volatile pairs. */
export const PAPER_SWAP_FEE_PERCENT = 0.3;
/** A paper fill larger than this share of the pool's depth is treated as a failed simulation. */
const MAX_SIMULATED_IMPACT_PERCENT = 25;

export interface PaperQuote extends RiskQuote {
  side: "buy" | "sell";
  midPriceUsd: number;
  quantity: number;
  notionalUsd: number;
  swapFeeUsd: number;
  marketFetchedAt: number;
  pairAddress: string;
  kind: "paper-model";
}

/**
 * Price impact of trading `notionalUsd` against a pool holding `liquidityUsd`
 * across both sides, as a constant-product pool would move. Concentrated
 * liquidity usually moves less, so this errs on the costly side.
 */
export function priceImpactPercent(notionalUsd: number, liquidityUsd: number): number {
  if (!(liquidityUsd > 0) || !(notionalUsd >= 0)) return NaN;
  return (notionalUsd / (liquidityUsd / 2)) * 100;
}

export function paperQuote(input: {
  side: "buy" | "sell";
  market: MarketSnapshot | null;
  /** Buys: dollars to spend. */
  notionalUsd?: number;
  /** Sells: quantity to sell. */
  quantity?: number;
  /** Null when the fee could not be determined; the fee check then fails. */
  networkFeeUsd: number | null;
  now: number;
}): PaperQuote {
  const { side, market, now } = input;
  const mid = market?.priceUsd ?? NaN;
  const notionalUsd = side === "buy" ? (input.notionalUsd ?? NaN) : (input.quantity ?? NaN) * mid;
  const impact = market ? priceImpactPercent(notionalUsd, market.liquidityUsd) : NaN;
  const priceUsd = side === "buy" ? mid * (1 + impact / 100) : mid * (1 - impact / 100);
  const quantity = side === "buy" ? notionalUsd / priceUsd : (input.quantity ?? NaN);
  const filledUsd = side === "buy" ? notionalUsd : quantity * priceUsd;

  let simulation: { ok: boolean; detail: string };
  if (!market) simulation = { ok: false, detail: "No pool was found for this asset" };
  else if (![mid, notionalUsd, impact, priceUsd, quantity].every(Number.isFinite) || mid <= 0 || quantity <= 0 || priceUsd <= 0) {
    simulation = { ok: false, detail: "The fill could not be modelled from the pool's data" };
  } else if (impact > MAX_SIMULATED_IMPACT_PERCENT) {
    simulation = { ok: false, detail: `The trade is too large for the pool: it would move the price ${impact.toFixed(1)}%` };
  } else {
    simulation = { ok: true, detail: `Paper fill modelled against $${Math.round(market.liquidityUsd).toLocaleString("en-US")} of pool depth` };
  }

  return {
    side,
    kind: "paper-model",
    midPriceUsd: mid,
    priceUsd,
    quantity,
    notionalUsd: filledUsd,
    priceImpactPercent: impact,
    // With no competing orders in the model, expected slippage is the price impact itself.
    slippagePercent: impact,
    swapFeeUsd: (filledUsd * PAPER_SWAP_FEE_PERCENT) / 100,
    networkFeeUsd: input.networkFeeUsd ?? NaN,
    quotedAt: now,
    marketFetchedAt: market?.fetchedAt ?? 0,
    pairAddress: market?.pairAddress ?? "",
    simulation,
  };
}

/** No modelled exit fills worse than this far below the market price. */
const MAX_EXIT_IMPACT_PERCENT = 90;

/**
 * A fill for a protective exit. An exit must not be refused, so where a buy
 * would fail its simulation the exit still fills, at a punishing price: the
 * modelled impact when the pool is too thin for the size, or an assumed 25%
 * when the pool's depth is unknown.
 */
export function paperExitFill(market: MarketSnapshot, quantity: number, networkFeeUsd: number | null, now: number): PaperQuote {
  const quote = paperQuote({ side: "sell", market, quantity, networkFeeUsd, now });
  if (quote.simulation.ok) return { ...quote, networkFeeUsd: Number.isFinite(quote.networkFeeUsd) ? quote.networkFeeUsd : 0 };
  const known = Number.isFinite(quote.priceImpactPercent) && quote.priceImpactPercent > 0;
  const impact = known ? Math.min(MAX_EXIT_IMPACT_PERCENT, quote.priceImpactPercent) : MAX_SIMULATED_IMPACT_PERCENT;
  const priceUsd = market.priceUsd * (1 - impact / 100);
  const filledUsd = quantity * priceUsd;
  return {
    ...quote,
    priceUsd,
    notionalUsd: filledUsd,
    priceImpactPercent: impact,
    slippagePercent: impact,
    swapFeeUsd: (filledUsd * PAPER_SWAP_FEE_PERCENT) / 100,
    networkFeeUsd: networkFeeUsd ?? 0,
    simulation: {
      ok: true,
      detail: known
        ? `The exit is large for the pool: filled ${impact.toFixed(1)}% below the market price`
        : "Pool depth unknown: exit filled at an assumed 25% below the market price",
    },
  };
}
