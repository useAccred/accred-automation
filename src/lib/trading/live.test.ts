import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mandate } from "./mandate";
import { TEST_APP_SECRET, buy, fakeDeps, landLater, loadApp, makeAgent, modelReply, removeAgent, snapshot, type App, type FakeState, type TestAgent, type TestAsset } from "./test-helpers";

/**
 * The Live Mode path against a real Postgres, with a fake chain and swap router. Opt-in:
 *   TRADING_TEST_DATABASE_URL=postgres://localhost:5432/accred_automation_trading pnpm vitest run src/lib/trading/live.test.ts
 * Nothing is signed or sent: the venue, the market and the model are stand-ins.
 */
const url = process.env.TRADING_TEST_DATABASE_URL;

const LOOSE: Partial<Mandate> = { mode: "live", maxTradesPerHour: 10, maxTradesPerDay: 20, cooldownBetweenTradesMinutes: 0, cooldownAfterLossMinutes: 0 };
const MINUTE = 60_000;
const GAS = 0.03;
const UNIT = 10n ** 18n;

describe.skipIf(!url)("live trading against the database and a fake chain", () => {
  let app: App;
  let loadPortfolio: typeof import("./store").loadPortfolio;
  const created: TestAgent[] = [];
  const liveBefore = process.env.LIVE_TRADING;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.APP_SECRET ??= TEST_APP_SECRET;
    vi.setConfig({ testTimeout: 30_000 });
    app = await loadApp();
    loadPortfolio = (await import("./store")).loadPortfolio;
    await quiet();
  }, 120_000);
  beforeEach(() => {
    process.env.LIVE_TRADING = "on";
  });
  afterEach(async () => {
    if (liveBefore === undefined) delete process.env.LIVE_TRADING;
    else process.env.LIVE_TRADING = liveBefore;
    for (const agent of created.splice(0)) await removeAgent(app, agent);
  });

  /**
   * Monitor ticks, recovery and settlement act on every agent in the database, each with the caller's own clock and
   * venue. Another test file doing that in parallel would fail this file's pending fills and pause its agents for
   * tokens its fake chain has never heard of (and this file's ticks would reach its positions). So this file waits
   * until no other client has used the test database for a moment, which in practice makes it run after the others.
   */
  const quiet = async () => {
    let calm = 0;
    for (let waited = 0; waited < 90_000; waited += 300) {
      const rows = await app.db.execute(
        sql`select count(*)::int as busy from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend' and (state <> 'idle' or state_change > now() - interval '2 seconds')`,
      );
      // Quiet has to last: at the very start the other files have not connected yet.
      calm = ((rows as unknown as { busy: number }[])[0]?.busy ?? 0) === 0 ? calm + 1 : 0;
      if (calm >= 5) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  type Live = TestAgent & { address: string };
  const liveAgent = async (options: Parameters<typeof makeAgent>[1] = {}, mode: "live" | "paper" = "live"): Promise<Live> => {
    const agent = await makeAgent(app, { ...options, mandate: { ...LOOSE, mode, ...options.mandate }, automation: { mode, ...options.automation } });
    created.push(agent);
    const [wallet] = await app.db.select().from(app.tradingWallets).where(app.eq(app.tradingWallets.id, agent.walletId));
    return { ...agent, address: wallet!.address.toLowerCase() };
  };
  /** Fake dependencies whose chain holds the agent's wallet with USDG and gas. */
  const funded = (agent: Live, usdg = 1000, ethWei = 10n ** 16n, initial: Partial<FakeState> = {}) => {
    const fake = fakeDeps(agent.assets, { replies: [modelReply(buy(agent.assets[0]!.symbol))], ...initial });
    fake.state.venue.usdg.set(agent.address, usdg);
    fake.state.venue.ethWei.set(agent.address, ethWei);
    return fake;
  };
  const by = (agent: TestAgent) => ({
    automation: async () => (await app.db.select().from(app.tradingAutomations).where(app.eq(app.tradingAutomations.id, agent.automationId)))[0]!,
    proposals: () => app.db.select().from(app.tradeProposals).where(app.eq(app.tradeProposals.automationId, agent.automationId)),
    executions: () => app.db.select().from(app.executions).where(app.eq(app.executions.automationId, agent.automationId)),
    sells: async () => (await app.db.select().from(app.executions).where(app.eq(app.executions.automationId, agent.automationId))).filter((row) => row.side === "sell").sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey)),
    positions: () => app.db.select().from(app.positions).where(app.eq(app.positions.automationId, agent.automationId)),
    evaluations: () => app.db.select().from(app.riskEvaluations).where(app.eq(app.riskEvaluations.automationId, agent.automationId)),
    audit: () => app.db.select().from(app.auditEvents).where(app.eq(app.auditEvents.userId, agent.userId)),
    portfolio: async (now: number) => loadPortfolio(app.db, (await app.db.select().from(app.tradingAutomations).where(app.eq(app.tradingAutomations.id, agent.automationId)))[0]!, agent.mandate, now),
  });
  const held = (state: FakeState, agent: Live, asset = agent.assets[0]!) => state.venue.tokens.get(`${agent.address}:${asset.address.toLowerCase()}`) ?? 0n;
  const failedChecks = async (agent: TestAgent, stage: "pre_trade" | "final") =>
    (await by(agent).evaluations()).filter((row) => row.stage === stage).flatMap((row) => (row.checks as { id: number; status: string; detail: string }[]).filter((check) => check.status === "fail"));

  /** One cycle in which the model buys $100 of the first asset through the fake venue. */
  const openLive = async (agent: Live, fake = funded(agent)) => {
    const result = await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect(result?.status, result?.summary).toBe("completed");
    const [position] = await by(agent).positions();
    expect(position?.status).toBe("open");
    return { ...fake, position: position!, chain: fake.state.venue };
  };
  /** A live proposal approved and simulated but not executed, with everything `executeEntry` needs. */
  const simulated = async (agent: Live, asset: TestAsset, fake: ReturnType<typeof funded>, state: "SIMULATED" | "EXECUTING" = "SIMULATED") => {
    const now = fake.state.now;
    const [run] = await app.db
      .insert(app.tradingRuns)
      .values({ automationId: agent.automationId, userId: agent.userId, trigger: "manual", mode: "live", status: "completed", mandateVersion: 1, strategyVersion: 1 })
      .returning({ id: app.tradingRuns.id });
    const [proposal] = await app.db
      .insert(app.tradeProposals)
      .values({ automationId: agent.automationId, runId: run!.id, userId: agent.userId, state, action: "BUY", assetAddress: asset.address, assetSymbol: asset.symbol, requestedUsd: 100, stopLossPercent: 2, takeProfitPercent: 5, reason: "test", mandateId: agent.mandateId, mandateVersion: 1, strategyVersion: 1 })
      .returning();
    const market = snapshot(asset, now);
    const quote = await fake.deps.venue.quote({ side: "buy", wallet: agent.address, token: asset.address, amountInRaw: 100_000_000n, slippagePercent: agent.mandate.maxSlippagePercent, market, now });
    const wallet = app.riskWallet(await fake.deps.venue.funds(agent.address));
    return { proposal: proposal!, market, quote, now, wallet, venue: fake.deps.venue };
  };
  const proposalState = async (id: string) => (await app.db.select().from(app.tradeProposals).where(app.eq(app.tradeProposals.id, id)))[0]!.state;
  const tick = async (fake: { deps: ReturnType<typeof fakeDeps>["deps"]; state: FakeState }, price?: number, asset?: TestAsset) => {
    if (price !== undefined && asset) fake.state.prices.set(asset.address, price);
    fake.state.now += MINUTE;
    return app.monitorTick(fake.deps);
  };

  // Found by the first real trade: a $3 buy in a thin pool filled 3.76% above the market price, inside the 5%
  // price impact the mandate allowed, and the monitor paused the agent for "abnormal slippage" because the fill's
  // distance from the market price had been recorded as its slippage. Slippage is the shortfall against the simulation.
  it("a: a fill inside its price-impact limit is not abnormal slippage", async () => {
    const agent = await liveAgent({ mandate: { maxSlippagePercent: 1, maxPriceImpactPercent: 5, maxStopLossPercent: 10, maxLossPerTradePercent: 10 } });
    const fake = funded(agent, 1000, 10n ** 16n, { replies: [modelReply(buy(agent.assets[0]!.symbol, 100, { stopLossPercent: 8, takeProfitPercent: 16 }))] });
    fake.state.venue.impactPercent = 3.76;
    const result = await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect(result?.status, result?.summary).toBe("completed");
    const [execution] = await by(agent).executions();
    expect(execution).toMatchObject({ status: "filled", side: "buy" });
    // The swap delivered exactly what its simulation did, so there was no slippage.
    expect(execution!.slippagePercent).toBe(0);
    // The cost of the fill against the market price is recorded as what it is.
    expect((execution!.quote as { filledImpactPercent?: number }).filledImpactPercent).toBeCloseTo(3.76, 3);
    await tick(fake);
    expect(await by(agent).automation()).toMatchObject({ status: "running", pausedBy: null });
    expect((await by(agent).positions())[0]!.status).toBe("open");
  });

  it("a: opens a live position end to end from the actual fill", async () => {
    const agent = await liveAgent();
    const { state, chain, position } = await openLive(agent);
    const [proposal] = await by(agent).proposals();
    expect(proposal!.state).toBe("OPEN");

    const evaluations = await by(agent).evaluations();
    expect(evaluations.map((row) => row.stage).sort()).toEqual(["final", "pre_trade"]);
    for (const row of evaluations) {
      // The checks that need a quote only run at the final stage; before it they are not failures.
      expect(row.approved).toBe(true);
      expect((row.checks as { status: string }[]).filter((check) => check.status === "fail")).toEqual([]);
      if (row.stage === "final") expect([row.passed, row.total]).toEqual([17, 17]);
      const inputs = row.inputs as { wallet?: { usdg: number } | null; quote?: { route?: Record<string, unknown> } | null };
      expect(inputs.wallet?.usdg).toBe(1000);
      if (row.stage === "final") {
        expect(inputs.quote?.route).toBeTruthy();
        expect(inputs.quote!.route).not.toHaveProperty("data");
      }
      expect(JSON.stringify(row.inputs)).not.toContain('"data":"0x00"');
    }

    const [execution] = await by(agent).executions();
    const spent = 100;
    const quantity = Number(held(state, agent)) / 1e18;
    expect(execution).toMatchObject({ status: "filled", mode: "live", side: "buy", idempotencyKey: `entry:${proposal!.id}`, positionId: position.id, networkFeeUsd: GAS });
    expect(execution!.txHash).toBe(chain.signed[0]);
    expect(chain.signed).toHaveLength(1);
    expect(execution!.notionalUsd).toBeCloseTo(spent, 9);
    expect(execution!.quantity).toBeCloseTo(quantity, 9);
    expect(execution!.priceUsd).toBeCloseTo(spent / quantity, 9);
    expect(execution!.priceUsd).toBeCloseTo(10 * 1.002, 4); // market × (1 + impact)
    expect(execution!.quantityRaw).toBe(held(state, agent).toString());

    expect(position).toMatchObject({ mode: "live", tokenDecimals: 18, quantityRaw: held(state, agent).toString() });
    expect(position.entryPriceUsd).toBeCloseTo(execution!.priceUsd, 12);
    expect(position.stopLossPrice).toBeCloseTo(position.entryPriceUsd * 0.98, 9);
    expect(position.takeProfitPrice).toBeCloseTo(position.entryPriceUsd * 1.05, 9);
    expect(position.feesUsd).toBeCloseTo(GAS, 12);

    const moves = (await by(agent).audit()).filter((event) => event.type === "trade.transition" && event.proposalId === proposal!.id).map((event) => event.data as { from: string; to: string; txHash?: string });
    const trail = ["DISCOVERED"];
    for (let next = moves.find((move) => move.from === "DISCOVERED"); next && trail.length < 20; next = moves.find((move) => move.from === trail.at(-1))) trail.push(next.to);
    expect(trail).toEqual(["DISCOVERED", "PROPOSED", "APPROVED", "SIMULATED", "EXECUTING", "OPEN"]);
    expect(JSON.stringify(moves.find((move) => move.to === "OPEN"))).toContain(chain.signed[0]);
    expect(chain.usdg.get(agent.address)).toBeCloseTo(1000 - spent, 9);
  });

  it.each([
    ["take profit", 11, "take_profit"],
    ["stop loss", 9, "stop_loss"],
  ])("b: a full round trip closed by %s reconciles with the chain's USDG", async (_name, price, reason) => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    await tick(fake, price, agent.assets[0]);
    const [position] = await by(agent).positions();
    expect(position).toMatchObject({ status: "closed", quantityRaw: "0", quantity: 0, closeReason: reason });
    const [sell] = await by(agent).sells();
    expect(sell).toMatchObject({ status: "filled", mode: "live", reason, txHash: fake.chain.signed[1], networkFeeUsd: GAS });
    const received = fake.chain.usdg.get(agent.address)! - 900;
    expect(sell!.notionalUsd).toBeCloseTo(received, 9);
    expect(sell!.realizedPnlUsd).toBeCloseTo(received - position!.entryPriceUsd * sell!.quantity, 9);
    expect(held(fake.state, agent)).toBe(0n);

    const portfolio = await by(agent).portfolio(fake.state.now);
    expect(portfolio.realizedNetUsd).toBeCloseTo(sell!.realizedPnlUsd! - 2 * GAS, 9);
    expect(Math.abs(portfolio.realizedNetUsd - (fake.chain.usdg.get(agent.address)! - 1000 - 2 * GAS))).toBeLessThan(1e-6);
    expect(portfolio.openPositions).toBe(0);
    expect((await by(agent).proposals())[0]!.state).toBe("CLOSED");
  });

  it("b: a partial take profit keeps the rest open, then the full close reconciles", async () => {
    const agent = await liveAgent({ mandate: { partialTakeProfitPercent: 2, partialTakeProfitFraction: 50 } });
    const fake = await openLive(agent);
    const bought = held(fake.state, agent);
    await tick(fake, 10.3, agent.assets[0]);
    let [position] = await by(agent).positions();
    expect(position).toMatchObject({ status: "open", partialTaken: true, quantityRaw: held(fake.state, agent).toString() });
    expect(held(fake.state, agent)).toBe(bought - bought / 2n);
    expect((await by(agent).proposals())[0]!.state).toBe("PARTIAL_EXIT");

    await tick(fake, 11, agent.assets[0]);
    [position] = await by(agent).positions();
    expect(position).toMatchObject({ status: "closed", quantityRaw: "0" });
    const sells = await by(agent).sells();
    expect(sells.map((sell) => [sell.status, sell.idempotencyKey])).toEqual([["filled", `exit:${position!.id}:0`], ["filled", `exit:${position!.id}:1`]]);
    for (const sell of sells) expect(sell.realizedPnlUsd).toBeCloseTo(sell.notionalUsd - position!.entryPriceUsd * sell.quantity, 9);
    const portfolio = await by(agent).portfolio(fake.state.now);
    expect(portfolio.realizedNetUsd).toBeCloseTo(sells[0]!.realizedPnlUsd! + sells[1]!.realizedPnlUsd! - 3 * GAS, 9);
    expect(Math.abs(portfolio.realizedNetUsd - (fake.chain.usdg.get(agent.address)! - 1000 - 3 * GAS))).toBeLessThan(1e-6);
  });

  it("c: with LIVE_TRADING off a live agent trades nothing, and a paper agent is retired when it is on", async () => {
    delete process.env.LIVE_TRADING;
    const agent = await liveAgent();
    const fake = funded(agent);
    const result = await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect(result?.status).toBe("skipped");
    expect(result?.summary).toContain("switched off");
    const entry = await simulated(agent, agent.assets[0]!, fake);
    const outcome = await app.executeEntry(entry);
    expect(outcome.status).toBe("rejected");
    expect((await failedChecks(agent, "final")).map((check) => check.id)).toContain(1);
    expect(fake.state.venue.signed).toEqual([]);
    expect(await by(agent).executions()).toEqual([]);

    process.env.LIVE_TRADING = "on";
    const paper = await liveAgent({}, "paper");
    const paperFake = funded(paper);
    const skipped = await app.runTradingCycle(paper.automationId, "manual", paperFake.deps);
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.summary).toContain("retired");
    expect(paperFake.state.calls).toEqual([]);
    expect(paperFake.state.venue.signed).toEqual([]);
  });

  it.each<[string, number, bigint, boolean, string]>([
    ["too little USDG", 50, 10n ** 16n, false, "of USDG"],
    ["too little ETH for gas", 1000, 10n ** 14n - 1n, false, "network fee"],
    ["unreadable balances", 1000, 10n ** 16n, true, "could not be read"],
  ])("d: the wallet check rejects with %s and signs nothing", async (_name, usdg, ethWei, unreadable, message) => {
    const agent = await liveAgent();
    const fake = funded(agent, usdg, ethWei);
    fake.state.venue.unreadable = unreadable;
    await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect((await by(agent).proposals()).map((proposal) => proposal.state)).toEqual(["RISK_REJECTED"]);
    const failed = await failedChecks(agent, "pre_trade");
    expect(failed.map((check) => check.id)).toContain(2);
    expect(failed.find((check) => check.id === 2)!.detail).toContain(message);
    expect(fake.state.venue.signed).toEqual([]);
    expect(await by(agent).executions()).toEqual([]);
  });

  it("e: a failed simulation is rejected at the final check and reserves nothing", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    fake.state.venue.fail = "simulate";
    await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect((await by(agent).proposals()).map((proposal) => proposal.state)).toEqual(["RISK_REJECTED"]);
    expect((await failedChecks(agent, "final")).map((check) => check.id)).toContain(15);
    expect(await by(agent).executions()).toEqual([]);
    expect(fake.state.venue.signed).toEqual([]);
    expect((await by(agent).automation()).simulationFailures).toBe(1);
  });

  it("f: a reverted swap fails the trade, releases the capital and books the gas", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    fake.state.venue.fail = "revert";
    await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect((await by(agent).proposals()).map((proposal) => proposal.state)).toEqual(["FAILED"]);
    const [execution] = await by(agent).executions();
    expect(execution).toMatchObject({ status: "failed", networkFeeUsd: GAS, notionalUsd: 0, txHash: fake.state.venue.signed[0], positionId: null });
    expect(execution!.error).toContain("reverted");
    expect(await by(agent).positions()).toEqual([]);
    const full = await by(agent).portfolio(fake.state.now);
    expect(full).toMatchObject({ openPositions: 0, openCostUsd: 0 });
    expect(full.availableUsd).toBeCloseTo(full.allocationUsd - full.reserveUsd - GAS, 9);
    expect(full.feesUsd).toBeCloseTo(GAS, 9);
    expect(full.realizedNetUsd).toBeCloseTo(-GAS, 9);
    expect(full.dayNetUsd).toBeCloseTo(-GAS, 9);
    expect(fake.state.notes.some((note) => note.includes("FAILED"))).toBe(true);
    expect(fake.state.venue.usdg.get(agent.address)).toBe(1000);
  });

  it("g: an unconfirmed swap stays reserved until the chain settles it, exactly once", async () => {
    const agent = await liveAgent({ assets: 2, mandate: { maxOpenPositions: 1 } });
    const fake = funded(agent);
    const { state } = fake;
    state.venue.fail = "uncertain";
    const entry = await simulated(agent, agent.assets[0]!, fake);
    expect(await app.executeEntry(entry)).toMatchObject({ status: "pending" });
    let [execution] = await by(agent).executions();
    expect(execution).toMatchObject({ status: "pending", txHash: state.venue.signed[0], notionalUsd: 100 });
    expect(await proposalState(entry.proposal.id)).toBe("EXECUTING");

    const reserved = await by(agent).portfolio(state.now);
    expect(reserved).toMatchObject({ openCostUsd: 100, openPositions: 1, openAssets: [agent.assets[0]!.address], tradesToday: 1 });
    // A second entry would be a second open position: the pending one already counts.
    state.venue.fail = null;
    const second = await simulated(agent, agent.assets[1]!, fake);
    expect((await app.executeEntry(second)).status).toBe("rejected");
    expect(state.venue.signed).toHaveLength(1);

    await app.recoverInterrupted(state.now + 10 * MINUTE);
    expect(await proposalState(entry.proposal.id)).toBe("EXECUTING");
    await app.settlePending(state.now + 2 * MINUTE, fake.deps.venue);
    expect((await by(agent).executions())[0]!.status).toBe("pending");
    // Not on the chain yet: still pending after the first look.
    await app.settlePending(state.now + 4 * MINUTE, fake.deps.venue);
    expect((await by(agent).executions())[0]!.status).toBe("pending");

    const fill = { ok: true as const, txHash: execution!.txHash as `0x${string}`, inRaw: 99_500_000n, outRaw: 9n * UNIT, gasUsd: GAS };
    landLater(state.venue, execution!.txHash!, fill);
    expect(await app.settlePending(state.now + 4 * MINUTE, fake.deps.venue)).toBe(1);
    expect(await proposalState(entry.proposal.id)).toBe("OPEN");
    // Settling again, by either route, changes nothing.
    expect(await app.settlePending(state.now + 5 * MINUTE, fake.deps.venue)).toBe(0);
    expect((await app.settleEntry(execution!.id, fill, state.now + 5 * MINUTE)).status).toBe("duplicate");
    const positions = await by(agent).positions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ mode: "live", status: "open", quantityRaw: (9n * UNIT).toString(), quantity: 9 });
    expect(positions[0]!.entryPriceUsd).toBeCloseTo(99.5 / 9, 9);
    [execution] = (await by(agent).executions()).filter((row) => row.status === "filled");
    expect(execution).toMatchObject({ status: "filled", notionalUsd: 99.5, positionId: positions[0]!.id });
    expect((await by(agent).executions()).filter((row) => row.status === "filled")).toHaveLength(1);
  });

  it("g: an unconfirmed swap that never lands is given up after fifteen minutes", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    fake.state.venue.fail = "uncertain";
    const result = await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    expect(result?.status, result?.summary).toBe("completed");
    expect(fake.state.notes.some((note) => note.includes("PENDING"))).toBe(true);
    await app.settlePending(fake.state.now + 14 * MINUTE, fake.deps.venue);
    expect((await by(agent).executions())[0]!.status).toBe("pending");
    await app.settlePending(fake.state.now + 16 * MINUTE, fake.deps.venue);
    const [execution] = await by(agent).executions();
    expect(execution).toMatchObject({ status: "failed", notionalUsd: 0 });
    expect(execution!.error).toContain("never appeared");
    expect((await by(agent).proposals())[0]!.state).toBe("FAILED");
    expect(await by(agent).portfolio(fake.state.now + 16 * MINUTE)).toMatchObject({ openPositions: 0, openCostUsd: 0 });
    expect(await by(agent).positions()).toEqual([]);

    // Writing it off here is safe: the wallet has since confirmed a transaction in its place, so it can never land.
    expect(execution!.error).toContain("taken by a later transaction");
  });

  it("g: an unconfirmed buy whose place on the chain is still open stays reserved and pauses the agent", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    fake.state.venue.fail = "uncertain";
    // The wallet has not confirmed anything since, so the buy could still land.
    fake.state.venue.nonceConsumed = false;
    await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    const automation = async () => (await app.db.select().from(app.tradingAutomations).where(app.eq(app.tradingAutomations.id, agent.automationId)))[0]!;
    const flagged = async () =>
      app.db
        .select()
        .from(app.auditEvents)
        .where(app.and(app.eq(app.auditEvents.automationId, agent.automationId), app.eq(app.auditEvents.type, "execution.unconfirmed")));

    expect(await app.settlePending(fake.state.now + 16 * MINUTE, fake.deps.venue)).toBe(0);
    const [pending] = await by(agent).executions();
    // Not written off: the capital stays reserved and the trade is still in flight.
    expect(pending).toMatchObject({ status: "pending" });
    expect((pending!.quote as { nonce?: number }).nonce).toBe(0);
    expect((await by(agent).proposals())[0]!.state).toBe("EXECUTING");
    expect(await by(agent).portfolio(fake.state.now + 16 * MINUTE)).toMatchObject({ openPositions: 1, openCostUsd: 100 });
    // New trading is paused until it is settled, and the reason is on record once.
    expect(await automation()).toMatchObject({ status: "paused", pausedBy: "breaker" });
    expect(await flagged()).toHaveLength(1);
    await app.settlePending(fake.state.now + 18 * MINUTE, fake.deps.venue);
    expect(await flagged()).toHaveLength(1);

    // It lands after all: the books pick it up from the receipt.
    landLater(fake.state.venue, pending!.txHash!, { ok: true, txHash: pending!.txHash as `0x${string}`, inRaw: 100_000_000n, outRaw: 9n * UNIT, gasUsd: GAS });
    expect(await app.settlePending(fake.state.now + 20 * MINUTE, fake.deps.venue)).toBe(1);
    expect((await by(agent).executions())[0]).toMatchObject({ status: "filled", notionalUsd: 100 });
    expect((await by(agent).proposals())[0]!.state).toBe("OPEN");
    expect(await by(agent).positions()).toHaveLength(1);
  });

  it("g: an unconfirmed buy is written off once a later transaction takes its place", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    fake.state.venue.fail = "uncertain";
    fake.state.venue.nonceConsumed = false;
    await app.runTradingCycle(agent.automationId, "manual", fake.deps);
    await app.settlePending(fake.state.now + 16 * MINUTE, fake.deps.venue);
    expect((await by(agent).executions())[0]!.status).toBe("pending");
    // The wallet confirms something else with that nonce, and the buy still has no receipt.
    fake.state.venue.nonceConsumed = true;
    expect(await app.settlePending(fake.state.now + 17 * MINUTE, fake.deps.venue)).toBe(1);
    expect((await by(agent).executions())[0]).toMatchObject({ status: "failed", notionalUsd: 0 });
    expect((await by(agent).proposals())[0]!.state).toBe("FAILED");
    expect(await by(agent).portfolio(fake.state.now + 17 * MINUTE)).toMatchObject({ openPositions: 0, openCostUsd: 0 });
  });

  it("i: an unconfirmed sale is written off after fifteen minutes so the exit can be retried", async () => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.chain.fail = "uncertain";
    fake.chain.nonceConsumed = false;
    await tick(fake, 9, agent.assets[0]);
    expect((await by(agent).sells()).map((sell) => sell.status)).toEqual(["pending"]);
    // A protective exit must not stay blocked behind a sale that may never confirm.
    expect(await app.settlePending(fake.state.now + 16 * MINUTE, fake.deps.venue)).toBe(1);
    const [writtenOff] = await by(agent).sells();
    expect(writtenOff).toMatchObject({ status: "failed" });
    expect(writtenOff!.error).toContain("written off");
    expect((await by(agent).positions())[0]!.status).toBe("open");

    fake.chain.fail = null;
    fake.state.now += 16 * MINUTE;
    await tick(fake, 9, agent.assets[0]);
    const sells = await by(agent).sells();
    expect(sells.map((sell) => sell.status).sort()).toEqual(["failed", "filled"]);
    expect(new Set(sells.map((sell) => sell.idempotencyKey)).size).toBe(2);
    expect((await by(agent).positions())[0]).toMatchObject({ status: "closed", quantityRaw: "0" });
  });

  it("h: a reservation that was never signed is failed by recovery", async () => {
    const agent = await liveAgent();
    const fake = funded(agent);
    const entry = await simulated(agent, agent.assets[0]!, fake, "EXECUTING");
    await app.db.insert(app.executions).values({
      automationId: agent.automationId,
      proposalId: entry.proposal.id,
      idempotencyKey: `entry:${entry.proposal.id}`,
      side: "buy",
      reason: "entry",
      assetAddress: entry.proposal.assetAddress,
      symbol: entry.proposal.assetSymbol,
      mandateId: agent.mandateId,
      mandateVersion: 1,
      createdAt: new Date(entry.now),
      mode: "live",
      status: "pending",
      quantity: entry.quote.quantity,
      quantityRaw: entry.quote.simulatedOutRaw,
      priceUsd: entry.quote.priceUsd,
      notionalUsd: 100,
      slippagePercent: 0,
      quote: { stopLossPercent: 2, takeProfitPercent: 5, marketPriceUsd: 10, lifetimeHours: 0, tokenDecimals: 18 },
    });
    await app.recoverInterrupted(entry.now + 10 * MINUTE);
    expect(await proposalState(entry.proposal.id)).toBe("EXECUTING");
    expect(await app.settlePending(entry.now + 2 * MINUTE, fake.deps.venue)).toBe(0);
    expect(await app.settlePending(entry.now + 4 * MINUTE, fake.deps.venue)).toBe(1);
    const [execution] = await by(agent).executions();
    expect(execution).toMatchObject({ status: "failed", txHash: null, networkFeeUsd: 0 });
    expect(execution!.error).toContain("never signed or sent");
    expect(await proposalState(entry.proposal.id)).toBe("FAILED");
    expect(fake.state.venue.signed).toEqual([]);
  });

  it("i: a failed sale keeps the position open and is retried with a new key and twice the slippage", async () => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.chain.fail = "revert";
    await tick(fake, 9, agent.assets[0]);
    let [position] = await by(agent).positions();
    expect(position!.status).toBe("open");
    expect(position!.feesUsd).toBeCloseTo(2 * GAS, 9);
    expect(position!.quantityRaw).toBe(held(fake.state, agent).toString());
    let sells = await by(agent).sells();
    expect(sells).toHaveLength(1);
    expect(sells[0]).toMatchObject({ status: "failed", idempotencyKey: `exit:${position!.id}:0`, networkFeeUsd: GAS, txHash: fake.chain.signed[1] });
    expect((await by(agent).audit()).filter((event) => event.type === "position.exit_failed")).toHaveLength(1);
    expect(fake.state.notes.some((note) => note.includes("SALE FAILED"))).toBe(true);
    expect((await by(agent).automation()).simulationFailures).toBe(1);

    fake.chain.fail = null;
    await tick(fake);
    [position] = await by(agent).positions();
    expect(position).toMatchObject({ status: "closed", quantityRaw: "0" });
    sells = await by(agent).sells();
    expect(sells.map((sell) => [sell.status, sell.idempotencyKey])).toEqual([["failed", `exit:${position!.id}:0`], ["filled", `exit:${position!.id}:1`]]);
    const floor = Math.max(agent.mandate.maxSlippagePercent, 2);
    expect(fake.chain.slippageAsked).toEqual([agent.mandate.maxSlippagePercent, floor, floor * 2]);
    // The gas of the failed attempt is part of the result.
    expect((await by(agent).portfolio(fake.state.now)).realizedNetUsd).toBeCloseTo(sells[1]!.realizedPnlUsd! - 3 * GAS, 9);
  });

  it("i: a sale that is on its way blocks a second one", async () => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.chain.fail = "uncertain";
    await tick(fake, 9, agent.assets[0]);
    await tick(fake);
    const sells = await by(agent).sells();
    expect(sells.map((sell) => sell.status)).toEqual(["pending"]);
    expect(fake.chain.signed).toHaveLength(2);
    expect((await by(agent).positions())[0]!.status).toBe("open");
    const market = snapshot(agent.assets[0]!, fake.state.now, { priceUsd: 9 });
    expect(await app.executeExit({ positionId: fake.position.id, reason: "stop_loss", fraction: 1, market, networkFeeUsd: null, now: fake.state.now, venue: fake.deps.venue })).toEqual({ status: "skipped" });
  });

  it("j: parallel entries and parallel exits happen once", async () => {
    const agent = await liveAgent({ assets: 2, mandate: { maxOpenPositions: 1 } });
    const fake = funded(agent);
    const entries = [await simulated(agent, agent.assets[0]!, fake), await simulated(agent, agent.assets[1]!, fake)];
    const outcomes = await Promise.all(entries.map((entry) => app.executeEntry(entry)));
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["opened", "rejected"]);
    expect(await by(agent).executions()).toHaveLength(1);
    expect(fake.state.venue.signed).toHaveLength(1);
    const [position] = await by(agent).positions();
    expect(await by(agent).positions()).toHaveLength(1);

    const asset = agent.assets.find((entry) => entry.address === position!.assetAddress)!;
    const exit = { positionId: position!.id, reason: "manual_close" as const, fraction: 1, market: snapshot(asset, fake.state.now), networkFeeUsd: null, now: fake.state.now, venue: fake.deps.venue };
    const exits = await Promise.all([app.executeExit(exit), app.executeExit(exit)]);
    expect(exits.map((outcome) => outcome.status).sort()).toEqual(["filled", "skipped"]);
    expect(await by(agent).sells()).toHaveLength(1);
    expect(fake.state.venue.signed).toHaveLength(2);
    expect(held(fake.state, agent, asset)).toBe(0n);
  });

  it("k: tokens missing from the wallet pause the agent; an intact balance does not", async () => {
    const intact = await liveAgent();
    const calm = await openLive(intact);
    await tick(calm);
    expect((await by(intact).automation()).status).toBe("running");
    expect((await by(intact).audit()).filter((event) => event.type === "wallet.mismatch")).toEqual([]);
    await removeAgent(app, intact);

    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.chain.tokens.set(`${agent.address}:${agent.assets[0]!.address}`, held(fake.state, agent) - 1n);
    fake.state.now += MINUTE;
    await tick(fake);
    expect((await by(agent).audit()).filter((event) => event.type === "wallet.mismatch")).toHaveLength(1);
    expect(await by(agent).automation()).toMatchObject({ status: "paused", pausedBy: "breaker" });
    expect((await by(agent).positions())[0]!.status).toBe("open");
  });

  it.each(["wallet revoked", "agent paused"])("l: the kill switch stops a live entry at the last moment (%s)", async (how) => {
    const agent = await liveAgent();
    const fake = funded(agent);
    const entry = await simulated(agent, agent.assets[0]!, fake);
    if (how === "wallet revoked") await app.db.update(app.tradingWallets).set({ tradingRevokedAt: new Date() }).where(app.eq(app.tradingWallets.id, agent.walletId));
    else await app.db.update(app.tradingAutomations).set({ status: "paused", pausedBy: "user" }).where(app.eq(app.tradingAutomations.id, agent.automationId));
    expect((await app.executeEntry(entry)).status).toBe("rejected");
    expect(await proposalState(entry.proposal.id)).toBe("RISK_REJECTED");
    expect(await by(agent).executions()).toEqual([]);
    expect(fake.state.venue.signed).toEqual([]);
    expect(fake.state.venue.usdg.get(agent.address)).toBe(1000);
  });

  it("m: closePosition sells a live position through the venue, and waits when there is no price", async () => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.state.prices.set(agent.assets[0]!.address, null);
    expect(await app.closePosition(fake.position.id, "manual_close", fake.deps)).toEqual({ status: "no_price" });
    expect(fake.chain.signed).toHaveLength(1);
    fake.state.prices.set(agent.assets[0]!.address, 10.5);
    const outcome = await app.closePosition(fake.position.id, "manual_close", fake.deps);
    expect(outcome).toMatchObject({ status: "filled", closed: true, txHash: fake.chain.signed[1] });
    expect((await by(agent).sells())[0]).toMatchObject({ status: "filled", reason: "manual_close", txHash: fake.chain.signed[1] });
    expect((await by(agent).positions())[0]).toMatchObject({ status: "closed", quantityRaw: "0", closeReason: "manual_close" });
  });

  it("n: no audit entry or stored quote carries a key or route calldata", async () => {
    const agent = await liveAgent();
    const fake = await openLive(agent);
    fake.chain.fail = "revert";
    await tick(fake, 9, agent.assets[0]);
    fake.chain.fail = null;
    await tick(fake);
    const [wallet] = await app.db.select().from(app.tradingWallets).where(app.eq(app.tradingWallets.id, agent.walletId));
    const stored = JSON.stringify([await by(agent).audit(), (await by(agent).executions()).map((row) => row.quote), (await by(agent).evaluations()).map((row) => row.inputs)]);
    expect(stored.length).toBeGreaterThan(1000);
    for (const secret of [wallet!.keyEnc, agent.walletKeyEnc, agent.userKeyEnc, "privateKey", "keyEnc", '"data":"0x00"', '"data":"0x']) expect(stored).not.toContain(secret);
    for (const row of await by(agent).executions()) expect((row.quote as { route?: object }).route ?? {}).not.toHaveProperty("data");
  });
});
