import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hex, Log } from "viem";
import { CHAIN_ID, SWAP_ROUTER, USDG } from "./chain";
import { VenueError, fetchRoute, validateRoute, type RouteRequest, type SwapRoute } from "./lifi";
import { buildLiveQuote, quoteRecord, transferred, type QuoteRequest } from "./live-venue";
import type { MarketSnapshot } from "./market-data";

/**
 * Pure unit tests for Live Mode's route validation, quote maths and log
 * reading. Nothing here touches a database, the chain or the network: the one
 * function that fetches is given a fake `fetch`.
 */

const NOW = Date.UTC(2026, 0, 14, 12, 0, 0);
const WALLET = `0x${"ab".repeat(20)}`;
const WALLET_MIXED = `0x${"aB".repeat(20)}`;
const OTHER_WALLET = `0x${"cd".repeat(20)}`;
const TOKEN = `0x${"1e".repeat(20)}`;
const OTHER_TOKEN = `0x${"2f".repeat(20)}`;
const ROUTER_MIXED = `0x${SWAP_ROUTER.slice(2).toUpperCase()}`;
const AMOUNT_IN = 100_000_000n; // 100 USDG

interface QuoteBody {
  tool: unknown;
  transactionRequest: Record<string, unknown>;
  estimate: Record<string, unknown>;
  action: { fromChainId: unknown; toChainId: unknown; fromAmount: unknown; fromToken: Record<string, unknown>; toToken: Record<string, unknown> };
}

function routeRequest(over: Partial<RouteRequest> = {}): RouteRequest {
  return { wallet: WALLET, tokenIn: USDG.address, tokenOut: TOKEN, amountIn: AMOUNT_IN, slippagePercent: 1, ...over };
}

/** A well-formed LI.FI quote for `routeRequest()`. */
function lifiQuote(): QuoteBody {
  return {
    tool: "sushiswap",
    transactionRequest: { to: SWAP_ROUTER, from: WALLET, data: "0xabcdef", value: "0x0", chainId: 4663, gasLimit: "0xea3e9" },
    estimate: { approvalAddress: SWAP_ROUTER, toAmount: "50000000000000000000", toAmountMin: "49500000000000000000" },
    action: { fromChainId: 4663, toChainId: 4663, fromAmount: AMOUNT_IN.toString(), fromToken: { address: USDG.address }, toToken: { address: TOKEN } },
  };
}

function mutated(change: (quote: QuoteBody) => void): QuoteBody {
  const quote = lifiQuote();
  change(quote);
  return quote;
}

const validate = (body: unknown, request: RouteRequest = routeRequest()) => validateRoute(body, request, NOW);

describe("validateRoute", () => {
  it("accepts a well-formed route and returns what was validated", () => {
    expect(CHAIN_ID).toBe(4663);
    const route = validate(lifiQuote());
    expect(route).toEqual({
      tool: "sushiswap",
      tokenIn: USDG.address,
      tokenOut: TOKEN as Hex,
      amountIn: AMOUNT_IN,
      to: SWAP_ROUTER,
      data: "0xabcdef",
      gasLimit: 0xea3e9n,
      toAmount: 50_000_000_000_000_000_000n,
      toAmountMin: 49_500_000_000_000_000_000n,
      fetchedAt: NOW,
    } satisfies SwapRoute);
  });

  it("treats mixed-case addresses as the same address and returns them lowercased", () => {
    const tokenInMixed = `0x${USDG.address.slice(2).toUpperCase()}`;
    const tokenOutMixed = `0x${"1E".repeat(20)}`;
    const body = mutated((quote) => {
      quote.transactionRequest.to = ROUTER_MIXED;
      quote.transactionRequest.from = WALLET_MIXED;
      quote.estimate.approvalAddress = ROUTER_MIXED;
      quote.action.fromToken.address = tokenInMixed;
      quote.action.toToken.address = tokenOutMixed;
    });
    // LI.FI answers in mixed case for a lowercase request...
    const route = validate(body);
    expect(route.to).toBe(SWAP_ROUTER);
    expect(route.tokenIn).toBe(USDG.address);
    expect(route.tokenOut).toBe(TOKEN);
    // ...and a mixed-case request matches a lowercase answer.
    const reverse = validate(lifiQuote(), routeRequest({ wallet: WALLET_MIXED, tokenIn: tokenInMixed, tokenOut: tokenOutMixed }));
    expect(reverse.tokenIn).toBe(USDG.address);
    expect(reverse.tokenOut).toBe(TOKEN);
    expect(reverse.to).toBe(SWAP_ROUTER);
  });

  it("accepts decimal and hex strings for amounts, a missing value, and a string chain id", () => {
    const route = validate(
      mutated((quote) => {
        quote.transactionRequest.value = undefined;
        quote.transactionRequest.chainId = "4663";
        quote.transactionRequest.gasLimit = "5000000";
        quote.action.fromAmount = `0x${AMOUNT_IN.toString(16)}`;
        quote.estimate.toAmount = "0x10";
        quote.estimate.toAmountMin = "16";
      }),
    );
    expect(route.gasLimit).toBe(5_000_000n);
    expect(route.toAmount).toBe(16n);
    expect(route.toAmountMin).toBe(16n);
  });

  it("strips anything unusual from the tool name and caps its length", () => {
    expect(validate(mutated((quote) => (quote.tool = "sushi<script>alert(1)</script> swap"))).tool).toBe("sushiscriptalert1scriptswap");
    expect(validate(mutated((quote) => (quote.tool = "x".repeat(100)))).tool).toHaveLength(32);
    expect(validate(mutated((quote) => (quote.tool = undefined))).tool).toBe("unknown");
  });

  const rejected: Array<[string, (quote: QuoteBody) => void]> = [
    ["tx.to is another address", (q) => (q.transactionRequest.to = OTHER_WALLET)],
    ["tx.to is missing", (q) => (q.transactionRequest.to = undefined)],
    ["tx.to is the router with a trailing character", (q) => (q.transactionRequest.to = `${SWAP_ROUTER}0`)],
    ["approvalAddress is another address", (q) => (q.estimate.approvalAddress = OTHER_WALLET)],
    ["approvalAddress is missing", (q) => (q.estimate.approvalAddress = undefined)],
    ["tx.from is another wallet", (q) => (q.transactionRequest.from = OTHER_WALLET)],
    ["tx.from is missing", (q) => (q.transactionRequest.from = undefined)],
    ["tx.chainId is 1", (q) => (q.transactionRequest.chainId = 1)],
    ["tx.chainId is missing", (q) => (q.transactionRequest.chainId = undefined)],
    ["fromChainId is another chain", (q) => (q.action.fromChainId = 1)],
    ["toChainId is another chain", (q) => (q.action.toChainId = 42161)],
    ["fromToken is a different token", (q) => (q.action.fromToken.address = OTHER_TOKEN)],
    ["toToken is a different token", (q) => (q.action.toToken.address = OTHER_TOKEN)],
    ["fromToken and toToken are swapped", (q) => ((q.action.fromToken.address = TOKEN), (q.action.toToken.address = USDG.address))],
    ["fromToken has no address", (q) => (q.action.fromToken = {})],
    ["fromAmount is larger", (q) => (q.action.fromAmount = (AMOUNT_IN + 1n).toString())],
    ["fromAmount is smaller", (q) => (q.action.fromAmount = (AMOUNT_IN - 1n).toString())],
    ["fromAmount is a number, not a string", (q) => (q.action.fromAmount = Number(AMOUNT_IN))],
    ["fromAmount is negative", (q) => (q.action.fromAmount = `-${AMOUNT_IN}`)],
    ["fromAmount is missing", (q) => (q.action.fromAmount = undefined)],
    ['value is "0x1"', (q) => (q.transactionRequest.value = "0x1")],
    ['value is "1"', (q) => (q.transactionRequest.value = "1")],
    ["value is not a number at all", (q) => (q.transactionRequest.value = "lots")],
    ["data is missing", (q) => (q.transactionRequest.data = undefined)],
    ['data is "0x"', (q) => (q.transactionRequest.data = "0x")],
    ["data is not hex", (q) => (q.transactionRequest.data = "0xabcdeg")],
    ["data has no 0x prefix", (q) => (q.transactionRequest.data = "abcdef")],
    ["data has an odd number of hex digits", (q) => (q.transactionRequest.data = "0xabcde")],
    ["toAmountMin is above toAmount", (q) => (q.estimate.toAmountMin = "50000000000000000001")],
    ["toAmount is zero", (q) => (q.estimate.toAmount = "0")],
    ["toAmountMin is zero", (q) => (q.estimate.toAmountMin = "0")],
    ["both output amounts are zero", (q) => ((q.estimate.toAmount = "0"), (q.estimate.toAmountMin = "0"))],
    ["toAmount is missing", (q) => (q.estimate.toAmount = undefined)],
    ["toAmountMin is missing", (q) => (q.estimate.toAmountMin = undefined)],
    ["toAmount is a decimal fraction", (q) => (q.estimate.toAmount = "50.5")],
    ["gasLimit is 0", (q) => (q.transactionRequest.gasLimit = "0")],
    ["gasLimit is missing", (q) => (q.transactionRequest.gasLimit = undefined)],
    ["gasLimit is above 5,000,000", (q) => (q.transactionRequest.gasLimit = "5000001")],
    ["gasLimit is above 5,000,000 in hex", (q) => (q.transactionRequest.gasLimit = "0x4c4b41")],
  ];
  it.each(rejected)("refuses a route when %s", (_name, change) => {
    expect(() => validate(mutated(change))).toThrow(VenueError);
  });

  it("refuses a body with a missing part", () => {
    expect(() => validate({ ...lifiQuote(), transactionRequest: undefined })).toThrow(VenueError);
    expect(() => validate({ ...lifiQuote(), action: undefined })).toThrow(VenueError);
    expect(() => validate({ ...lifiQuote(), estimate: undefined })).toThrow(VenueError);
    expect(() => validate({})).toThrow(VenueError);
  });

  it("refuses a null or non-object body", () => {
    expect(() => validate(null)).toThrow(VenueError);
    expect(() => validate(undefined)).toThrow(VenueError);
    expect(() => validate("no route")).toThrow(VenueError);
    expect(() => validate({ message: "No available quotes for the requested transfer" })).toThrow(VenueError);
  });

  it("refuses a request whose own tokens are not addresses, even when the route echoes them", () => {
    const body = mutated((quote) => (quote.action.toToken.address = "0x1234"));
    expect(() => validate(body, routeRequest({ tokenOut: "0x1234" }))).toThrow(VenueError);
  });

  it("is at the gas limit boundary: 5,000,000 passes", () => {
    expect(validate(mutated((quote) => (quote.transactionRequest.gasLimit = "0x4c4b40"))).gasLimit).toBe(5_000_000n);
  });
});

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

function fakeFetch(respond: () => Response | Promise<Response>): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchRoute", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.LIFI_API_KEY;
    delete process.env.LIFI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.LIFI_API_KEY;
    else process.env.LIFI_API_KEY = savedKey;
  });

  it("asks LI.FI for a same-chain quote to and from the wallet, and returns the validated route", async () => {
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    const before = Date.now();
    const route = await fetchRoute(routeRequest(), impl);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(`${url.origin}${url.pathname}`).toBe("https://li.quest/v1/quote");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fromChain: "4663",
      toChain: "4663",
      fromToken: USDG.address,
      toToken: TOKEN,
      fromAmount: "100000000",
      fromAddress: WALLET,
      toAddress: WALLET,
      slippage: "0.010000",
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json");
    expect(headers).not.toHaveProperty("x-lifi-api-key");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(route.to).toBe(SWAP_ROUTER);
    expect(route.data).toBe("0xabcdef");
    expect(route.amountIn).toBe(AMOUNT_IN);
    expect(route.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(route.fetchedAt).toBeLessThanOrEqual(Date.now());
  });

  it.each([
    [0.5, "0.005000"],
    [2.5, "0.025000"],
    [50, "0.500000"],
  ])("sends a slippage of %s%% as the fraction %s", async (slippagePercent, expected) => {
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    await fetchRoute(routeRequest({ slippagePercent }), impl);
    expect(calls[0]!.url.searchParams.get("slippage")).toBe(expected);
  });

  it("sends the API key header when LIFI_API_KEY is set", async () => {
    process.env.LIFI_API_KEY = "test-lifi-key";
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    await fetchRoute(routeRequest(), impl);
    expect((calls[0]!.init?.headers as Record<string, string>)["x-lifi-api-key"]).toBe("test-lifi-key");
  });

  it("sends no API key header when LIFI_API_KEY is blank", async () => {
    process.env.LIFI_API_KEY = "   ";
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    await fetchRoute(routeRequest(), impl);
    expect(calls[0]!.init?.headers).not.toHaveProperty("x-lifi-api-key");
  });

  it.each([429, 404, 500, 503, 400])("throws a VenueError on HTTP %i", async (status) => {
    const { impl, calls } = fakeFetch(() => json({ message: "nope" }, status));
    await expect(fetchRoute(routeRequest(), impl)).rejects.toBeInstanceOf(VenueError);
    expect(calls).toHaveLength(1);
  });

  it("throws a VenueError even when an error status carries a well-formed route", async () => {
    const { impl } = fakeFetch(() => json(lifiQuote(), 500));
    await expect(fetchRoute(routeRequest(), impl)).rejects.toBeInstanceOf(VenueError);
  });

  it("throws a VenueError when the fetch itself throws", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const failure = fetchRoute(routeRequest(), impl);
    await expect(failure).rejects.toBeInstanceOf(VenueError);
    await expect(failure).rejects.not.toThrow("fetch failed");
  });

  it("throws a VenueError on a body that is not JSON", async () => {
    const { impl } = fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 200 }));
    await expect(fetchRoute(routeRequest(), impl)).rejects.toBeInstanceOf(VenueError);
  });

  it("throws a VenueError on a JSON body that is not a route, or is a route that fails validation", async () => {
    await expect(fetchRoute(routeRequest(), fakeFetch(() => json(null)).impl)).rejects.toBeInstanceOf(VenueError);
    await expect(fetchRoute(routeRequest(), fakeFetch(() => json({})).impl)).rejects.toBeInstanceOf(VenueError);
    const hostile = mutated((quote) => (quote.transactionRequest.to = OTHER_WALLET));
    await expect(fetchRoute(routeRequest(), fakeFetch(() => json(hostile)).impl)).rejects.toBeInstanceOf(VenueError);
  });

  it.each([0, -1, 50.01, 100, Number.NaN, Number.POSITIVE_INFINITY])("refuses a slippage limit of %s before any fetch", async (slippagePercent) => {
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    await expect(fetchRoute(routeRequest({ slippagePercent }), impl)).rejects.toBeInstanceOf(VenueError);
    expect(calls).toHaveLength(0);
  });

  it.each([0n, -1n])("refuses an amount of %s before any fetch", async (amountIn) => {
    const { impl, calls } = fakeFetch(() => json(lifiQuote()));
    await expect(fetchRoute(routeRequest({ amountIn }), impl)).rejects.toBeInstanceOf(VenueError);
    expect(calls).toHaveLength(0);
  });
});

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
type TestLog = Pick<Log, "address" | "topics" | "data">;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function rawLog(address: string, topics: string[], data: string): TestLog {
  return { address: address as Hex, topics: topics as [Hex, ...Hex[]], data: data as Hex };
}
const transfer = (token: string, from: string, to: string, value: bigint) => rawLog(token, [TRANSFER, topic(from), topic(to)], word(value));

describe("transferred", () => {
  it("is zero for no logs", () => {
    expect(transferred([], TOKEN, WALLET, "in")).toBe(0n);
    expect(transferred([], TOKEN, WALLET, "out")).toBe(0n);
  });

  it("sums transfers of the token to the wallet (in) and from the wallet (out) separately", () => {
    const logs = [transfer(TOKEN, SWAP_ROUTER, WALLET, 3n), transfer(TOKEN, OTHER_WALLET, WALLET, 4n), transfer(TOKEN, WALLET, SWAP_ROUTER, 10n)];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(7n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(10n);
  });

  it("handles amounts beyond the safe integer range exactly", () => {
    const big = 123_456_789_012_345_678_901_234_567_890n;
    expect(transferred([transfer(TOKEN, SWAP_ROUTER, WALLET, big), transfer(TOKEN, SWAP_ROUTER, WALLET, 1n)], TOKEN, WALLET, "in")).toBe(big + 1n);
  });

  it("ignores other tokens", () => {
    const logs = [transfer(OTHER_TOKEN, SWAP_ROUTER, WALLET, 5n), transfer(USDG.address, WALLET, SWAP_ROUTER, 6n), transfer(TOKEN, SWAP_ROUTER, WALLET, 1n)];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(1n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(0n);
  });

  it("ignores other event topics", () => {
    const logs = [rawLog(TOKEN, [APPROVAL, topic(SWAP_ROUTER), topic(WALLET)], word(5n)), rawLog(TOKEN, [APPROVAL, topic(WALLET), topic(SWAP_ROUTER)], word(5n))];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(0n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(0n);
  });

  it("ignores transfers between other wallets, and the wrong direction", () => {
    const logs = [transfer(TOKEN, SWAP_ROUTER, OTHER_WALLET, 5n), transfer(TOKEN, WALLET, OTHER_WALLET, 2n)];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(0n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(2n);
    expect(transferred(logs, TOKEN, OTHER_WALLET, "in")).toBe(7n);
  });

  it("ignores logs with malformed data or too few topics", () => {
    const logs = [
      rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], "0x"),
      rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], "0xzz"),
      rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], "12"),
      rawLog(TOKEN, [TRANSFER, topic(WALLET)], word(9n)),
      rawLog(TOKEN, [TRANSFER], word(9n)),
      rawLog(TOKEN, [], word(9n)),
    ];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(0n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(0n);
  });

  it("compares addresses without regard to case", () => {
    const upper = (address: string) => `0x${address.slice(2).toUpperCase()}`;
    const logs = [
      rawLog(upper(TOKEN), [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], word(3n)),
      rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), `0x${topic(WALLET).slice(2).toUpperCase()}`], word(4n)),
    ];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(7n);
    expect(transferred(logs, upper(TOKEN), WALLET_MIXED, "in")).toBe(7n);
    expect(transferred(logs, TOKEN, upper(WALLET), "in")).toBe(7n);
  });

  it("counts a transfer from the wallet to itself in both directions", () => {
    const logs = [transfer(TOKEN, WALLET, WALLET, 5n)];
    expect(transferred(logs, TOKEN, WALLET, "in")).toBe(5n);
    expect(transferred(logs, TOKEN, WALLET, "out")).toBe(5n);
  });

  // A standard Transfer carries exactly one 32-byte amount. A log with more or less data is not a transfer
  // this code understands, so it is not counted rather than read as one enormous number.
  it("ignores Transfer logs whose data is not exactly one word", () => {
    const twoWords = `${word(1n)}${word(2n).slice(2)}`;
    const good = rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], word(5n));
    for (const data of [twoWords, "0x05", "0x", `${word(1n)}00`]) {
      expect(transferred([rawLog(TOKEN, [TRANSFER, topic(SWAP_ROUTER), topic(WALLET)], data), good], TOKEN, WALLET, "in"), data).toBe(5n);
    }
  });
});

const E18 = 10n ** 18n;

/** Only `priceUsd` matters to a live quote. Asserted, not annotated, so the helper survives fields being added to the snapshot. */
function market(priceUsd: number): MarketSnapshot {
  return {
    network: "robinhood",
    address: TOKEN,
    symbol: "TKN",
    name: "Token",
    priceUsd,
    liquidityUsd: 1_000_000,
    marketCapUsd: null,
    volumeH1: null,
    volumeH6: null,
    volumeH24: null,
    priceChangeM5: null,
    priceChangeH1: null,
    priceChangeH6: null,
    priceChangeH24: null,
    buysH1: null,
    sellsH1: null,
    pairAddress: OTHER_TOKEN,
    pairCreatedAt: null,
    dex: "sushiswap",
    quoteSymbol: "USDG",
    fetchedAt: NOW,
    source: "dexscreener",
  } as MarketSnapshot;
}

function quoteRequest(over: Partial<QuoteRequest> = {}): QuoteRequest {
  return { side: "buy", wallet: WALLET, token: TOKEN, amountInRaw: AMOUNT_IN, slippagePercent: 1, market: market(2), now: NOW, ...over };
}

function swapRoute(over: Partial<SwapRoute> = {}): SwapRoute {
  return {
    tool: "sushiswap",
    tokenIn: USDG.address,
    tokenOut: TOKEN as Hex,
    amountIn: AMOUNT_IN,
    to: SWAP_ROUTER,
    data: "0xabcdef",
    gasLimit: 959_465n,
    toAmount: 50n * E18,
    toAmountMin: (485n * E18) / 10n,
    fetchedAt: NOW,
    ...over,
  };
}

/** A buy of $100 at a $2 market price that simulates to 49 tokens, with a 48.5-token minimum. */
function buyQuote(over: Partial<Parameters<typeof buildLiveQuote>[0]> = {}) {
  return buildLiveQuote({ request: quoteRequest(), tokenDecimals: 18, route: swapRoute(), simulatedOutRaw: 49n * E18, simulationError: null, networkFeeUsd: 0.02, ...over });
}

/** A sell of 10 tokens (8 decimals) at a $2 market price that simulates to $19.50, with a $19.30 minimum. */
function sellQuote(over: Partial<Parameters<typeof buildLiveQuote>[0]> = {}) {
  return buildLiveQuote({
    request: quoteRequest({ side: "sell", amountInRaw: 1_000_000_000n }),
    tokenDecimals: 8,
    route: swapRoute({ tokenIn: TOKEN as Hex, tokenOut: USDG.address, amountIn: 1_000_000_000n, toAmount: 19_800_000n, toAmountMin: 19_300_000n }),
    simulatedOutRaw: 19_500_000n,
    simulationError: null,
    networkFeeUsd: 0.02,
    ...over,
  });
}

describe("buildLiveQuote", () => {
  it("prices a buy from what the simulation delivered", () => {
    const quote = buyQuote({ request: quoteRequest({ token: `0x${"1E".repeat(20)}`, slippagePercent: 1.5 }) });
    expect(quote.kind).toBe("live");
    expect(quote.side).toBe("buy");
    expect(quote.tool).toBe("sushiswap");
    expect(quote.token).toBe(TOKEN);
    expect(quote.tokenDecimals).toBe(18);
    expect(quote.midPriceUsd).toBe(2);
    expect(quote.priceUsd).toBeCloseTo(100 / 49, 12);
    expect(quote.quantity).toBe(49);
    expect(quote.notionalUsd).toBe(100);
    expect(quote.priceImpactPercent).toBeCloseTo((100 / 49 / 2 - 1) * 100, 9);
    expect(quote.slippagePercent).toBeCloseTo((1 - 48.5 / 49) * 100, 9);
    expect(quote.swapFeeUsd).toBe(0);
    expect(quote.networkFeeUsd).toBe(0.02);
    expect(quote.quotedAt).toBe(NOW);
    expect(quote.amountInRaw).toBe("100000000");
    expect(quote.expectedOutRaw).toBe((50n * E18).toString());
    expect(quote.minOutRaw).toBe(((485n * E18) / 10n).toString());
    expect(quote.simulatedOutRaw).toBe((49n * E18).toString());
    expect(quote.slippageLimitPercent).toBe(1.5);
    expect(quote.route).toEqual(swapRoute());
    expect(quote.simulation.ok).toBe(true);
    expect(quote.simulation.detail).toContain("sushiswap");
  });

  it("prices a sell from the dollars the simulation delivered", () => {
    const quote = sellQuote();
    expect(quote.side).toBe("sell");
    expect(quote.priceUsd).toBeCloseTo(1.95, 12);
    expect(quote.quantity).toBe(10);
    expect(quote.notionalUsd).toBe(19.5);
    expect(quote.priceImpactPercent).toBeCloseTo(2.5, 9);
    expect(quote.slippagePercent).toBeCloseTo((1 - 19.3 / 19.5) * 100, 9);
    expect(quote.amountInRaw).toBe("1000000000");
    expect(quote.expectedOutRaw).toBe("19800000");
    expect(quote.minOutRaw).toBe("19300000");
    expect(quote.simulatedOutRaw).toBe("19500000");
    expect(quote.simulation.ok).toBe(true);
  });

  it("uses the token's own decimals on a buy", () => {
    const quote = buyQuote({ tokenDecimals: 6, route: swapRoute({ toAmount: 50_000_000n, toAmountMin: 48_500_000n }), simulatedOutRaw: 49_000_000n });
    expect(quote.quantity).toBe(49);
    expect(quote.priceUsd).toBeCloseTo(100 / 49, 12);
    expect(quote.simulation.ok).toBe(true);
  });

  it("never reports a negative price impact when the fill beats the market price", () => {
    const buy = buyQuote({ simulatedOutRaw: 51n * E18 });
    expect(buy.priceUsd).toBeLessThan(2);
    expect(buy.priceImpactPercent).toBe(0);
    expect(buy.simulation.ok).toBe(true);
    const sell = sellQuote({ simulatedOutRaw: 21_000_000n });
    expect(sell.priceUsd).toBeGreaterThan(2);
    expect(sell.priceImpactPercent).toBe(0);
    expect(sell.simulation.ok).toBe(true);
  });

  it("reports zero impact and zero slippage for a fill exactly at the market price and the minimum", () => {
    const quote = buyQuote({ route: swapRoute({ toAmountMin: 50n * E18 }), simulatedOutRaw: 50n * E18 });
    expect(quote.priceUsd).toBe(2);
    expect(quote.priceImpactPercent).toBe(0);
    expect(quote.slippagePercent).toBe(0);
    expect(quote.simulation.ok).toBe(true);
  });

  it("measures slippage against the simulated output, not the route's quoted output", () => {
    // Quoted 50, minimum 40, simulated 49: the fill may still fall 9 of 49 below the simulation.
    const quote = buyQuote({ route: swapRoute({ toAmountMin: 40n * E18 }) });
    expect(quote.slippagePercent).toBeCloseTo((1 - 40 / 49) * 100, 9);
  });

  it("fails the simulation when there is no route", () => {
    const quote = buyQuote({ route: null });
    expect(quote.simulation.ok).toBe(false);
    expect(quote.tool).toBe("");
    expect(quote.expectedOutRaw).toBe("0");
    expect(quote.minOutRaw).toBe("0");
    expect(quote.slippagePercent).toBeNaN();
    expect(quote.route).toBeNull();
  });

  it("fails the simulation when nothing was simulated", () => {
    const quote = buyQuote({ simulatedOutRaw: null });
    expect(quote.simulation.ok).toBe(false);
    expect(quote.simulatedOutRaw).toBeNull();
    expect(quote.priceUsd).toBeNaN();
    expect(quote.quantity).toBeNaN();
    expect(quote.priceImpactPercent).toBeNaN();
    expect(quote.slippagePercent).toBeNaN();
    expect(quote.notionalUsd).toBe(100);
    const sell = sellQuote({ simulatedOutRaw: null });
    expect(sell.simulation.ok).toBe(false);
    expect(sell.notionalUsd).toBeNaN();
    expect(sell.quantity).toBe(10);
  });

  it("fails the simulation when it delivered less than the route's minimum", () => {
    const oneShort = buyQuote({ simulatedOutRaw: (485n * E18) / 10n - 1n });
    expect(oneShort.simulation.ok).toBe(false);
    expect(oneShort.slippagePercent).toBe(0);
    expect(buyQuote({ simulatedOutRaw: (485n * E18) / 10n }).simulation.ok).toBe(true);
    expect(sellQuote({ simulatedOutRaw: 19_299_999n }).simulation.ok).toBe(false);
  });

  it("fails the simulation when it delivered nothing", () => {
    const quote = buyQuote({ simulatedOutRaw: 0n });
    expect(quote.simulation.ok).toBe(false);
    expect(quote.priceUsd).toBeNaN();
    expect(quote.simulatedOutRaw).toBe("0");
  });

  it("fails the simulation with the given error, whatever else is true", () => {
    const quote = buyQuote({ simulationError: "The swap reverted in simulation: TRANSFER_FAILED" });
    expect(quote.simulation).toEqual({ ok: false, detail: "The swap reverted in simulation: TRANSFER_FAILED" });
    const empty = buyQuote({ route: null, simulatedOutRaw: null, simulationError: "No swap route is available for this trade.", networkFeeUsd: null });
    expect(empty.simulation).toEqual({ ok: false, detail: "No swap route is available for this trade." });
  });

  it("fails the simulation when there is no market price to compare against", () => {
    const quote = buyQuote({ request: quoteRequest({ market: null }) });
    expect(quote.midPriceUsd).toBeNaN();
    expect(quote.priceImpactPercent).toBeNaN();
    expect(quote.priceUsd).toBeCloseTo(100 / 49, 12);
    expect(quote.simulation.ok).toBe(false);
    expect(sellQuote({ request: quoteRequest({ side: "sell", amountInRaw: 1_000_000_000n, market: null }) }).simulation.ok).toBe(false);
  });

  it.each([0, Number.NaN])("fails the simulation when the market price is %s", (priceUsd) => {
    expect(buyQuote({ request: quoteRequest({ market: market(priceUsd) }) }).simulation.ok).toBe(false);
    expect(sellQuote({ request: quoteRequest({ side: "sell", amountInRaw: 1_000_000_000n, market: market(priceUsd) }) }).simulation.ok).toBe(false);
  });

  // Without a positive, finite market price there is nothing to measure the fill against, so the quote does not pass,
  // whatever the simulation delivered.
  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2])("fails the simulation when the market price is %s", (priceUsd) => {
    expect(buyQuote({ request: quoteRequest({ market: market(priceUsd) }) }).simulation.ok).toBe(false);
    expect(sellQuote({ request: quoteRequest({ side: "sell", amountInRaw: 1_000_000_000n, market: market(priceUsd) }) }).simulation.ok).toBe(false);
  });

  it("reports an unknown network fee as NaN", () => {
    expect(buyQuote({ networkFeeUsd: null }).networkFeeUsd).toBeNaN();
    expect(buyQuote({ networkFeeUsd: 0 }).networkFeeUsd).toBe(0);
  });
});

describe("quoteRecord", () => {
  it("drops the route's calldata but keeps its tool, target and gas limit", () => {
    const record = quoteRecord(buyQuote());
    expect(record.route).toEqual({ tool: "sushiswap", to: SWAP_ROUTER, gasLimit: "959465", fetchedAt: NOW });
    expect(record.route).not.toHaveProperty("data");
    expect(record.kind).toBe("live");
    expect(record.priceUsd).toBeCloseTo(100 / 49, 12);
    expect(record.amountInRaw).toBe("100000000");
    expect(record.simulation).toEqual(buyQuote().simulation);
  });

  it("is plain JSON with no calldata anywhere in it", () => {
    const stored = JSON.stringify(quoteRecord(buyQuote()));
    expect(stored).not.toContain("abcdef");
    expect(JSON.parse(stored).route.gasLimit).toBe("959465");
  });

  it("records a quote without a route as route null", () => {
    expect(quoteRecord(buyQuote({ route: null })).route).toBeNull();
  });

  it("does not change the quote it was given", () => {
    const quote = buyQuote();
    quoteRecord(quote);
    expect(quote.route?.data).toBe("0xabcdef");
  });
});

describe("riskWallet", () => {
  const MIN_GAS_WEI = 10n ** 14n;
  let riskWallet: typeof import("./engine").riskWallet;
  beforeAll(async () => {
    // Importing the engine loads the database module, which only connects on first use. Nothing here uses it.
    ({ riskWallet } = await import("./engine"));
  });

  it("is null when the wallet could not be read", () => {
    expect(riskWallet(null)).toBeNull();
  });

  it("has gas at exactly the minimum, and above it", () => {
    expect(riskWallet({ usdg: 250.5, usdgRaw: 250_500_000n, ethWei: MIN_GAS_WEI })).toEqual({ usdg: 250.5, hasGas: true });
    expect(riskWallet({ usdg: 0, usdgRaw: 0n, ethWei: E18 })).toEqual({ usdg: 0, hasGas: true });
  });

  it("has no gas one wei below the minimum, or with none at all", () => {
    expect(riskWallet({ usdg: 250.5, usdgRaw: 250_500_000n, ethWei: MIN_GAS_WEI - 1n })).toEqual({ usdg: 250.5, hasGas: false });
    expect(riskWallet({ usdg: 250.5, usdgRaw: 250_500_000n, ethWei: 0n })).toEqual({ usdg: 250.5, hasGas: false });
  });
});
