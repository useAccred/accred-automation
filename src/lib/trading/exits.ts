import type { Mandate } from "./mandate";

/**
 * Protective exit rules. Pure and model-free: the position monitor calls this
 * for every open position on every tick, whether or not any model is reachable.
 */

export type ExitRules = Pick<Mandate, "trailingStopPercent" | "breakEvenTriggerPercent" | "partialTakeProfitPercent" | "partialTakeProfitFraction">;

export interface MonitoredPosition {
  entryPriceUsd: number;
  stopLossPrice: number;
  initialStopLossPrice: number;
  takeProfitPrice: number | null;
  highestPriceUsd: number;
  breakEvenMoved: boolean;
  partialTaken: boolean;
  /** Milliseconds, or null when the position has no time limit. */
  expiresAt: number | null;
}

export type ExitTrigger = "stop_loss" | "take_profit" | "trailing_stop" | "partial_take_profit" | "timeout";

export interface ExitDecision {
  /** The stop after any break-even or trailing move. It only ever moves up. */
  stopLossPrice: number;
  highestPriceUsd: number;
  breakEvenMoved: boolean;
  /** `fraction` is the share of what is still held to sell: 1 closes the position. */
  exit: { reason: ExitTrigger; fraction: number } | null;
}

export function decideExit(position: MonitoredPosition, priceUsd: number, rules: ExitRules, now: number): ExitDecision {
  const keep = { stopLossPrice: position.stopLossPrice, highestPriceUsd: position.highestPriceUsd, breakEvenMoved: position.breakEvenMoved };
  // Without a usable price nothing can be decided; the caller treats the position as stale.
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ...keep, exit: null };

  // The stop set on earlier ticks is tested first, before this tick can raise it.
  if (priceUsd <= position.stopLossPrice) {
    const trailed = rules.trailingStopPercent > 0 && position.stopLossPrice > Math.max(position.initialStopLossPrice, position.entryPriceUsd);
    return { ...keep, exit: { reason: trailed ? "trailing_stop" : "stop_loss", fraction: 1 } };
  }
  if (position.expiresAt !== null && now >= position.expiresAt) return { ...keep, exit: { reason: "timeout", fraction: 1 } };
  if (position.takeProfitPrice !== null && priceUsd >= position.takeProfitPrice) return { ...keep, exit: { reason: "take_profit", fraction: 1 } };

  const highestPriceUsd = Math.max(position.highestPriceUsd, priceUsd);
  let stopLossPrice = position.stopLossPrice;
  let breakEvenMoved = position.breakEvenMoved;

  if (!breakEvenMoved && rules.breakEvenTriggerPercent > 0 && priceUsd >= position.entryPriceUsd * (1 + rules.breakEvenTriggerPercent / 100)) {
    stopLossPrice = Math.max(stopLossPrice, position.entryPriceUsd);
    breakEvenMoved = true;
  }
  if (rules.trailingStopPercent > 0) {
    stopLossPrice = Math.max(stopLossPrice, highestPriceUsd * (1 - rules.trailingStopPercent / 100));
  }

  const partialAt = position.entryPriceUsd * (1 + rules.partialTakeProfitPercent / 100);
  if (!position.partialTaken && rules.partialTakeProfitPercent > 0 && rules.partialTakeProfitFraction > 0 && priceUsd >= partialAt) {
    // Taking part of the profit also moves the stop to the entry price, so the rest cannot turn into a loss.
    return {
      stopLossPrice: Math.max(stopLossPrice, position.entryPriceUsd),
      highestPriceUsd,
      breakEvenMoved: true,
      exit: { reason: "partial_take_profit", fraction: Math.min(0.9, rules.partialTakeProfitFraction / 100) },
    };
  }
  return { stopLossPrice, highestPriceUsd, breakEvenMoved, exit: null };
}
