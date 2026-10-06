import { randomBytes } from "node:crypto";
import type { ChatCompletion, Model } from "accred";
import type { EngineDeps } from "./engine";
import type { Mandate } from "./mandate";
import type { MarketSnapshot } from "./market-data";
import type { StrategyKind } from "./strategy";

/**
 * Helpers for the database-backed trading tests. Nothing here touches the
 * network: the market, the fee oracle, the model catalogue and the model are
 * all stand-ins. App modules are imported lazily so the caller can point
 * DATABASE_URL at the test database first.
 */

export const TEST_APP_SECRET = "trading-integration-test-secret-0123456789abcdef";

export const randomAddress = () => `0x${randomBytes(20).toString("hex")}`;

export async function loadApp() {
  const orm = await import("drizzle-orm");
  return {
    ...(await import("../db")),
    ...(await import("./engine")),
    ...(await import("./execution")),
    ...(await import("./monitor")),
    eq: orm.eq,
    and: orm.and,
    presetMandate: (await import("./mandate")).presetMandate,
    paperQuote: (await import("./quote")).paperQuote,
    encrypt: (await import("../crypto")).encrypt,
    PERMISSION_LIST: (await import("./permissions")).PERMISSION_LIST,
    MarketDataError: (await import("./market-data")).MarketDataError,
  };
}
export type App = Awaited<ReturnType<typeof loadApp>>;

export interface TestAsset {
  address: string;
  symbol: string;
}

export interface TestAgent {
  userId: string;
  walletId: string;
  automationId: string;
  mandateId: string;
  mandate: Mandate;
  assets: TestAsset[];
  userKeyEnc: string;
  walletKeyEnc: string;
}

export async function makeAgent(
  app: App,
  options: { mandate?: Partial<Mandate>; assets?: number; kinds?: StrategyKind[]; automation?: Partial<typeof app.tradingAutomations.$inferInsert> } = {},
): Promise<TestAgent> {
  const tag = randomBytes(3).toString("hex").toUpperCase();
  const assets = Array.from({ length: options.assets ?? 1 }, (_, index) => ({ address: randomAddress(), symbol: `T${tag}${index}` }));
  const userKeyEnc = app.encrypt(`ct_live_test_${randomBytes(12).toString("hex")}`);
  const walletKeyEnc = `w1.test-${randomBytes(24).toString("hex")}`;
  const [user] = await app.db
    .insert(app.users)
    .values({ keyHash: randomBytes(32).toString("hex"), keyEnc: userKeyEnc, keyHint: "ct_live_…test" })
    .returning({ id: app.users.id });
  const [wallet] = await app.db
    .insert(app.tradingWallets)
    .values({ userId: user!.id, name: "Test wallet", address: randomAddress(), keyEnc: walletKeyEnc, source: "created" })
    .returning({ id: app.tradingWallets.id });
  const [automation] = await app.db
    .insert(app.tradingAutomations)
    .values({
      userId: user!.id,
      walletId: wallet!.id,
      name: `Test agent ${tag}`,
      status: "running",
      mode: "paper",
      permissions: [...app.PERMISSION_LIST],
      maxPerRunMicro: 100_000_000n,
      maxPerMonthMicro: 1_000_000_000n,
      mandateVersion: 1,
      strategyVersion: 1,
      ...options.automation,
    })
    .returning({ id: app.tradingAutomations.id });
  const mandate: Mandate = { ...app.presetMandate("balanced", 1000), allowedAssets: assets.map((asset) => ({ ...asset })) as Mandate["allowedAssets"], ...options.mandate };
  const [mandateRow] = await app.db
    .insert(app.riskMandates)
    .values({ automationId: automation!.id, version: 1, profile: "balanced", mandate })
    .returning({ id: app.riskMandates.id });
  await app.db.insert(app.tradingStrategies).values({ automationId: automation!.id, version: 1, kinds: options.kinds ?? [] });
  return { userId: user!.id, walletId: wallet!.id, automationId: automation!.id, mandateId: mandateRow!.id, mandate, assets, userKeyEnc, walletKeyEnc };
}

/** Removes everything a test agent created. Automations go first because they hold the wallet. */
export async function removeAgent(app: App, agent: TestAgent): Promise<void> {
  await app.db.delete(app.tradingAutomations).where(app.eq(app.tradingAutomations.userId, agent.userId));
  await app.db.delete(app.users).where(app.eq(app.users.id, agent.userId));
}

export function snapshot(asset: TestAsset, now: number, over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    network: "robinhood",
    address: asset.address,
    symbol: asset.symbol,
    name: asset.symbol,
    priceUsd: 10,
    liquidityUsd: 5_000_000,
    marketCapUsd: 50_000_000,
    volumeH1: 100_000,
    volumeH6: 500_000,
    volumeH24: 2_000_000,
    priceChangeM5: 0.5,
    priceChangeH1: 2,
    priceChangeH6: 4,
    priceChangeH24: 8,
    buysH1: 120,
    sellsH1: 80,
    pairAddress: `0x${"ab".repeat(20)}`,
    pairCreatedAt: now - 30 * 86_400_000,
    dex: "uniswap",
    quoteSymbol: "USDG",
    fetchedAt: now,
    source: "dexscreener",
    ...over,
  };
}

export const FAKE_MODEL: Model = {
  provider: "test",
  id: "claude-sonnet-5",
  name: "claude-sonnet-5",
  inputCostUsdPerMillion: "2",
  outputCostUsdPerMillion: "10",
  cachedInputCostUsdPerMillion: null,
  cacheWrite5mCostUsdPerMillion: null,
  cacheWrite1hCostUsdPerMillion: null,
  cacheReadCostUsdPerMillion: null,
  capabilities: ["text-generation"],
  available: true,
  unavailableReason: null,
  maxInputTokens: 400000,
  maxOutputTokens: 8192,
  pricingSource: null,
  pricingVerifiedAt: null,
  pricingExpiresAt: null,
  pricingType: null,
};

export interface FakeState {
  now: number;
  /** Price per asset address. `null` means the provider has no price for it. Unlisted assets trade at $10. */
  prices: Map<string, number | null>;
  liquidityUsd: number;
  /** What the "model" says. With several entries, each call takes the next and the last one repeats. */
  replies: string[];
  snapshotsError: Error | null;
  feeError: boolean;
  completeError: Error | null;
  /** Idempotency keys of every model call. */
  calls: string[];
  notes: string[];
}

export function fakeDeps(assets: TestAsset[], initial: Partial<FakeState> = {}): { deps: EngineDeps; state: FakeState } {
  const state: FakeState = {
    now: Date.now(),
    prices: new Map(),
    liquidityUsd: 5_000_000,
    replies: ['{"analysis":"Nothing stands out.","proposals":[]}'],
    snapshotsError: null,
    feeError: false,
    completeError: null,
    calls: [],
    notes: [],
    ...initial,
  };
  const deps: EngineDeps = {
    now: () => state.now,
    snapshots: async (addresses) => {
      if (state.snapshotsError) throw state.snapshotsError;
      const found = new Map<string, MarketSnapshot>();
      for (const address of addresses) {
        const asset = assets.find((entry) => entry.address === address);
        const price = state.prices.get(address);
        if (!asset || price === null) continue;
        found.set(address, snapshot(asset, state.now, { priceUsd: price ?? 10, liquidityUsd: state.liquidityUsd }));
      }
      return found;
    },
    networkFeeUsd: async () => {
      if (state.feeError) throw new Error("fee oracle unreachable");
      return 0.01;
    },
    catalog: async () => [FAKE_MODEL],
    complete: async (_apiKey, _params, idempotencyKey) => {
      state.calls.push(idempotencyKey);
      if (state.completeError) throw state.completeError;
      const content = state.replies.length > 1 ? state.replies.shift()! : (state.replies[0] ?? "");
      return {
        content,
        model: FAKE_MODEL.id,
        creditsChargedExact: "0.01",
        remainingCreditsExact: null,
        usage: { inputTokens: 900, outputTokens: 120 },
      } as unknown as ChatCompletion;
    },
    notify: (async (_automation: unknown, text: string) => {
      state.notes.push(text);
    }) as unknown as EngineDeps["notify"],
  };
  return { deps, state };
}

export const buy = (asset: string, requestedPositionUsd = 100, over: Record<string, unknown> = {}) => ({
  action: "BUY",
  asset,
  requestedPositionUsd,
  entryReason: "Volume and price are rising together.",
  stopLossPercent: 2,
  takeProfitPercent: 5,
  confidence: 0.7,
  ...over,
});

export const modelReply = (...proposals: unknown[]) => JSON.stringify({ analysis: "Reviewed the candidates.", proposals });
