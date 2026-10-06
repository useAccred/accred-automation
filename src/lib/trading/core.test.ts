import { describe, expect, it } from "vitest";
import { MandateSchema, canonicalMandate, positionCapUsd, presetMandate, profileOf, riskIncreases, withinTradingHours, type Mandate } from "./mandate";
import { PERMISSION_LIST, REQUIRED_WITH_EXECUTE, TRADING_AUTHORITY, isPermission } from "./permissions";
import type { PortfolioState } from "./portfolio";
import {
  CHECK_LABELS,
  MAX_MARKET_AGE_MS,
  entryBlocker,
  evaluateRisk,
  localClock,
  marketFilterFailure,
  rejectionSummary,
  resolveStops,
  type RiskInputs,
  type RiskResult,
} from "./risk-engine";
import { TRADE_STATES, canTransition, isTerminal, type TradeState } from "./states";

/** Wednesday 14 January 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 0, 14, 12, 0, 0);
const HOUR = 3_600_000;
const A = `0x${"a".repeat(40)}`;
const B = `0x${"b".repeat(40)}`;
const C = `0x${"c".repeat(40)}`;

function mandate(extra: Partial<Mandate> = {}): Mandate {
  return { ...presetMandate("balanced", 1000), allowedAssets: [{ address: A, symbol: "AAA" }], ...extra };
}

function portfolio(extra: Partial<PortfolioState> = {}): PortfolioState {
  return {
    allocationUsd: 1000,
    reserveUsd: 0,
    availableUsd: 1000,
    openCostUsd: 0,
    openValueUsd: 0,
    openPositions: 0,
    openAssets: [],
    realizedNetUsd: 0,
    realizedGrossUsd: 0,
    feesUsd: 0,
    unrealizedUsd: 0,
    equityUsd: 1000,
    peakEquityUsd: 1000,
    drawdownPercent: 0,
    dayNetUsd: 0,
    dailyLossUsd: 0,
    tradesToday: 0,
    tradesLastHour: 0,
    lastTradeAt: null,
    consecutiveLosses: 0,
    lastLossAt: null,
    ...extra,
  };
}

/** Inputs that pass all seventeen checks at the final stage. Balanced preset, $1,000 allocation. */
function baseInputs(): RiskInputs {
  return {
    now: NOW,
    clock: { day: 3, hour: 12 },
    mandate: mandate(),
    agent: { status: "running", mode: "paper", accessRevoked: false, walletRevoked: false, permissions: [...PERMISSION_LIST], liveEnabled: false },
    proposal: { action: "BUY", assetAddress: A, symbol: "AAA", requestedUsd: 100, stopLossPercent: 2, takeProfitPercent: 5 },
    portfolio: portfolio(),
    market: { network: "robinhood", priceUsd: 2, liquidityUsd: 500_000, marketCapUsd: 10_000_000, pairCreatedAt: NOW - 100 * HOUR, fetchedAt: NOW - 1000 },
    quote: { priceUsd: 2.002, priceImpactPercent: 0.1, slippagePercent: 0.1, networkFeeUsd: 0.2, quotedAt: NOW - 1000, simulation: { ok: true, detail: "ok" } },
  };
}

type Patch = (inputs: RiskInputs) => void;

function run(patch?: Patch, stage: "pre_trade" | "final" = "final"): RiskResult {
  const inputs = baseInputs();
  patch?.(inputs);
  return evaluateRisk(inputs, stage);
}

/** The check fails and the trade is refused at the final stage. */
function expectFail(id: number, patch: Patch) {
  const result = run(patch);
  expect(result.checks[id - 1]!.status, result.checks[id - 1]!.detail).toBe("fail");
  expect(result.approved).toBe(false);
}

/** Every check passes, so the mutation sits on the allowed side of the boundary. */
function expectPass(patch: Patch) {
  const result = run(patch);
  expect(result.checks.filter((check) => check.status !== "pass").map((check) => `${check.id} ${check.detail}`)).toEqual([]);
  expect(result.approved).toBe(true);
}

describe("evaluateRisk: baseline and stages", () => {
  it("approves the baseline with all seventeen checks passed", () => {
    const result = run();
    expect(result).toMatchObject({ stage: "final", approved: true, passed: 17, failed: 0, total: 17, stopLossPercent: 2, takeProfitPercent: 5, plannedLossUsd: 2 });
    expect(result.checks.map((check) => check.key)).toEqual(CHECK_LABELS.map(([key]) => key));
    expect(rejectionSummary(result)).toBe("");
  });

  it("leaves 14 to 17 pending before a quote exists and can approve without one", () => {
    const result = run((i) => void (i.quote = null), "pre_trade");
    expect(result.approved).toBe(true);
    expect(result.passed).toBe(13);
    expect(result.checks.slice(13).map((check) => check.status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("never approves the final stage without a quote", () => {
    const result = run((i) => void (i.quote = null));
    expect(result.approved).toBe(false);
    expect(result.checks.slice(13).map((check) => check.status)).toEqual(["fail", "fail", "fail", "fail"]);
    expect(result.failed).toBe(4);
  });

  const oneFailurePerCheck: Patch[] = [
    (i) => void (i.agent.status = "paused"),
    (i) => void (i.portfolio.availableUsd = 99.99),
    (i) => void (i.mandate.maxPositionUsd = 99.99),
    (i) => void (i.portfolio.openCostUsd = 200.01),
    (i) => void (i.portfolio.openPositions = 3),
    (i) => void (i.portfolio.tradesLastHour = 2),
    (i) => void (i.portfolio.dailyLossUsd = 50),
    (i) => void (i.portfolio.drawdownPercent = 10),
    (i) => void (i.portfolio.consecutiveLosses = 3),
    (i) => void (i.mandate.blockedAssets = [A]),
    (i) => void (i.market!.liquidityUsd = 49_999),
    (i) => void (i.mandate.maxLossPerTradePercent = 0.19),
    (i) => void (i.proposal.takeProfitPercent = 3.99),
    (i) => void (i.quote!.slippagePercent = 1.01),
    (i) => void (i.quote!.simulation = { ok: false, detail: "reverted" }),
    (i) => void (i.quote!.networkFeeUsd = 1.01),
    (i) => void (i.quote!.quotedAt = NOW - 30_001),
  ];

  it.each(oneFailurePerCheck.map((patch, index) => [index + 1, patch] as const))("refuses the trade when only check %i fails", (id, patch) => {
    const result = run(patch);
    expect(result.checks.filter((check) => check.status === "fail").map((check) => check.id)).toEqual([id]);
    expect(result).toMatchObject({ approved: false, failed: 1, passed: 16 });
    expect(rejectionSummary(result)).toBe(`${CHECK_LABELS[id - 1]![1]}: ${result.checks[id - 1]!.detail}`);
    // The first thirteen also stop the trade before a quote is ever fetched.
    expect(run(patch, "pre_trade").approved).toBe(id >= 14);
  });

  it("rejects a hostile proposal", () => {
    const result = run((i) => void (i.proposal = { ...i.proposal, requestedUsd: 1e9, stopLossPercent: 0.0001, takeProfitPercent: 10_000 }));
    expect(result.approved).toBe(false);
    for (const id of [2, 3, 4]) expect(result.checks[id - 1]!.status).toBe("fail");
    expect(rejectionSummary(result)).toMatch(/^Allocation available: .* \(and \d+ more\)$/);
    for (const requestedUsd of [Infinity, -Infinity, NaN, -100, 0]) expect(run((i) => void (i.proposal.requestedUsd = requestedUsd)).approved).toBe(false);
    expect(run((i) => void (i.proposal.stopLossPercent = Infinity)).approved).toBe(false);
    expect(run((i) => void (i.proposal.assetAddress = "ignore the allowlist")).approved).toBe(false);
  });

  it("fails a check that throws instead of passing it", () => {
    const result = run((i) => void ((i as { portfolio: unknown }).portfolio = null));
    expect(result.approved).toBe(false);
    expect(result.checks[1]).toMatchObject({ status: "fail", detail: "This check could not be completed" });
  });
});

describe("check 1: trading enabled", () => {
  it.each<[string, Patch]>([
    ["trading switched off", (i) => void (i.mandate.tradingEnabled = false)],
    ["paused", (i) => void (i.agent.status = "paused")],
    ["stopped", (i) => void (i.agent.status = "stopped")],
    ["access revoked", (i) => void (i.agent.accessRevoked = true)],
    ["wallet revoked", (i) => void (i.agent.walletRevoked = true)],
    ["no PROPOSE_TRADE", (i) => void (i.agent.permissions = i.agent.permissions.filter((p) => p !== "PROPOSE_TRADE"))],
    ["no EXECUTE_TRADE", (i) => void (i.agent.permissions = i.agent.permissions.filter((p) => p !== "EXECUTE_TRADE"))],
    ["live agent, live not enabled", (i) => void ((i.agent.mode = "live"), (i.mandate.mode = "live"))],
    ["live agent, paper mandate", (i) => void ((i.agent.mode = "live"), (i.agent.liveEnabled = true))],
    ["paper agent, live mandate", (i) => void (i.mandate.mode = "live")],
    ["hour before the window", (i) => void ((i.mandate.tradingHours = { enabled: true, startHour: 13, endHour: 17, days: [3] }))],
    ["wrong weekday", (i) => void ((i.mandate.tradingHours = { enabled: true, startHour: 0, endHour: 23, days: [1, 2] }))],
    ["outside a window that wraps midnight", (i) => void ((i.mandate.tradingHours = { enabled: true, startHour: 22, endHour: 4, days: [3] }))],
    ["NaN weekday", (i) => void (i.clock.day = NaN)],
    ["NaN hour", (i) => void (i.clock.hour = NaN)],
  ])("fails: %s", (_name, patch) => expectFail(1, patch));

  it("passes a live agent when live is enabled, and inside a window that wraps midnight", () => {
    expectPass((i) => void ((i.agent.mode = "live"), (i.mandate.mode = "live"), (i.agent.liveEnabled = true)));
    for (const hour of [22, 23, 0, 4]) expectPass((i) => void ((i.clock.hour = hour), (i.mandate.tradingHours = { enabled: true, startHour: 22, endHour: 4, days: [3] })));
    expectFail(1, (i) => void ((i.clock.hour = 5), (i.mandate.tradingHours = { enabled: true, startHour: 22, endHour: 4, days: [3] })));
  });
});

describe("checks 2 to 5: capital and positions", () => {
  it("2: requested equal to available passes, a cent over fails", () => {
    expectPass((i) => void ((i.portfolio.availableUsd = 50), (i.proposal.requestedUsd = 50)));
    expectFail(2, (i) => void ((i.portfolio.availableUsd = 50), (i.proposal.requestedUsd = 50.01)));
  });

  it.each([0, -1, NaN, Infinity])("2: requested %s fails", (requestedUsd) => expectFail(2, (i) => void (i.proposal.requestedUsd = requestedUsd)));

  it("2: available NaN fails", () => expectFail(2, (i) => void (i.portfolio.availableUsd = NaN)));

  it("3: the dollar cap binds when it is the lower one", () => {
    expect(positionCapUsd(mandate({ maxPositionUsd: 50 }))).toBe(50);
    expectPass((i) => void ((i.mandate.maxPositionUsd = 50), (i.proposal.requestedUsd = 50)));
    expectFail(3, (i) => void ((i.mandate.maxPositionUsd = 50), (i.proposal.requestedUsd = 50.01)));
  });

  it("3: the percent cap binds when it is the lower one", () => {
    expect(positionCapUsd(mandate({ maxPositionPercent: 5 }))).toBe(50);
    expectPass((i) => void ((i.mandate.maxPositionPercent = 5), (i.proposal.requestedUsd = 50)));
    expectFail(3, (i) => void ((i.mandate.maxPositionPercent = 5), (i.proposal.requestedUsd = 50.01)));
    expectFail(3, (i) => void (i.mandate.maxPositionPercent = NaN));
  });

  it("4: exposure exactly at the limit passes, just over fails", () => {
    expectPass((i) => void (i.portfolio.openCostUsd = 200));
    expectFail(4, (i) => void (i.portfolio.openCostUsd = 200.01));
    expectFail(4, (i) => void (i.portfolio.openCostUsd = NaN));
  });

  it("5: a limit of N refuses position N+1, and a held asset is refused", () => {
    expectPass((i) => void (i.portfolio.openPositions = 2));
    expectFail(5, (i) => void (i.portfolio.openPositions = 3));
    expectFail(5, (i) => void (i.portfolio.openPositions = NaN));
    expectFail(5, (i) => void ((i.portfolio.openPositions = 1), (i.portfolio.openAssets = [A])));
  });
});

describe("checks 6 to 9: frequency and loss limits", () => {
  it("6: trades per hour and per day stop at the limit", () => {
    expectPass((i) => void (i.portfolio.tradesLastHour = 1));
    expectFail(6, (i) => void (i.portfolio.tradesLastHour = 2));
    expectPass((i) => void (i.portfolio.tradesToday = 7));
    expectFail(6, (i) => void (i.portfolio.tradesToday = 8));
    expectFail(6, (i) => void (i.portfolio.tradesToday = NaN));
  });

  it("6: the cooldown between trades ends exactly at expiry", () => {
    expectFail(6, (i) => void (i.portfolio.lastTradeAt = NOW - 10 * 60_000 + 1));
    expectPass((i) => void (i.portfolio.lastTradeAt = NOW - 10 * 60_000));
    expectFail(6, (i) => void (i.portfolio.lastTradeAt = NaN));
    expectPass((i) => void ((i.portfolio.lastTradeAt = NOW), (i.mandate.cooldownBetweenTradesMinutes = 0)));
  });

  it("7: reaching the daily loss limit stops trading", () => {
    expectPass((i) => void (i.portfolio.dailyLossUsd = 49.99));
    expectFail(7, (i) => void (i.portfolio.dailyLossUsd = 50));
    expectFail(7, (i) => void (i.portfolio.dailyLossUsd = 50.01));
    expectFail(7, (i) => void (i.portfolio.dailyLossUsd = NaN));
  });

  it("8: reaching the drawdown limit stops trading", () => {
    expectPass((i) => void (i.portfolio.drawdownPercent = 9.99));
    expectFail(8, (i) => void (i.portfolio.drawdownPercent = 10));
    expectFail(8, (i) => void (i.portfolio.drawdownPercent = NaN));
  });

  it("9: the loss streak and the cooldown after a loss", () => {
    expectPass((i) => void (i.portfolio.consecutiveLosses = 2));
    expectFail(9, (i) => void (i.portfolio.consecutiveLosses = 3));
    expectFail(9, (i) => void (i.portfolio.consecutiveLosses = NaN));
    expectFail(9, (i) => void (i.portfolio.lastLossAt = NOW - 30 * 60_000 + 1));
    expectPass((i) => void (i.portfolio.lastLossAt = NOW - 30 * 60_000));
  });
});

describe("checks 10 and 11: asset and market", () => {
  it.each<[string, Patch]>([
    ["not on the allowlist", (i) => void (i.mandate.allowedAssets = [{ address: B, symbol: "BBB" }])],
    ["on the blocklist", (i) => void (i.mandate.blockedAssets = [A])],
    ["empty address", (i) => void (i.proposal.assetAddress = "")],
    ["malformed address", (i) => void (i.proposal.assetAddress = "0xabc")],
    ["address not lowercased", (i) => void (i.proposal.assetAddress = A.toUpperCase().replace("0X", "0x"))],
    ["wrong network", (i) => void (i.market!.network = "ethereum")],
  ])("10 fails: %s", (_name, patch) => expectFail(10, patch));

  it.each<[string, Patch]>([
    ["no market", (i) => void (i.market = null)],
    ["stale data", (i) => void (i.market!.fetchedAt = NOW - MAX_MARKET_AGE_MS - 1)],
    ["data from the future", (i) => void (i.market!.fetchedAt = NOW + 5001)],
    ["NaN fetch time", (i) => void (i.market!.fetchedAt = NaN)],
    ["price 0", (i) => void (i.market!.priceUsd = 0)],
    ["price NaN", (i) => void (i.market!.priceUsd = NaN)],
    ["liquidity just under", (i) => void (i.market!.liquidityUsd = 49_999.99)],
    ["liquidity NaN", (i) => void (i.market!.liquidityUsd = NaN)],
    ["market cap unknown", (i) => void (i.market!.marketCapUsd = null)],
    ["market cap under", (i) => void (i.market!.marketCapUsd = 999_999)],
    ["token too young", (i) => void (i.market!.pairCreatedAt = NOW - 72 * HOUR + 1)],
    ["token age unknown", (i) => void (i.market!.pairCreatedAt = null)],
  ])("11 fails: %s", (_name, patch) => expectFail(11, patch));

  it("11 passes exactly at each boundary", () => {
    expectPass((i) => void (i.market!.fetchedAt = NOW - MAX_MARKET_AGE_MS));
    expectPass((i) => void (i.market!.liquidityUsd = 50_000));
    expectPass((i) => void (i.market!.marketCapUsd = 1_000_000));
    expectPass((i) => void (i.market!.pairCreatedAt = NOW - 72 * HOUR));
    expectPass((i) => void ((i.market!.marketCapUsd = null), (i.market!.pairCreatedAt = null), (i.mandate.minimumMarketCapUsd = 0), (i.mandate.minimumTokenAgeHours = 0)));
  });

  it("marketFilterFailure gives the reason, or null", () => {
    const market = baseInputs().market!;
    expect(marketFilterFailure(mandate(), market, NOW)).toBeNull();
    expect(marketFilterFailure(mandate(), null, NOW)).toBe("No market data for this asset");
    expect(marketFilterFailure(mandate(), { ...market, liquidityUsd: 10 }, NOW)).toMatch(/^Liquidity \$10 · required minimum \$50,000$/);
    expect(marketFilterFailure(mandate(), market, NOW + MAX_MARKET_AGE_MS)).toBe("Market data is stale");
  });
});

describe("checks 12 and 13: stop loss and risk/reward", () => {
  it("12: a missing stop fails when the mandate requires one", () => {
    const result = run((i) => void (i.proposal.stopLossPercent = null));
    expect(result).toMatchObject({ approved: false, stopLossPercent: null, plannedLossUsd: null });
    expect(result.checks[11]!.status).toBe("fail");
    expect(result.checks[12]!.status).toBe("fail");
  });

  it("12: a missing stop takes the default when the mandate does not require one", () => {
    const patch: Patch = (i) => void ((i.proposal.stopLossPercent = null), (i.mandate.stopLossRequired = false));
    expectPass(patch);
    expect(run(patch)).toMatchObject({ stopLossPercent: 2, plannedLossUsd: 2 });
  });

  it("12: the widest stop is allowed, anything wider is not", () => {
    expectPass((i) => void ((i.proposal.stopLossPercent = 5), (i.proposal.takeProfitPercent = 10)));
    expectFail(12, (i) => void ((i.proposal.stopLossPercent = 5.01), (i.proposal.takeProfitPercent = 11)));
  });

  it.each([0, -2, NaN])("12: a stop of %s fails", (stop) => expectFail(12, (i) => void (i.proposal.stopLossPercent = stop)));

  it("12: planned loss exactly at the per-trade limit passes, just over fails", () => {
    // $100 at a 2% stop plans a $2 loss; 0.2% of $1,000 is $2.
    expectPass((i) => void (i.mandate.maxLossPerTradePercent = 0.2));
    expectFail(12, (i) => void ((i.mandate.maxLossPerTradePercent = 0.2), (i.proposal.stopLossPercent = 2.01)));
    expectFail(12, (i) => void (i.mandate.maxLossPerTradePercent = NaN));
  });

  it("13: the minimum ratio passes, just under fails", () => {
    expectPass((i) => void (i.proposal.takeProfitPercent = 4));
    expectFail(13, (i) => void (i.proposal.takeProfitPercent = 3.99));
    expectFail(13, (i) => void (i.proposal.takeProfitPercent = 0));
    expectFail(13, (i) => void (i.proposal.takeProfitPercent = -5));
  });

  it("13: a missing take profit uses the mandate default", () => {
    expectPass((i) => void (i.proposal.takeProfitPercent = null));
    expect(run((i) => void (i.proposal.takeProfitPercent = null)).takeProfitPercent).toBe(5);
    expectFail(13, (i) => void ((i.proposal.takeProfitPercent = null), (i.mandate.defaultTakeProfitPercent = 3)));
  });

  it("resolveStops", () => {
    expect(resolveStops(mandate(), { stopLossPercent: 3, takeProfitPercent: 9 })).toEqual({ stopLossPercent: 3, takeProfitPercent: 9 });
    expect(resolveStops(mandate(), { stopLossPercent: null, takeProfitPercent: null })).toEqual({ stopLossPercent: null, takeProfitPercent: 5 });
    expect(resolveStops(mandate({ stopLossRequired: false }), { stopLossPercent: NaN, takeProfitPercent: Infinity })).toEqual({ stopLossPercent: 2, takeProfitPercent: 5 });
  });
});

describe("checks 14 to 17: the quote", () => {
  it("14: slippage and price impact at the limit pass, over fail", () => {
    expectPass((i) => void (i.quote!.slippagePercent = 1));
    expectFail(14, (i) => void (i.quote!.slippagePercent = 1.01));
    expectPass((i) => void (i.quote!.priceImpactPercent = 1));
    expectFail(14, (i) => void (i.quote!.priceImpactPercent = 1.01));
  });

  it.each<[string, Patch]>([
    ["NaN slippage", (i) => void (i.quote!.slippagePercent = NaN)],
    ["negative slippage", (i) => void (i.quote!.slippagePercent = -0.1)],
    ["NaN impact", (i) => void (i.quote!.priceImpactPercent = NaN)],
    ["quoted price NaN", (i) => void (i.quote!.priceUsd = NaN)],
    ["quoted price 0", (i) => void (i.quote!.priceUsd = 0)],
    ["quoted price far above the market", (i) => void (i.quote!.priceUsd = 2.05)],
    ["quoted price far below the market", (i) => void (i.quote!.priceUsd = 1.95)],
    ["no quote", (i) => void (i.quote = null)],
  ])("14 fails: %s", (_name, patch) => expectFail(14, patch));

  it("14: a quoted price within slippage plus impact of the market passes", () => {
    expectPass((i) => void (i.quote!.priceUsd = 2.04));
    expectPass((i) => void (i.quote!.priceUsd = 1.96));
  });

  it("15: a failed simulation fails", () => {
    expectFail(15, (i) => void (i.quote!.simulation = { ok: false, detail: "" }));
    expectFail(15, (i) => void ((i.quote!.simulation as { ok: unknown }).ok = "true"));
    expect(run((i) => void (i.quote!.simulation = { ok: false, detail: "" })).checks[14]!.detail).toBe("The simulation failed");
  });

  it("16: the network fee at the limit passes, over or unknown fails", () => {
    expectPass((i) => void (i.quote!.networkFeeUsd = 1));
    expectPass((i) => void (i.quote!.networkFeeUsd = 0));
    expectFail(16, (i) => void (i.quote!.networkFeeUsd = 1.01));
    expectFail(16, (i) => void (i.quote!.networkFeeUsd = NaN));
    expectFail(16, (i) => void (i.quote!.networkFeeUsd = -0.01));
  });

  it("17: a quote exactly at expiry passes, 1 ms older fails", () => {
    expectPass((i) => void (i.quote!.quotedAt = NOW - 30_000));
    expectFail(17, (i) => void (i.quote!.quotedAt = NOW - 30_001));
    expectFail(17, (i) => void (i.quote!.quotedAt = NOW + 5001));
    expectFail(17, (i) => void (i.quote!.quotedAt = NaN));
  });
});

describe("entryBlocker, rejectionSummary and localClock", () => {
  const state = (patch?: Patch) => {
    const { now, clock, mandate: m, agent, portfolio: p } = (() => {
      const inputs = baseInputs();
      patch?.(inputs);
      return inputs;
    })();
    return { now, clock, mandate: m, agent, portfolio: p };
  };

  it("is null for a healthy agent", () => expect(entryBlocker(state())).toBeNull());

  it.each<[string, Patch, RegExp]>([
    ["paused", (i) => void (i.agent.status = "paused"), /^Trading enabled: The agent is paused$/],
    ["revoked", (i) => void (i.agent.accessRevoked = true), /^Trading enabled: /],
    ["positions full", (i) => void (i.portfolio.openPositions = 3), /^Open-position limit: 3 open · limit 3$/],
    ["trades per day", (i) => void (i.portfolio.tradesToday = 8), /^Trade-frequency limit: /],
    ["cooldown", (i) => void (i.portfolio.lastTradeAt = NOW - 1), /^Trade-frequency limit: Cooling down between trades · 10 min left$/],
    ["daily loss", (i) => void (i.portfolio.dailyLossUsd = 50), /^Daily loss limit: /],
    ["drawdown", (i) => void (i.portfolio.drawdownPercent = 10), /^Drawdown limit: /],
    ["loss streak", (i) => void (i.portfolio.consecutiveLosses = 3), /^Consecutive-loss breaker: /],
    ["no capital", (i) => void (i.portfolio.availableUsd = 0.99), /^Allocation available: /],
    ["unknown capital", (i) => void (i.portfolio.availableUsd = NaN), /^Allocation available: /],
    ["unknown drawdown", (i) => void (i.portfolio.drawdownPercent = NaN), /^Drawdown limit: /],
  ])("gives a reason: %s", (_name, patch, reason) => expect(entryBlocker(state(patch))).toMatch(reason));

  it("rejectionSummary names the first failure and counts the rest", () => {
    const result = run((i) => void ((i.agent.status = "paused"), (i.portfolio.dailyLossUsd = 60), (i.quote = null)));
    expect(rejectionSummary(result)).toBe("Trading enabled: The agent is paused (and 5 more)");
  });

  it("localClock reads the weekday and hour in a timezone", () => {
    expect(localClock(NOW, "UTC")).toEqual({ day: 3, hour: 12 });
    expect(localClock(NOW, "Asia/Kolkata")).toEqual({ day: 3, hour: 17 });
    expect(localClock(Date.UTC(2026, 0, 14, 3), "America/New_York")).toEqual({ day: 2, hour: 22 });
    expect(localClock(Date.UTC(2026, 0, 18, 0), "UTC")).toEqual({ day: 0, hour: 0 });
    expect(localClock(NOW, "Not/A_Zone")).toEqual({ day: NaN, hour: NaN });
    expect(localClock(NaN, "UTC")).toEqual({ day: NaN, hour: NaN });
  });
});

describe("MandateSchema", () => {
  const parses = (extra: Record<string, unknown>) => MandateSchema.safeParse({ ...mandate(), ...extra }).success;

  it.each(["conservative", "balanced", "aggressive"] as const)("accepts the %s preset unchanged", (profile) => {
    for (const allocation of [20, 1000, 250_000]) {
      const preset = presetMandate(profile, allocation);
      expect(MandateSchema.parse(preset)).toEqual(preset);
      expect(profileOf(preset)).toBe(profile);
    }
  });

  // $10 is the smallest allocation the schema allows. The dollar cap is held at the schema's $1 floor there,
  // and the percentage cap still binds, so the preset is valid without allowing a larger position.
  it("every preset is a valid mandate at the minimum $10 allocation", () => {
    for (const profile of ["conservative", "balanced", "aggressive"] as const) {
      expect(MandateSchema.safeParse(presetMandate(profile, 10)).success, profile).toBe(true);
    }
    expect(presetMandate("conservative", 10).maxPositionUsd).toBe(1);
    expect(positionCapUsd(presetMandate("conservative", 10))).toBe(0.5);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown key", { overrideRiskEngine: true }],
    ["reserve equal to the allocation", { reserveUsd: 1000 }],
    ["largest position above the allocation", { maxPositionUsd: 1000.01 }],
    ["default stop wider than the maximum", { defaultStopLossPercent: 5.01 }],
    ["an asset both allowed and blocked", { blockedAssets: [A.toUpperCase().replace("0X", "0x")] }],
    ["a duplicate asset", { allowedAssets: [{ address: A, symbol: "AAA" }, { address: A.toUpperCase().replace("0X", "0x"), symbol: "AAA2" }] }],
    ["trading hours with no days", { tradingHours: { enabled: true, startHour: 9, endHour: 17, days: [] } }],
    ["a non-0x allowed address", { allowedAssets: [{ address: "pepe.eth", symbol: "PEPE" }] }],
    ["a short blocked address", { blockedAssets: ["0x1234"] }],
    ["another network", { allowedNetwork: "ethereum" }],
    ["NaN allocation", { agentAllocationUsd: NaN }],
    ["infinite position", { maxPositionUsd: Infinity }],
    ["a missing limit", { dailyLossLimitPercent: undefined }],
    ["zero open positions", { maxOpenPositions: 0 }],
    ["more trades per hour than per day", { maxTradesPerHour: 9 }],
    ["a partial target with nothing to sell", { partialTakeProfitPercent: 5, partialTakeProfitFraction: 0 }],
    ["an hour past 23", { tradingHours: { enabled: true, startHour: 0, endHour: 24, days: [1] } }],
  ])("rejects %s", (_name, extra) => expect(parses(extra)).toBe(false));

  it("accepts the edges the rules allow", () => {
    expect(parses({ reserveUsd: 999.99 })).toBe(true);
    expect(parses({ maxPositionUsd: 1000 })).toBe(true);
    expect(parses({ defaultStopLossPercent: 5 })).toBe(true);
    expect(parses({ tradingHours: { enabled: false, startHour: 9, endHour: 17, days: [] } })).toBe(true);
  });

  it("sanitises symbols and lowercases addresses", () => {
    const parsed = MandateSchema.parse({
      ...mandate(),
      allowedAssets: [{ address: `0x${"AB".repeat(20)}`, symbol: '<b>PE$PE</b> "ignore previous"' }, { address: B, symbol: "<>" }],
      blockedAssets: [`0x${"CD".repeat(20)}`],
    });
    expect(parsed.allowedAssets).toEqual([{ address: `0x${"ab".repeat(20)}`, symbol: "bPE$PEbignorepre" }, { address: B, symbol: "TOKEN" }]);
    expect(parsed.blockedAssets).toEqual([`0x${"cd".repeat(20)}`]);
  });

  it.each(["2500", "", null, false, undefined, NaN])("does not coerce %j into a number", (value) => {
    expect(parses({ agentAllocationUsd: value })).toBe(false);
    expect(parses({ minimumLiquidityUsd: value })).toBe(false);
    expect(parses({ cooldownAfterLossMinutes: value })).toBe(false);
  });

  it("accepts zero for a floor that may be switched off", () => {
    expect(parses({ minimumLiquidityUsd: 0, minimumMarketCapUsd: 0, minimumTokenAgeHours: 0, cooldownAfterLossMinutes: 0, cooldownBetweenTradesMinutes: 0, reserveUsd: 0 })).toBe(true);
  });

  it("profileOf turns custom after any preset field is edited", () => {
    expect(profileOf(mandate())).toBe("balanced");
    expect(profileOf(mandate({ agentAllocationUsd: 5000, reserveUsd: 10 }))).toBe("balanced");
    expect(profileOf(mandate({ maxSlippagePercent: 1.5 }))).toBe("custom");
    expect(profileOf(mandate({ stopLossRequired: false }))).toBe("custom");
  });

  it("withinTradingHours", () => {
    const day = { enabled: true, startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] };
    expect([8, 9, 17, 18].map((hour) => withinTradingHours(day, 3, hour))).toEqual([false, true, true, false]);
    expect(withinTradingHours(day, 0, 12)).toBe(false);
    const night = { enabled: true, startHour: 22, endHour: 4, days: [5] };
    expect([21, 22, 23, 0, 4, 5, 12].map((hour) => withinTradingHours(night, 5, hour))).toEqual([false, true, true, true, true, false, false]);
    expect(withinTradingHours({ ...night, enabled: false }, 0, 12)).toBe(true);
    expect(withinTradingHours(day, 3, NaN)).toBe(false);
  });
});

describe("riskIncreases", () => {
  const before = () =>
    mandate({
      reserveUsd: 100,
      trailingStopPercent: 5,
      breakEvenTriggerPercent: 3,
      partialTakeProfitPercent: 4,
      blockedAssets: [B],
      tradingHours: { enabled: true, startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
    });
  const hours = before().tradingHours;

  it("is empty for identical mandates", () => expect(riskIncreases(before(), before())).toEqual([]));

  it.each<[string, Partial<Mandate>, RegExp]>([
    ["raise allocation", { agentAllocationUsd: 2000 }, /^Agent allocation: 1000 → 2000$/],
    ["raise max position", { maxPositionUsd: 200 }, /^Largest position \(USD\)/],
    ["lower reserve", { reserveUsd: 0 }, /^Untouchable reserve: 100 → 0$/],
    ["lower min liquidity", { minimumLiquidityUsd: 10_000 }, /^Minimum liquidity/],
    ["lower min risk/reward", { minimumRiskReward: 1 }, /^Minimum risk\/reward: 2 → 1$/],
    ["shorter cooldown between trades", { cooldownBetweenTradesMinutes: 5 }, /^Cooldown between trades/],
    ["shorter cooldown after a loss", { cooldownAfterLossMinutes: 0 }, /^Cooldown after a loss/],
    ["trailing stop off", { trailingStopPercent: 0 }, /^Trailing stop: turned off$/],
    ["break-even off", { breakEvenTriggerPercent: 0 }, /^Break-even trigger: turned off$/],
    ["partial profit off", { partialTakeProfitPercent: 0 }, /^Partial profit-taking: turned off$/],
    ["position lifetime off", { maxPositionLifetimeHours: 0 }, /^Longest time in a position: turned off$/],
    ["wider trailing stop", { trailingStopPercent: 8 }, /^Trailing stop: 5 → 8$/],
    ["longer position lifetime", { maxPositionLifetimeHours: 100 }, /^Longest time in a position: 72 → 100$/],
    ["stop loss no longer required", { stopLossRequired: false }, /^Stop loss: no longer required$/],
    ["paper to live", { mode: "live" }, /^Mode: Paper → Live$/],
    ["add an allowed asset", { allowedAssets: [{ address: A, symbol: "AAA" }, { address: C, symbol: "CCC" }] }, /^Assets added: CCC$/],
    ["remove a blocked asset", { blockedAssets: [] }, /^Assets unblocked: 1$/],
    ["later closing hour", { tradingHours: { ...hours, endHour: 18 } }, /^Trading hours: widened$/],
    ["an extra day", { tradingHours: { ...hours, days: [1, 2, 3, 4, 5, 6] } }, /^Trading hours: widened$/],
    ["trading hours disabled", { tradingHours: { ...hours, enabled: false } }, /^Trading hours: widened$/],
    ["wider max stop", { maxStopLossPercent: 6 }, /^Widest stop loss/],
    ["more slippage", { maxSlippagePercent: 1.5 }, /^Slippage allowed: 1 → 1.5$/],
  ])("flags: %s", (_name, change, expected) => {
    const changes = riskIncreases(before(), { ...before(), ...change });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatch(expected);
  });

  it.each<[string, Partial<Mandate>]>([
    ["lower allocation", { agentAllocationUsd: 500 }],
    ["smaller position", { maxPositionUsd: 50, maxPositionPercent: 5 }],
    ["remove an allowed asset", { allowedAssets: [] }],
    ["add to the blocklist", { blockedAssets: [B, C] }],
    ["narrower hours", { tradingHours: { ...hours, startHour: 10, endHour: 16, days: [2, 3] } }],
    ["tighter trailing stop", { trailingStopPercent: 3 }],
    ["shorter position lifetime", { maxPositionLifetimeHours: 24 }],
    ["higher minimum liquidity and risk/reward", { minimumLiquidityUsd: 100_000, minimumRiskReward: 3 }],
    ["longer cooldowns", { cooldownAfterLossMinutes: 60, cooldownBetweenTradesMinutes: 20 }],
    ["trading switched off", { tradingEnabled: false }],
    ["live to paper", { mode: "paper" }],
  ])("does not flag tightening: %s", (_name, change) => {
    const from = change.mode === "paper" ? { ...before(), mode: "live" as const } : before();
    expect(riskIncreases(from, { ...before(), ...change })).toEqual([]);
  });

  it("reports several loosenings together", () => {
    expect(riskIncreases(before(), { ...before(), agentAllocationUsd: 5000, stopLossRequired: false, mode: "live" })).toHaveLength(3);
  });

  it("flags switching trading on, and selling less at an active partial target", () => {
    expect(riskIncreases({ ...before(), tradingEnabled: false }, before())).toEqual(["Trading: switched on"]);
    expect(riskIncreases(before(), { ...before(), tradingEnabled: false })).toEqual([]);
    const partial = { ...before(), partialTakeProfitPercent: 5, partialTakeProfitFraction: 50 };
    expect(riskIncreases(partial, { ...partial, partialTakeProfitFraction: 1 })).toEqual(["Partial profit size: 50 → 1"]);
    expect(riskIncreases(partial, { ...partial, partialTakeProfitFraction: 75 })).toEqual([]);
    // With the partial target off, its size is not in force, so changing it is not a loosening.
    expect(riskIncreases(before(), { ...before(), partialTakeProfitPercent: 0, partialTakeProfitFraction: 1 }).some((change) => change.startsWith("Partial profit size"))).toBe(false);
  });
});

describe("trade states", () => {
  const lifecycle: TradeState[] = ["DISCOVERED", "PROPOSED", "APPROVED", "SIMULATED", "EXECUTING", "OPEN", "PARTIAL_EXIT", "CLOSED"];

  it("allows every step of the lifecycle", () => {
    for (let index = 0; index < lifecycle.length - 1; index++) expect(canTransition(lifecycle[index]!, lifecycle[index + 1]!), lifecycle[index]).toBe(true);
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
    expect(canTransition("PARTIAL_EXIT", "PARTIAL_EXIT")).toBe(true);
  });

  it.each(["RISK_REJECTED", "CLOSED", "FAILED", "CANCELLED"] as const)("%s is terminal", (state) => {
    expect(isTerminal(state)).toBe(true);
    for (const to of TRADE_STATES) expect(canTransition(state, to)).toBe(false);
  });

  it("only the four end states are terminal", () => {
    expect(TRADE_STATES.filter(isTerminal).sort()).toEqual(["CANCELLED", "CLOSED", "FAILED", "RISK_REJECTED"]);
  });

  it.each<[TradeState, TradeState]>([
    ["PROPOSED", "OPEN"],
    ["PROPOSED", "EXECUTING"],
    ["PROPOSED", "SIMULATED"],
    ["APPROVED", "EXECUTING"],
    ["APPROVED", "OPEN"],
    ["RISK_REJECTED", "APPROVED"],
    ["CLOSED", "OPEN"],
    ["DISCOVERED", "APPROVED"],
    ["SIMULATED", "OPEN"],
    ["EXECUTING", "CANCELLED"],
    ["EXECUTING", "RISK_REJECTED"],
    ["OPEN", "FAILED"],
    ["OPEN", "EXECUTING"],
  ])("refuses %s → %s", (from, to) => expect(canTransition(from, to)).toBe(false));

  it("lets the risk engine reject at every stage before execution", () => {
    for (const from of ["PROPOSED", "APPROVED", "SIMULATED"] as const) expect(canTransition(from, "RISK_REJECTED")).toBe(true);
  });
});

describe("permissions", () => {
  it("knows its own names", () => {
    expect(isPermission("EXECUTE_TRADE")).toBe(true);
    expect(isPermission("WITHDRAW_FUNDS")).toBe(false);
    expect(TRADING_AUTHORITY).toEqual(["PROPOSE_TRADE", "EXECUTE_TRADE"]);
    for (const permission of [...TRADING_AUTHORITY, ...REQUIRED_WITH_EXECUTE]) expect(PERMISSION_LIST).toContain(permission);
    expect(REQUIRED_WITH_EXECUTE).toContain("CLOSE_POSITION");
  });
});

describe("canonicalMandate", () => {
  it("ignores key order and list order, and sees real changes", () => {
    const mandate = presetMandate("balanced", 1000);
    const a = { ...mandate, allowedAssets: [{ address: `0x${"a".repeat(40)}`, symbol: "AAA" }, { address: `0x${"b".repeat(40)}`, symbol: "BBB" }], tradingHours: { ...mandate.tradingHours, days: [1, 3, 5] } };
    // The same mandate as a database would hand it back: keys reordered, lists in another order.
    const shuffled = Object.fromEntries(Object.entries(a).reverse()) as Mandate;
    const b = { ...shuffled, allowedAssets: [...a.allowedAssets].reverse(), tradingHours: { days: [5, 3, 1], endHour: a.tradingHours.endHour, startHour: a.tradingHours.startHour, enabled: a.tradingHours.enabled } };
    expect(canonicalMandate(b)).toBe(canonicalMandate(a));
    expect(canonicalMandate({ ...a, maxOpenPositions: a.maxOpenPositions + 1 })).not.toBe(canonicalMandate(a));
    expect(canonicalMandate({ ...a, allowedAssets: a.allowedAssets.slice(0, 1) })).not.toBe(canonicalMandate(a));
  });
});
