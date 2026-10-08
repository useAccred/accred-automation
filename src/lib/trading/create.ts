import { and, eq, inArray } from "drizzle-orm";
import { listModels } from "../accred";
import { usableTextModels } from "../agent/router";
import { MICRO, toMicro } from "../credits";
import { connections, db, riskMandates, tradingAutomations, tradingStrategies, tradingWallets } from "../db";
import { env } from "../env";
import { isValidTimezone } from "../schedule";
import { audit } from "./audit";
import { PRESETS, presetMandate, profileOf, type Mandate, type RiskProfile } from "./mandate";
import { INTERVALS, minimumsToFit } from "./mandate-fields";
import { cleanSymbol, fetchSnapshots, topAssets, type AssetOption } from "./market-data";
import { PERMISSION_LIST, type Permission } from "./permissions";
import { STRATEGIES, type StrategyKind } from "./strategy";

/**
 * Creating a trading agent from a risk profile, without the web form. The
 * Telegram agent uses this. It applies the same rules as the form: live
 * trading on, a wallet of the user's that is not revoked, at least $10, at
 * least one asset, a strategy or an instruction, every permission, and a
 * credit budget inside the allowed range. The mandate is the profile's preset,
 * with the asset list and, when asked, the lowered market minimums.
 */

export class CreateAgentError extends Error {}

export type Profile = Exclude<RiskProfile, "custom">;

export interface CreateAgentInput {
  userId: string;
  name: string;
  walletId: string;
  allocationUsd: number;
  profile: Profile;
  assets: AssetOption[];
  strategies: StrategyKind[];
  instructions: string;
  intervalMinutes: number;
  modelMode: "auto" | "economy" | "quality" | "pinned";
  modelId?: string | null;
  maxPerRunCredits: number;
  maxPerMonthCredits: number;
  connectionIds: string[];
  timezone: string;
  /** Lower the profile's liquidity, market-cap and token-age minimums so every chosen asset can trade. */
  lowerMinimums: boolean;
  source: "web" | "telegram";
}

/** The mandate the input would produce, so it can be shown before anything is saved. */
export function buildMandate(input: Pick<CreateAgentInput, "allocationUsd" | "profile" | "assets" | "lowerMinimums">, now = Date.now()): Mandate {
  const mandate: Mandate = {
    ...presetMandate(input.profile, input.allocationUsd),
    mode: "live",
    allowedAssets: input.assets.map((asset) => ({ address: asset.address.toLowerCase(), symbol: cleanSymbol(asset.symbol) || "TOKEN" })),
  };
  if (input.lowerMinimums) {
    for (const asset of input.assets) Object.assign(mandate, minimumsToFit(asset, mandate, now));
  }
  return mandate;
}

/** The assets that would be rejected by the mandate's market filters today. */
export function assetsBlockedBy(mandate: Mandate, assets: AssetOption[], now = Date.now()): AssetOption[] {
  return assets.filter((asset) => Object.keys(minimumsToFit(asset, mandate, now)).length > 0);
}

export async function createAgentFromProfile(input: CreateAgentInput): Promise<{ id: string; mandate: Mandate }> {
  if (!env.liveTrading) throw new CreateAgentError("Live trading is switched off on this server, so an agent cannot be started yet.");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new CreateAgentError("Give the agent a name.");
  if (!(input.allocationUsd >= 10)) throw new CreateAgentError("Allocate at least $10.");
  if (!(input.profile in PRESETS)) throw new CreateAgentError("Choose a profile: conservative, balanced or aggressive.");
  if (input.assets.length === 0) throw new CreateAgentError("Choose at least one asset the agent may trade.");
  if (input.assets.length > 30) throw new CreateAgentError("At most 30 assets.");
  const kinds = [...new Set(input.strategies)].filter((kind) => kind in STRATEGIES);
  const instructions = input.instructions.trim().slice(0, 2000);
  if (kinds.length === 0 && !instructions) throw new CreateAgentError("Pick at least one strategy, or describe one.");
  if (!INTERVALS.some((interval) => interval.minutes === input.intervalMinutes)) throw new CreateAgentError("Choose an interval of 5, 15, 30, 60, 240 or 1440 minutes.");
  const timezone = isValidTimezone(input.timezone) ? input.timezone : "UTC";

  const maxPerRunMicro = toMicro(input.maxPerRunCredits);
  const maxPerMonthMicro = toMicro(input.maxPerMonthCredits);
  if (maxPerRunMicro < MICRO / 10n) throw new CreateAgentError("The credit budget per cycle must be at least 0.1 credits.");
  if (maxPerRunMicro > 100n * MICRO) throw new CreateAgentError("The credit budget per cycle can be at most 100 credits.");
  if (maxPerMonthMicro < maxPerRunMicro) throw new CreateAgentError("The monthly credit cap cannot be lower than the budget per cycle.");

  const [wallet] = await db.select().from(tradingWallets).where(and(eq(tradingWallets.id, input.walletId), eq(tradingWallets.userId, input.userId)));
  if (!wallet) throw new CreateAgentError("That wallet no longer exists.");
  if (wallet.tradingRevokedAt) throw new CreateAgentError("Trading authority is revoked for that wallet. Restore it on the Wallets page first.");

  const connectionIds = [...new Set(input.connectionIds)];
  if (connectionIds.length > 0) {
    const owned = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.userId, input.userId), inArray(connections.id, connectionIds)));
    if (owned.length !== connectionIds.length) throw new CreateAgentError("One of the connections no longer exists.");
  }

  let modelId: string | null = null;
  if (input.modelMode === "pinned") {
    const models = usableTextModels(await listModels().catch(() => []));
    if (!models.some((model) => model.id === input.modelId)) throw new CreateAgentError("That model is not available right now.");
    modelId = input.modelId!;
  }

  const mandate = buildMandate(input);
  const permissions: Permission[] = [...PERMISSION_LIST];

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tradingAutomations)
      .values({
        userId: input.userId,
        walletId: wallet.id,
        name,
        mode: "live",
        status: "running",
        permissions,
        modelMode: input.modelMode,
        modelId,
        maxPerRunMicro,
        maxPerMonthMicro,
        intervalMinutes: input.intervalMinutes,
        timezone,
        connectionIds,
        approvedAt: new Date(),
        nextRunAt: new Date(),
        peakEquityUsd: mandate.agentAllocationUsd,
      })
      .returning({ id: tradingAutomations.id });
    await tx.insert(riskMandates).values({ automationId: created!.id, version: 1, profile: profileOf(mandate), mandate });
    await tx.insert(tradingStrategies).values({ automationId: created!.id, version: 1, kinds, instructions });
    await audit(
      {
        userId: input.userId,
        automationId: created!.id,
        walletId: wallet.id,
        type: "agent.approved",
        actor: "user",
        summary: `Approved and started with real funds on Robinhood Chain, with a $${mandate.agentAllocationUsd.toLocaleString("en-US")} allocation`,
        data: { mandateVersion: 1, strategyVersion: 1, mandate, strategies: kinds, permissions, wallet: wallet.address, source: input.source },
      },
      tx,
    );
    return created!.id;
  });
  return { id, mandate };
}

/**
 * Turns names into assets: a symbol is matched against the most traded tokens
 * on the chain, an address is looked up. Names that match nothing are returned.
 */
export async function resolveAssets(names: string[]): Promise<{ assets: AssetOption[]; unknown: string[] }> {
  const assets: AssetOption[] = [];
  const unknown: string[] = [];
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 30);
  const top = wanted.some((name) => !/^0x[0-9a-f]{40}$/i.test(name)) ? await topAssets() : [];
  const addresses = wanted.filter((name) => /^0x[0-9a-f]{40}$/i.test(name)).map((name) => name.toLowerCase());
  const looked = addresses.length ? await fetchSnapshots(addresses).catch(() => new Map()) : new Map();
  for (const name of wanted) {
    if (/^0x[0-9a-f]{40}$/i.test(name)) {
      const market = looked.get(name.toLowerCase());
      if (market) {
        assets.push({
          address: market.address,
          symbol: cleanSymbol(market.symbol) || "TOKEN",
          name: market.name,
          liquidityUsd: market.liquidityUsd,
          volumeH24: market.volumeH24 ?? 0,
          marketCapUsd: market.marketCapUsd,
          pairCreatedAt: market.pairCreatedAt,
        });
      } else unknown.push(name);
      continue;
    }
    const symbol = name.replace(/^\$/, "").toLowerCase();
    const match = top.find((asset) => asset.symbol.toLowerCase() === symbol) ?? top.find((asset) => asset.name.toLowerCase() === symbol);
    if (match) assets.push(match);
    else unknown.push(name);
  }
  return { assets: assets.filter((asset, index, all) => all.findIndex((other) => other.address === asset.address) === index), unknown };
}

const usd = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;

/** The mandate in plain sentences, as the web form's "With this mandate the agent:" summary. */
export function describeMandate(mandate: Mandate, profile: Profile): string[] {
  const largest = Math.min(mandate.maxPositionUsd, (mandate.agentAllocationUsd * mandate.maxPositionPercent) / 100);
  return [
    `may deploy at most ${usd(mandate.agentAllocationUsd)} in total (${PRESETS[profile].label} profile)`,
    `opens positions of at most ${usd(largest)} each, at most ${mandate.maxOpenPositions} at once`,
    `puts a ${mandate.defaultStopLossPercent}% stop loss and a ${mandate.defaultTakeProfitPercent}% take profit on every position`,
    `stops opening positions after a ${mandate.dailyLossLimitPercent}% daily loss, a ${mandate.maxDrawdownPercent}% drawdown or ${mandate.maxConsecutiveLosses} losses in a row`,
    `trades only tokens with at least ${usd(mandate.minimumLiquidityUsd)} of liquidity${mandate.minimumMarketCapUsd > 0 ? ` and a ${usd(mandate.minimumMarketCapUsd)} market cap` : ""}`,
    `makes at most ${mandate.maxTradesPerDay} trades a day`,
    `may trade: ${mandate.allowedAssets.map((asset) => asset.symbol).join(", ")}`,
  ];
}
