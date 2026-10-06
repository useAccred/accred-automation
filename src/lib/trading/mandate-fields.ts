import type { Mandate } from "./mandate";

/** Labels and help text for every number in the mandate, grouped as the form and the dashboard show them. */

type NumericKey = { [Key in keyof Mandate]: Mandate[Key] extends number ? Key : never }[keyof Mandate];

export interface MandateField {
  key: NumericKey;
  label: string;
  unit: "$" | "%" | "min" | "h" | "s" | "×" | "";
  hint: string;
}

export const MANDATE_GROUPS: Array<{ id: string; title: string; blurb: string; fields: MandateField[] }> = [
  {
    id: "capital",
    title: "Capital",
    blurb: "How much the agent may deploy, in total and per position.",
    fields: [
      { key: "maxPositionUsd", label: "Largest position", unit: "$", hint: "No single position may be opened above this." },
      { key: "maxPositionPercent", label: "Largest position", unit: "%", hint: "Of the allocation. The lower of the two caps applies." },
      { key: "maxTotalExposurePercent", label: "Total open exposure", unit: "%", hint: "Of the allocation, across all open positions." },
      { key: "maxOpenPositions", label: "Open positions at once", unit: "", hint: "One position per asset." },
      { key: "reserveUsd", label: "Untouchable reserve", unit: "$", hint: "Part of the allocation that is never deployed." },
    ],
  },
  {
    id: "loss",
    title: "Loss",
    blurb: "When the agent must stop. Reaching any of these pauses new trading automatically.",
    fields: [
      { key: "maxLossPerTradePercent", label: "Largest loss per trade", unit: "%", hint: "Of the allocation: position size times stop distance." },
      { key: "dailyLossLimitPercent", label: "Daily loss limit", unit: "%", hint: "Of the allocation, including open positions." },
      { key: "maxDrawdownPercent", label: "Maximum drawdown", unit: "%", hint: "Fall from the highest equity reached." },
      { key: "maxConsecutiveLosses", label: "Losses in a row", unit: "", hint: "Pauses after this many losing trades in a row." },
      { key: "cooldownAfterLossMinutes", label: "Cooldown after a loss", unit: "min", hint: "No new position for this long after a losing trade." },
    ],
  },
  {
    id: "position",
    title: "Position",
    blurb: "How each position is protected. The monitor enforces these, with or without the model.",
    fields: [
      { key: "defaultStopLossPercent", label: "Default stop loss", unit: "%", hint: "Below the entry price." },
      { key: "maxStopLossPercent", label: "Widest stop loss", unit: "%", hint: "A proposal with a wider stop is rejected." },
      { key: "defaultTakeProfitPercent", label: "Default take profit", unit: "%", hint: "Above the entry price." },
      { key: "minimumRiskReward", label: "Minimum risk/reward", unit: "×", hint: "Take profit divided by stop loss." },
      { key: "trailingStopPercent", label: "Trailing stop", unit: "%", hint: "Follows the highest price. 0 turns it off." },
      { key: "breakEvenTriggerPercent", label: "Break-even trigger", unit: "%", hint: "Gain at which the stop moves to the entry price. 0 turns it off." },
      { key: "partialTakeProfitPercent", label: "Partial profit at", unit: "%", hint: "Gain at which part is sold and the stop moves to entry. 0 turns it off." },
      { key: "partialTakeProfitFraction", label: "Partial profit size", unit: "%", hint: "Share of the position sold at the partial target." },
      { key: "maxPositionLifetimeHours", label: "Longest time in a position", unit: "h", hint: "Closed at market after this long. 0 means no limit." },
    ],
  },
  {
    id: "execution",
    title: "Execution",
    blurb: "What a trade must look like at the moment it is made.",
    fields: [
      { key: "maxSlippagePercent", label: "Slippage allowed", unit: "%", hint: "Expected fill price against the market price." },
      { key: "maxPriceImpactPercent", label: "Price impact allowed", unit: "%", hint: "How far the trade itself may move the pool." },
      { key: "minimumLiquidityUsd", label: "Minimum liquidity", unit: "$", hint: "In the asset's deepest pool." },
      { key: "minimumMarketCapUsd", label: "Minimum market cap", unit: "$", hint: "0 turns this filter off." },
      { key: "minimumTokenAgeHours", label: "Minimum token age", unit: "h", hint: "Since its deepest pool was created. 0 turns this filter off." },
      { key: "maxNetworkFeeUsd", label: "Network fee allowed", unit: "$", hint: "Per transaction." },
      { key: "quoteExpirySeconds", label: "Quote lifetime", unit: "s", hint: "A quote older than this is thrown away, not traded." },
    ],
  },
  {
    id: "time",
    title: "Frequency",
    blurb: "How often the agent may trade.",
    fields: [
      { key: "maxTradesPerHour", label: "Trades per hour", unit: "", hint: "New positions only." },
      { key: "maxTradesPerDay", label: "Trades per day", unit: "", hint: "New positions only." },
      { key: "cooldownBetweenTradesMinutes", label: "Cooldown between trades", unit: "min", hint: "After any new position." },
    ],
  },
];

export const NUMERIC_KEYS: NumericKey[] = ["agentAllocationUsd", ...MANDATE_GROUPS.flatMap((group) => group.fields.map((field) => field.key))];

const LABELS = new Map<string, string>([
  ["agentAllocationUsd", "Agent allocation"],
  ["allowedAssets", "Assets"],
  ["blockedAssets", "Blocklist"],
  ["tradingHours", "Trading hours"],
  ...MANDATE_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field.label] as [string, string])),
]);

export function mandateLabel(key: string): string {
  return LABELS.get(key) ?? key;
}

export function formatMandateValue(field: MandateField, value: number): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (field.unit === "$") return `$${text}`;
  if (field.unit === "") return text;
  if (field.unit === "×") return `${text}×`;
  if (field.unit === "%") return `${text}%`;
  return `${text} ${field.unit}`;
}

export const INTERVALS = [
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 1440, label: "Once a day" },
] as const;

export function intervalLabel(minutes: number): string {
  return INTERVALS.find((interval) => interval.minutes === minutes)?.label ?? `Every ${minutes} minutes`;
}
