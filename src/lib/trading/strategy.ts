import type { MarketSnapshot } from "./market-data";

/** Structured strategies. Each one is a cheap, deterministic screen that runs before the model is asked anything. */

export const STRATEGIES = {
  momentum: {
    label: "Momentum",
    blurb: "Price rising over the last hour and the last six.",
    rule: "1h change of at least +1% and 6h change above zero",
  },
  breakout: {
    label: "Breakout",
    blurb: "A sharp move in the last hour on real volume.",
    rule: "1h change of at least +3% and the last hour's volume above the 24h hourly average",
  },
  trend_following: {
    label: "Trend following",
    blurb: "Up over a day and still up over six hours.",
    rule: "24h change of at least +2% and 6h change above zero",
  },
  mean_reversion: {
    label: "Mean reversion",
    blurb: "A sharp dip in an asset that is not in free fall.",
    rule: "1h change of -3% or lower while the 24h change is above -15%",
  },
  volume_expansion: {
    label: "Volume expansion",
    blurb: "Trading volume well above its recent average.",
    rule: "the last hour's volume at least twice the 24h hourly average",
  },
} as const;

export type StrategyKind = keyof typeof STRATEGIES;

export const STRATEGY_KINDS = Object.keys(STRATEGIES) as StrategyKind[];

export function isStrategyKind(value: string): value is StrategyKind {
  return value in STRATEGIES;
}

type Signals = Pick<MarketSnapshot, "priceChangeH1" | "priceChangeH6" | "priceChangeH24" | "volumeH1" | "volumeH24">;

/** True when the last hour traded more than `multiple` times the day's hourly average. */
function volumeAbove(market: Signals, multiple: number): boolean {
  if (market.volumeH1 === null || market.volumeH24 === null || market.volumeH24 <= 0) return false;
  return market.volumeH1 >= (market.volumeH24 / 24) * multiple;
}

const SCREENS: Record<StrategyKind, (market: Signals) => boolean> = {
  momentum: (m) => (m.priceChangeH1 ?? -Infinity) >= 1 && (m.priceChangeH6 ?? -Infinity) > 0,
  breakout: (m) => (m.priceChangeH1 ?? -Infinity) >= 3 && volumeAbove(m, 1),
  trend_following: (m) => (m.priceChangeH24 ?? -Infinity) >= 2 && (m.priceChangeH6 ?? -Infinity) > 0,
  mean_reversion: (m) => (m.priceChangeH1 ?? Infinity) <= -3 && (m.priceChangeH24 ?? -Infinity) > -15,
  volume_expansion: (m) => volumeAbove(m, 2),
};

/** The strategies whose screen this asset passes right now. Missing data never counts as a signal. */
export function matchingStrategies(kinds: StrategyKind[], market: Signals): StrategyKind[] {
  return kinds.filter((kind) => SCREENS[kind](market));
}
