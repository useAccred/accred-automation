import { describe, expect, it } from "vitest";
import type { WebBotWatch } from "../db";
import { parseWatch, pricesCrossed } from "./watches";

describe("web bot alert parsing", () => {
  it("reads price thresholds in any case and phrasing", () => {
    expect(parseWatch("ETH below 2000")).toEqual({ kind: "price_below", asset: "ETH", threshold: 2000 });
    expect(parseWatch("eth < 2000")).toEqual({ kind: "price_below", asset: "eth", threshold: 2000 });
    expect(parseWatch("message me on telegram when btc goes above 70k")).toEqual({ kind: "price_above", asset: "btc", threshold: 70_000 });
    expect(parseWatch("sol falls to 120")).toEqual({ kind: "price_below", asset: "sol", threshold: 120 });
    expect(parseWatch("$cred reaches 0.1")).toEqual({ kind: "price_above", asset: "cred", threshold: 0.1 });
  });
  it("reads event watches", () => {
    expect(parseWatch("position closed")).toEqual({ kind: "position_closed", agent: undefined });
    expect(parseWatch("when a run fails")).toEqual({ kind: "run_failed", agent: undefined });
    expect(parseWatch("agent paused for Momentum")).toEqual({ kind: "agent_paused", agent: "Momentum" });
  });
  it("rejects what it cannot read", () => {
    expect(parseWatch("send me a joke")).toBeNull();
  });
});

describe("price crossing", () => {
  const watch = (over: Partial<WebBotWatch>): WebBotWatch =>
    ({ id: "w", botId: "b", userId: "u", kind: "price_below", assetAddress: null, assetSymbol: "BTC", coingeckoId: "bitcoin", thresholdUsd: 60_000, agentId: null, status: "active", firedCount: 0, lastFiredAt: null, createdAt: new Date(), ...over }) as WebBotWatch;
  it("matches coins by id and chain tokens by address", () => {
    expect(pricesCrossed([watch({})], new Map([["bitcoin", 59_000]]))).toHaveLength(1);
    expect(pricesCrossed([watch({})], new Map([["bitcoin", 61_000]]))).toHaveLength(0);
    expect(pricesCrossed([watch({ coingeckoId: null, assetAddress: "0xabc", kind: "price_above", thresholdUsd: 2 })], new Map([["0xabc", 2.5]]))).toHaveLength(1);
    expect(pricesCrossed([watch({ status: "fired" })], new Map([["bitcoin", 1]]))).toHaveLength(0);
  });
});
