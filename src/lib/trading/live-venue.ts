import { erc20Abi, formatUnits, type Hex, type Log, type PublicClient, type TransactionReceipt } from "viem";
import { SWAP_ROUTER, USDG, ethPriceUsd, publicClient } from "./chain";
import { VenueError, fetchRoute, type RouteRequest, type SwapRoute } from "./lifi";
import type { MarketSnapshot } from "./market-data";
import type { RiskQuote } from "./risk-engine";
import { tradeSigner, type TradeSigner } from "./wallets";

/**
 * Live Mode's execution venue: real swaps on Robinhood Chain.
 *
 * A trade is quoted, validated, and simulated on the chain from the real wallet
 * (approve, then swap) before anything is signed. After it lands, the amounts
 * come from the transaction's own logs, so the books record what actually
 * moved, not what a quote promised.
 */

export interface LiveQuote extends RiskQuote {
  kind: "live";
  side: "buy" | "sell";
  tool: string;
  token: string;
  tokenDecimals: number;
  midPriceUsd: number;
  /** Token quantity the simulation delivered (buys) or the quantity being sold (sells). */
  quantity: number;
  /** Dollars spent (buys) or received in the simulation (sells). */
  notionalUsd: number;
  /** Pool and router fees are inside the price a live swap pays, so there is no separate swap fee. */
  swapFeeUsd: 0;
  amountInRaw: string;
  expectedOutRaw: string;
  minOutRaw: string;
  simulatedOutRaw: string | null;
  slippageLimitPercent: number;
  /** The validated route, kept in memory for execution. Its calldata is never stored. */
  route: SwapRoute | null;
}

export type Fill =
  | { ok: true; txHash: Hex; approveTxHash?: Hex; inRaw: bigint; outRaw: bigint; gasUsd: number }
  | {
      ok: false;
      stage: "quote" | "approve" | "simulate" | "sign" | "send" | "confirm" | "revert";
      reason: string;
      txHash?: Hex;
      approveTxHash?: Hex;
      gasUsd: number;
      /** True when the swap may have been broadcast and its fate is not known yet. */
      uncertain: boolean;
    };

export interface WalletFunds {
  usdg: number;
  usdgRaw: bigint;
  ethWei: bigint;
}

export interface QuoteRequest {
  side: "buy" | "sell";
  wallet: string;
  token: string;
  /** USDG units for a buy, token units for a sell. */
  amountInRaw: bigint;
  slippagePercent: number;
  market: MarketSnapshot | null;
  now: number;
}

export interface LiveVenue {
  /** The wallet's USDG and ETH, or null when the chain cannot be read. */
  funds(wallet: string): Promise<WalletFunds | null>;
  tokenBalance(wallet: string, token: string): Promise<bigint | null>;
  /** A simulated quote. Never throws: a failure comes back as a quote whose simulation did not pass. */
  quote(request: QuoteRequest): Promise<LiveQuote>;
  /** Approves, re-simulates, signs, records the hash and nonce through `onSigned`, broadcasts and waits. Never throws. */
  execute(input: { walletId: string; quote: LiveQuote; onSigned(hash: Hex, nonce: number): Promise<void> }): Promise<Fill>;
  /**
   * Whether the wallet has already confirmed a transaction with this nonce or a
   * later one. If it has, and a swap signed with that nonce has no receipt, that
   * swap can never land. Null when the chain cannot be read.
   */
  nonceUsed(wallet: string, nonce: number): Promise<boolean | null>;
  /** Looks a broadcast swap up again after a crash or a timeout. Null means the chain has not seen it. */
  inspect(input: { txHash: Hex; wallet: string; tokenIn: string; tokenOut: string }): Promise<Fill | null>;
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

/** Total of a token's Transfer events to or from a wallet in a set of logs. */
export function transferred(logs: ReadonlyArray<Pick<Log, "address" | "topics" | "data">>, token: string, wallet: string, direction: "in" | "out"): bigint {
  let total = 0n;
  for (const log of logs) {
    const topics = log.topics as readonly string[];
    if (log.address.toLowerCase() !== token.toLowerCase() || topics[0] !== TRANSFER || topics.length < 3) continue;
    if (topics[direction === "in" ? 2 : 1]?.toLowerCase() !== topicOf(wallet)) continue;
    // A standard Transfer carries exactly one 32-byte amount. Anything else is not counted.
    if (!/^0x[0-9a-fA-F]{64}$/.test(log.data)) continue;
    total += BigInt(log.data);
  }
  return total;
}

const toNumber = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));

/** Turns a route and its simulation into the numbers the risk engine checks. Pure, so it can be tested without a chain. */
export function buildLiveQuote(input: {
  request: QuoteRequest;
  tokenDecimals: number;
  route: SwapRoute | null;
  /** What the simulation delivered, or null when it did not run or did not pass. */
  simulatedOutRaw: bigint | null;
  simulationError: string | null;
  networkFeeUsd: number | null;
}): LiveQuote {
  const { request, tokenDecimals, route, simulatedOutRaw } = input;
  const mid = request.market?.priceUsd ?? NaN;
  const buy = request.side === "buy";
  const inDecimals = buy ? USDG.decimals : tokenDecimals;
  const outDecimals = buy ? tokenDecimals : USDG.decimals;
  const amountIn = toNumber(request.amountInRaw, inDecimals);
  const out = simulatedOutRaw !== null && simulatedOutRaw > 0n ? toNumber(simulatedOutRaw, outDecimals) : NaN;
  // The price a buy pays is dollars per token received; the price a sell gets is dollars received per token.
  const priceUsd = buy ? amountIn / out : out / amountIn;
  const impact = buy ? (priceUsd / mid - 1) * 100 : (1 - priceUsd / mid) * 100;
  // How far below the simulated output the route is still allowed to fill.
  const slippage = route && simulatedOutRaw !== null && simulatedOutRaw > 0n ? Math.max(0, (1 - Number(route.toAmountMin) / Number(simulatedOutRaw)) * 100) : NaN;

  let simulation: { ok: boolean; detail: string };
  if (input.simulationError) simulation = { ok: false, detail: input.simulationError };
  else if (!Number.isFinite(mid) || mid <= 0) simulation = { ok: false, detail: "There is no usable market price to check the fill against" };
  else if (!route || simulatedOutRaw === null) simulation = { ok: false, detail: "The swap could not be simulated on the chain" };
  else if (simulatedOutRaw < route.toAmountMin) simulation = { ok: false, detail: "The simulated swap delivered less than the route's own minimum" };
  else if (![priceUsd, impact, slippage].every(Number.isFinite) || priceUsd <= 0) simulation = { ok: false, detail: "The simulated fill could not be priced" };
  else simulation = { ok: true, detail: `Simulated on Robinhood Chain from the wallet through ${route.tool}: approve, then swap` };

  return {
    kind: "live",
    side: request.side,
    tool: route?.tool ?? "",
    token: request.token.toLowerCase(),
    tokenDecimals,
    midPriceUsd: mid,
    priceUsd,
    quantity: buy ? out : amountIn,
    notionalUsd: buy ? amountIn : out,
    // A fill better than the market price is not negative impact for the limit's purposes.
    priceImpactPercent: Number.isFinite(impact) ? Math.max(0, impact) : NaN,
    slippagePercent: slippage,
    swapFeeUsd: 0,
    networkFeeUsd: input.networkFeeUsd ?? NaN,
    quotedAt: request.now,
    simulation,
    amountInRaw: request.amountInRaw.toString(),
    expectedOutRaw: route?.toAmount.toString() ?? "0",
    minOutRaw: route?.toAmountMin.toString() ?? "0",
    simulatedOutRaw: simulatedOutRaw?.toString() ?? null,
    slippageLimitPercent: request.slippagePercent,
    route,
  };
}

/** What is safe to store of a quote: everything except the route's calldata. */
export function quoteRecord(quote: LiveQuote): Record<string, unknown> {
  const { route, ...rest } = quote;
  return { ...rest, route: route ? { tool: route.tool, to: route.to, gasLimit: route.gasLimit.toString(), fetchedAt: route.fetchedAt } : null };
}

// One trade at a time per wallet, so two fills never race for the same nonce or allowance.
const queues = new Map<string, Promise<unknown>>();
function serialised<T>(wallet: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(wallet) ?? Promise.resolve()).then(work, work);
  queues.set(
    wallet,
    next.catch(() => {}),
  );
  return next;
}

const short = (error: unknown) => ((error as { shortMessage?: string }).shortMessage ?? (error instanceof Error ? error.message : "unknown error")).split("\n")[0]!.slice(0, 200);

export interface VenueDeps {
  client: PublicClient;
  route(request: RouteRequest): Promise<SwapRoute>;
  signer(walletId: string): Promise<TradeSigner>;
  ethUsd(): Promise<number>;
}

export function createLiveVenue(deps: VenueDeps = { client: publicClient(), route: fetchRoute, signer: tradeSigner, ethUsd: ethPriceUsd }): LiveVenue {
  const { client } = deps;
  const decimalsCache = new Map<string, number>();

  async function decimalsOf(token: string): Promise<number> {
    if (token.toLowerCase() === USDG.address) return USDG.decimals;
    const cached = decimalsCache.get(token.toLowerCase());
    if (cached !== undefined) return cached;
    const value = Number(await client.readContract({ address: token as Hex, abi: erc20Abi, functionName: "decimals" }));
    if (!Number.isInteger(value) || value < 0 || value > 36) throw new VenueError("The token reports an unusable number of decimals.");
    decimalsCache.set(token.toLowerCase(), value);
    return value;
  }

  async function gasUsd(receipts: TransactionReceipt[]): Promise<number> {
    const wei = receipts.reduce((total, receipt) => total + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
    if (wei === 0n) return 0;
    try {
      return (Number(wei) / 1e18) * (await deps.ethUsd());
    } catch {
      // The fee was paid whether or not ETH can be priced right now; record it as unknown-but-nonzero is not possible, so use zero and say so in the logs.
      console.error("[trading] network fee could not be priced in dollars");
      return 0;
    }
  }

  async function fromReceipt(receipt: TransactionReceipt, wallet: string, tokenIn: string, tokenOut: string, earlier: TransactionReceipt[], approveTxHash?: Hex): Promise<Fill> {
    const fee = await gasUsd([...earlier, receipt]);
    if (receipt.status !== "success") {
      return { ok: false, stage: "revert", reason: "The swap transaction reverted on the chain. No tokens moved.", txHash: receipt.transactionHash, approveTxHash, gasUsd: fee, uncertain: false };
    }
    const inRaw = transferred(receipt.logs, tokenIn, wallet, "out");
    const outRaw = transferred(receipt.logs, tokenOut, wallet, "in");
    if (inRaw <= 0n || outRaw <= 0n) {
      return { ok: false, stage: "confirm", reason: "The swap confirmed but its token movements could not be read from the receipt.", txHash: receipt.transactionHash, approveTxHash, gasUsd: fee, uncertain: true };
    }
    return { ok: true, txHash: receipt.transactionHash, approveTxHash, inRaw, outRaw, gasUsd: fee };
  }

  return {
    async funds(wallet) {
      try {
        const [usdgRaw, ethWei] = await Promise.all([
          client.readContract({ address: USDG.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Hex] }),
          client.getBalance({ address: wallet as Hex }),
        ]);
        return { usdgRaw, usdg: toNumber(usdgRaw, USDG.decimals), ethWei };
      } catch {
        return null;
      }
    },

    async tokenBalance(wallet, token) {
      try {
        return await client.readContract({ address: token as Hex, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Hex] });
      } catch {
        return null;
      }
    },

    async quote(request) {
      const tokenIn = request.side === "buy" ? USDG.address : request.token;
      const tokenOut = request.side === "buy" ? request.token : USDG.address;
      let tokenDecimals = 18;
      let route: SwapRoute | null = null;
      try {
        tokenDecimals = await decimalsOf(request.token);
        route = await deps.route({ wallet: request.wallet, tokenIn, tokenOut, amountIn: request.amountInRaw, slippagePercent: request.slippagePercent });
      } catch (error) {
        const reason = error instanceof VenueError ? error.message : `The swap could not be quoted: ${short(error)}`;
        return buildLiveQuote({ request, tokenDecimals, route: null, simulatedOutRaw: null, simulationError: reason, networkFeeUsd: null });
      }

      // The whole trade, run against current chain state from the real wallet: approve the exact amount, then swap.
      let simulatedOutRaw: bigint | null = null;
      let simulationError: string | null = null;
      let networkFeeUsd: number | null = null;
      try {
        const [block] = await client.simulateBlocks({
          blocks: [
            {
              calls: [
                { account: request.wallet as Hex, to: tokenIn as Hex, abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, request.amountInRaw] },
                { account: request.wallet as Hex, to: SWAP_ROUTER, data: route.data, value: 0n },
              ],
            },
          ],
        });
        const [approve, swap] = block!.calls;
        if (approve!.status !== "success") simulationError = "The token refused the approval in simulation";
        else if (swap!.status !== "success") simulationError = "The swap reverted when simulated on the chain from this wallet. The wallet may not hold enough of the token being spent, or the market moved past the slippage limit";
        else {
          simulatedOutRaw = transferred(swap!.logs ?? [], tokenOut, request.wallet, "in");
          if (simulatedOutRaw <= 0n) simulationError = "The simulated swap delivered nothing to the wallet";
          const gas = approve!.gasUsed + swap!.gasUsed;
          networkFeeUsd = (Number(gas * (await client.getGasPrice())) / 1e18) * (await deps.ethUsd()) * 1.2;
        }
      } catch (error) {
        simulationError = `The swap could not be simulated on the chain: ${short(error)}`;
      }
      return buildLiveQuote({ request, tokenDecimals, route, simulatedOutRaw: simulationError ? null : simulatedOutRaw, simulationError, networkFeeUsd });
    },

    execute({ walletId, quote, onSigned }) {
      const route = quote.route;
      if (!route || !quote.simulation.ok) {
        return Promise.resolve({ ok: false, stage: "quote", reason: quote.simulation.detail || "There is no simulated route to execute.", gasUsd: 0, uncertain: false });
      }
      return serialised(walletId, async (): Promise<Fill> => {
        const receipts: TransactionReceipt[] = [];
        let approveTxHash: Hex | undefined;
        let signer: TradeSigner;
        try {
          signer = await deps.signer(walletId);
        } catch (error) {
          return { ok: false, stage: "sign", reason: short(error), gasUsd: 0, uncertain: false };
        }
        const wallet = signer.address;

        try {
          const allowance = await client.readContract({ address: route.tokenIn, abi: erc20Abi, functionName: "allowance", args: [wallet, SWAP_ROUTER] });
          if (allowance < route.amountIn) {
            approveTxHash = await signer.approveExact(route.tokenIn, route.amountIn);
            const receipt = await client.waitForTransactionReceipt({ hash: approveTxHash, timeout: 60_000 });
            receipts.push(receipt);
            if (receipt.status !== "success") {
              return { ok: false, stage: "approve", reason: "The approval transaction reverted.", approveTxHash, gasUsd: await gasUsd(receipts), uncertain: false };
            }
          }
        } catch (error) {
          return { ok: false, stage: "approve", reason: `The approval could not be completed: ${short(error)}`, approveTxHash, gasUsd: await gasUsd(receipts), uncertain: false };
        }

        // Last simulation, on the real allowance, immediately before the signature.
        let gas: bigint;
        try {
          await client.call({ account: wallet, to: SWAP_ROUTER, data: route.data, value: 0n });
          const estimate = await client.estimateGas({ account: wallet, to: SWAP_ROUTER, data: route.data, value: 0n });
          gas = estimate * 13n > route.gasLimit * 10n ? (estimate * 13n) / 10n : route.gasLimit;
        } catch (error) {
          return { ok: false, stage: "simulate", reason: `The swap failed its final simulation and was not signed: ${short(error)}`, approveTxHash, gasUsd: await gasUsd(receipts), uncertain: false };
        }

        let signed: { raw: Hex; hash: Hex; nonce: number };
        try {
          signed = await signer.signRouterCall({ data: route.data, gas });
          // The hash is on record before the transaction can exist on the chain, so a crash from here on is recoverable.
          await onSigned(signed.hash, signed.nonce);
        } catch (error) {
          return { ok: false, stage: "sign", reason: `The swap was not sent: ${short(error)}`, approveTxHash, gasUsd: await gasUsd(receipts), uncertain: false };
        }

        try {
          await client.sendRawTransaction({ serializedTransaction: signed.raw });
        } catch (error) {
          // A refused broadcast usually means nothing was sent, but it cannot be told apart from a lost reply. Recovery decides.
          return { ok: false, stage: "send", reason: `The swap could not be broadcast: ${short(error)}`, txHash: signed.hash, approveTxHash, gasUsd: await gasUsd(receipts), uncertain: true };
        }
        try {
          const receipt = await client.waitForTransactionReceipt({ hash: signed.hash, timeout: 90_000 });
          return await fromReceipt(receipt, wallet, route.tokenIn, route.tokenOut, receipts, approveTxHash);
        } catch (error) {
          return { ok: false, stage: "confirm", reason: `The swap was sent but not confirmed in time: ${short(error)}`, txHash: signed.hash, approveTxHash, gasUsd: await gasUsd(receipts), uncertain: true };
        }
      });
    },

    async nonceUsed(wallet, nonce) {
      try {
        return (await client.getTransactionCount({ address: wallet as Hex, blockTag: "latest" })) > nonce;
      } catch {
        return null;
      }
    },

    async inspect({ txHash, wallet, tokenIn, tokenOut }) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        return await fromReceipt(receipt, wallet, tokenIn, tokenOut, []);
      } catch {
        return null;
      }
    },
  };
}
