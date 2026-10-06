import { z } from "zod";

/**
 * The trading mandate: the limits a user gives an agent. The risk engine and
 * the position monitor enforce every field; nothing the model says can change one.
 * Kept free of server imports so the form can use it in the browser.
 */

export const NETWORK = "robinhood-chain";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Use a 0x token address.")
  .transform((value) => value.toLowerCase());

const AssetSchema = z.object({
  address,
  symbol: z
    .string()
    .max(40)
    // Symbols come from outside. Keep only characters that cannot carry markup or instructions.
    .transform((value) => value.replace(/[^A-Za-z0-9._$-]/g, "").slice(0, 16) || "TOKEN"),
});

// No coercion: an empty field must fail validation, not quietly become zero.
const usd = (max: number) => z.number().finite().min(0).max(max);
const percent = (max = 100) => z.number().finite().min(0).max(max);
const count = (max: number) => z.number().int().min(0).max(max);

export const MandateSchema = z
  .object({
    mode: z.enum(["paper", "live"]),
    tradingEnabled: z.boolean(),
    allowedNetwork: z.literal(NETWORK),

    // Capital
    agentAllocationUsd: usd(1_000_000).min(10, "Allocate at least $10."),
    reserveUsd: usd(1_000_000),
    maxPositionUsd: usd(1_000_000).min(1, "The largest position must be at least $1."),
    maxPositionPercent: percent().min(0.1),
    maxTotalExposurePercent: percent().min(1),
    maxOpenPositions: count(50).min(1),

    // Loss
    maxLossPerTradePercent: percent().min(0.01),
    dailyLossLimitPercent: percent().min(0.1),
    maxDrawdownPercent: percent().min(0.1),
    maxConsecutiveLosses: count(50).min(1),
    cooldownAfterLossMinutes: count(10_080),

    // Position
    stopLossRequired: z.boolean(),
    defaultStopLossPercent: percent(90).min(0.1),
    maxStopLossPercent: percent(90).min(0.1),
    defaultTakeProfitPercent: percent(1000).min(0.1),
    minimumRiskReward: z.number().finite().min(0).max(50),
    trailingStopPercent: percent(90),
    breakEvenTriggerPercent: percent(1000),
    partialTakeProfitPercent: percent(1000),
    partialTakeProfitFraction: percent(90),
    maxPositionLifetimeHours: count(8760),

    // Execution
    maxSlippagePercent: percent(50).min(0.01),
    maxPriceImpactPercent: percent(50).min(0.01),
    minimumLiquidityUsd: usd(1_000_000_000),
    minimumMarketCapUsd: usd(1_000_000_000_000),
    minimumTokenAgeHours: count(87_600),
    maxNetworkFeeUsd: usd(1000).min(0.01),
    quoteExpirySeconds: count(300).min(5),

    // Assets and time
    allowedAssets: z.array(AssetSchema).max(30),
    blockedAssets: z.array(address).max(100),
    maxTradesPerHour: count(60).min(1),
    maxTradesPerDay: count(500).min(1),
    cooldownBetweenTradesMinutes: count(10_080),
    tradingHours: z.object({
      enabled: z.boolean(),
      /** Hours of the day in the agent's timezone, 0 to 23. The window may wrap past midnight. */
      startHour: count(23),
      endHour: count(23),
      /** 0 is Sunday. */
      days: z.array(count(6)).max(7),
    }),
  })
  .strict()
  .superRefine((mandate, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (mandate.reserveUsd >= mandate.agentAllocationUsd) issue("reserveUsd", "The reserve must be smaller than the allocation.");
    if (mandate.maxPositionUsd > mandate.agentAllocationUsd) issue("maxPositionUsd", "The largest position cannot exceed the allocation.");
    if (mandate.defaultStopLossPercent > mandate.maxStopLossPercent) issue("defaultStopLossPercent", "The default stop loss cannot be wider than the maximum stop loss.");
    if (mandate.maxTradesPerHour > mandate.maxTradesPerDay) issue("maxTradesPerHour", "Trades per hour cannot exceed trades per day.");
    if (mandate.partialTakeProfitPercent > 0 && mandate.partialTakeProfitFraction <= 0) {
      issue("partialTakeProfitFraction", "Say how much of the position to sell at the partial profit target.");
    }
    if (mandate.tradingHours.enabled && mandate.tradingHours.days.length === 0) issue("tradingHours", "Pick at least one trading day.");
    const blocked = new Set(mandate.blockedAssets);
    if (mandate.allowedAssets.some((asset) => blocked.has(asset.address))) issue("blockedAssets", "An asset cannot be both allowed and blocked.");
    if (new Set(mandate.allowedAssets.map((asset) => asset.address)).size !== mandate.allowedAssets.length) {
      issue("allowedAssets", "The same asset is listed twice.");
    }
  });

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateAsset = Mandate["allowedAssets"][number];

export type RiskProfile = "conservative" | "balanced" | "aggressive" | "custom";

type PresetFields = Omit<Mandate, "mode" | "tradingEnabled" | "allowedNetwork" | "agentAllocationUsd" | "reserveUsd" | "maxPositionUsd" | "allowedAssets" | "blockedAssets" | "tradingHours">;

/**
 * Presets only fill in the visible mandate. There are no rules behind a preset
 * that the form does not show.
 */
export const PRESETS: Record<Exclude<RiskProfile, "custom">, { label: string; blurb: string; fields: PresetFields }> = {
  conservative: {
    label: "Conservative",
    blurb: "Small positions, tight stops, deep liquidity only.",
    fields: {
      maxPositionPercent: 5,
      maxTotalExposurePercent: 20,
      maxOpenPositions: 2,
      maxLossPerTradePercent: 0.5,
      dailyLossLimitPercent: 2,
      maxDrawdownPercent: 5,
      maxConsecutiveLosses: 2,
      cooldownAfterLossMinutes: 60,
      stopLossRequired: true,
      defaultStopLossPercent: 1.5,
      maxStopLossPercent: 3,
      defaultTakeProfitPercent: 4,
      minimumRiskReward: 2.5,
      trailingStopPercent: 0,
      breakEvenTriggerPercent: 2,
      partialTakeProfitPercent: 0,
      partialTakeProfitFraction: 50,
      maxPositionLifetimeHours: 24,
      maxSlippagePercent: 0.5,
      maxPriceImpactPercent: 0.5,
      minimumLiquidityUsd: 250_000,
      minimumMarketCapUsd: 5_000_000,
      minimumTokenAgeHours: 168,
      maxNetworkFeeUsd: 0.5,
      quoteExpirySeconds: 20,
      maxTradesPerHour: 1,
      maxTradesPerDay: 4,
      cooldownBetweenTradesMinutes: 30,
    },
  },
  balanced: {
    label: "Balanced",
    blurb: "Moderate positions with a 2% stop and a 5% target.",
    fields: {
      maxPositionPercent: 10,
      maxTotalExposurePercent: 30,
      maxOpenPositions: 3,
      maxLossPerTradePercent: 2,
      dailyLossLimitPercent: 5,
      maxDrawdownPercent: 10,
      maxConsecutiveLosses: 3,
      cooldownAfterLossMinutes: 30,
      stopLossRequired: true,
      defaultStopLossPercent: 2,
      maxStopLossPercent: 5,
      defaultTakeProfitPercent: 5,
      minimumRiskReward: 2,
      trailingStopPercent: 0,
      breakEvenTriggerPercent: 0,
      partialTakeProfitPercent: 0,
      partialTakeProfitFraction: 50,
      maxPositionLifetimeHours: 72,
      maxSlippagePercent: 1,
      maxPriceImpactPercent: 1,
      minimumLiquidityUsd: 50_000,
      minimumMarketCapUsd: 1_000_000,
      minimumTokenAgeHours: 72,
      maxNetworkFeeUsd: 1,
      quoteExpirySeconds: 30,
      maxTradesPerHour: 2,
      maxTradesPerDay: 8,
      cooldownBetweenTradesMinutes: 10,
    },
  },
  aggressive: {
    label: "Aggressive",
    blurb: "Larger positions, wider stops, thinner markets allowed.",
    fields: {
      maxPositionPercent: 20,
      maxTotalExposurePercent: 60,
      maxOpenPositions: 5,
      maxLossPerTradePercent: 4,
      dailyLossLimitPercent: 10,
      maxDrawdownPercent: 20,
      maxConsecutiveLosses: 4,
      cooldownAfterLossMinutes: 15,
      stopLossRequired: true,
      defaultStopLossPercent: 4,
      maxStopLossPercent: 10,
      defaultTakeProfitPercent: 10,
      minimumRiskReward: 1.5,
      trailingStopPercent: 5,
      breakEvenTriggerPercent: 0,
      partialTakeProfitPercent: 0,
      partialTakeProfitFraction: 50,
      maxPositionLifetimeHours: 168,
      maxSlippagePercent: 2,
      maxPriceImpactPercent: 2,
      minimumLiquidityUsd: 25_000,
      minimumMarketCapUsd: 250_000,
      minimumTokenAgeHours: 24,
      maxNetworkFeeUsd: 2,
      quoteExpirySeconds: 45,
      maxTradesPerHour: 4,
      maxTradesPerDay: 16,
      cooldownBetweenTradesMinutes: 5,
    },
  },
};

/** A complete mandate for a profile and allocation. The form starts from this and the user edits it. */
export function presetMandate(profile: Exclude<RiskProfile, "custom">, agentAllocationUsd = 1000): Mandate {
  const fields = PRESETS[profile].fields;
  return {
    mode: "paper",
    tradingEnabled: true,
    allowedNetwork: NETWORK,
    agentAllocationUsd,
    reserveUsd: 0,
    // Never below the schema's $1 floor, so every preset is valid for every allowed allocation. The percentage cap still binds.
    maxPositionUsd: Math.max(1, Math.round(agentAllocationUsd * fields.maxPositionPercent) / 100),
    allowedAssets: [],
    blockedAssets: [],
    tradingHours: { enabled: false, startHour: 0, endHour: 23, days: [0, 1, 2, 3, 4, 5, 6] },
    ...fields,
  };
}

/** Which profile a mandate matches exactly, or "custom" once any preset field has been edited. */
export function profileOf(mandate: Mandate): RiskProfile {
  for (const profile of ["conservative", "balanced", "aggressive"] as const) {
    const fields = PRESETS[profile].fields as Record<string, unknown>;
    if (Object.keys(fields).every((key) => (mandate as unknown as Record<string, unknown>)[key] === fields[key])) return profile;
  }
  return "custom";
}

type NumericKey = { [Key in keyof Mandate]: Mandate[Key] extends number ? Key : never }[keyof Mandate];

/** Limits where a larger number means more risk. */
const HIGHER_IS_RISKIER: Partial<Record<NumericKey, string>> = {
  agentAllocationUsd: "Agent allocation",
  maxPositionUsd: "Largest position (USD)",
  maxPositionPercent: "Largest position (% of allocation)",
  maxTotalExposurePercent: "Total open exposure",
  maxOpenPositions: "Open positions at once",
  maxLossPerTradePercent: "Largest loss per trade",
  dailyLossLimitPercent: "Daily loss limit",
  maxDrawdownPercent: "Maximum drawdown",
  maxConsecutiveLosses: "Losses in a row before pausing",
  defaultStopLossPercent: "Default stop loss distance",
  maxStopLossPercent: "Widest stop loss",
  maxSlippagePercent: "Slippage allowed",
  maxPriceImpactPercent: "Price impact allowed",
  maxNetworkFeeUsd: "Network fee allowed",
  quoteExpirySeconds: "Quote lifetime",
  maxTradesPerHour: "Trades per hour",
  maxTradesPerDay: "Trades per day",
};

/** Limits where a smaller number means more risk. */
const LOWER_IS_RISKIER: Partial<Record<NumericKey, string>> = {
  reserveUsd: "Untouchable reserve",
  minimumRiskReward: "Minimum risk/reward",
  minimumLiquidityUsd: "Minimum liquidity",
  minimumMarketCapUsd: "Minimum market cap",
  minimumTokenAgeHours: "Minimum token age",
  cooldownAfterLossMinutes: "Cooldown after a loss",
  cooldownBetweenTradesMinutes: "Cooldown between trades",
};

/** Protections where zero means "off", so turning one off or loosening it adds risk. */
const ZERO_IS_OFF: Partial<Record<NumericKey, { label: string; looserWhen: "higher" | "lower" | "none" }>> = {
  trailingStopPercent: { label: "Trailing stop", looserWhen: "higher" },
  breakEvenTriggerPercent: { label: "Break-even trigger", looserWhen: "higher" },
  partialTakeProfitPercent: { label: "Partial profit-taking", looserWhen: "none" },
  maxPositionLifetimeHours: { label: "Longest time in a position", looserWhen: "higher" },
};

function hoursOpen(hours: Mandate["tradingHours"]): Set<string> {
  const open = new Set<string>();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      if (withinTradingHours(hours, day, hour)) open.add(`${day}:${hour}`);
    }
  }
  return open;
}

/** True when trading is allowed at this weekday and hour. A window such as 22 to 4 wraps past midnight. */
export function withinTradingHours(hours: Mandate["tradingHours"], day: number, hour: number): boolean {
  if (!hours.enabled) return true;
  if (!hours.days.includes(day)) return false;
  return hours.startHour <= hours.endHour ? hour >= hours.startHour && hour <= hours.endHour : hour >= hours.startHour || hour <= hours.endHour;
}

/**
 * The changes from `before` to `after` that let the agent risk more. A save
 * that returns anything here needs the user's explicit confirmation.
 */
export function riskIncreases(before: Mandate, after: Mandate): string[] {
  const changes: string[] = [];
  const show = (value: number) => String(Math.round(value * 1e6) / 1e6);

  for (const [key, label] of Object.entries(HIGHER_IS_RISKIER) as Array<[NumericKey, string]>) {
    if (after[key] > before[key]) changes.push(`${label}: ${show(before[key])} → ${show(after[key])}`);
  }
  for (const [key, label] of Object.entries(LOWER_IS_RISKIER) as Array<[NumericKey, string]>) {
    if (after[key] < before[key]) changes.push(`${label}: ${show(before[key])} → ${show(after[key])}`);
  }
  for (const [key, { label, looserWhen }] of Object.entries(ZERO_IS_OFF) as Array<[NumericKey, { label: string; looserWhen: string }]>) {
    const was = before[key];
    const now = after[key];
    if (was > 0 && now === 0) changes.push(`${label}: turned off`);
    else if (was > 0 && now > 0 && looserWhen === "higher" && now > was) changes.push(`${label}: ${show(was)} → ${show(now)}`);
  }
  if (before.partialTakeProfitPercent > 0 && after.partialTakeProfitPercent > 0 && after.partialTakeProfitFraction < before.partialTakeProfitFraction) {
    changes.push(`Partial profit size: ${show(before.partialTakeProfitFraction)} → ${show(after.partialTakeProfitFraction)}`);
  }
  if (before.stopLossRequired && !after.stopLossRequired) changes.push("Stop loss: no longer required");
  if (!before.tradingEnabled && after.tradingEnabled) changes.push("Trading: switched on");
  if (before.mode === "paper" && after.mode === "live") changes.push("Mode: Paper → Live");

  const allowedBefore = new Set(before.allowedAssets.map((asset) => asset.address));
  const added = after.allowedAssets.filter((asset) => !allowedBefore.has(asset.address));
  if (added.length > 0) changes.push(`Assets added: ${added.map((asset) => asset.symbol).join(", ")}`);
  const blockedAfter = new Set(after.blockedAssets);
  const unblocked = before.blockedAssets.filter((entry) => !blockedAfter.has(entry));
  if (unblocked.length > 0) changes.push(`Assets unblocked: ${unblocked.length}`);

  const openBefore = hoursOpen(before.tradingHours);
  if ([...hoursOpen(after.tradingHours)].some((slot) => !openBefore.has(slot))) changes.push("Trading hours: widened");

  return changes;
}

/**
 * A mandate as text with its keys in a fixed order and its asset lists sorted,
 * so two mandates that say the same thing compare equal however they were stored.
 */
export function canonicalMandate(mandate: Mandate): string {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, entry]) => [key, ordered(entry)]),
          )
        : value;
  return JSON.stringify(
    ordered({
      ...mandate,
      allowedAssets: [...mandate.allowedAssets].sort((a, b) => (a.address < b.address ? -1 : 1)),
      blockedAssets: [...mandate.blockedAssets].sort(),
      tradingHours: { ...mandate.tradingHours, days: [...mandate.tradingHours.days].sort() },
    }),
  );
}

/** The largest position the mandate allows, from the dollar cap and the percentage cap together. */
export function positionCapUsd(mandate: Mandate): number {
  return Math.min(mandate.maxPositionUsd, (mandate.agentAllocationUsd * mandate.maxPositionPercent) / 100);
}
