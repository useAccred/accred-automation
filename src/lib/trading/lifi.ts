import { env } from "../env";
import { CHAIN_ID, SWAP_ROUTER } from "./chain";

/**
 * Swap routes from LI.FI, the aggregator that routes across the pools on
 * Robinhood Chain. A route is someone else's calldata, so nothing in it is
 * trusted: `validateRoute` refuses any route that does not call the pinned
 * router, from the expected wallet, for exactly the expected tokens and amount,
 * with no ETH attached. The route is then simulated on the chain before it is
 * ever signed (live-venue.ts).
 */

export class VenueError extends Error {}

export interface RouteRequest {
  wallet: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** Worst acceptable shortfall against the quoted output, as a percentage. */
  slippagePercent: number;
}

export interface SwapRoute {
  tool: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  to: `0x${string}`;
  data: `0x${string}`;
  gasLimit: bigint;
  /** What the route expects to deliver, and the least it may deliver before it reverts. */
  toAmount: bigint;
  toAmountMin: bigint;
  fetchedAt: number;
}

const API = "https://li.quest/v1";
const MAX_GAS = 5_000_000n;
const HEX = /^0x([0-9a-fA-F]{2})+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function amount(value: unknown, name: string): bigint {
  try {
    if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) return BigInt(value);
  } catch {
    // Reported below.
  }
  throw new VenueError(`The swap route has no usable ${name}.`);
}

/** Checks a LI.FI quote against what was asked for. Throws VenueError on any mismatch. */
export function validateRoute(body: unknown, request: RouteRequest, fetchedAt: number): SwapRoute {
  const quote = body as {
    tool?: unknown;
    action?: { fromChainId?: unknown; toChainId?: unknown; fromAmount?: unknown; fromToken?: { address?: unknown }; toToken?: { address?: unknown } };
    estimate?: { approvalAddress?: unknown; toAmount?: unknown; toAmountMin?: unknown };
    transactionRequest?: { to?: unknown; from?: unknown; data?: unknown; value?: unknown; chainId?: unknown; gasLimit?: unknown };
  } | null;
  const tx = quote?.transactionRequest;
  if (!quote || !tx || !quote.action || !quote.estimate) throw new VenueError("No swap route is available for this trade.");

  if (Number(tx.chainId) !== CHAIN_ID || Number(quote.action.fromChainId) !== CHAIN_ID || Number(quote.action.toChainId) !== CHAIN_ID) {
    throw new VenueError("The swap route is not on Robinhood Chain.");
  }
  if (!same(tx.to, SWAP_ROUTER)) throw new VenueError("The swap route calls a contract other than the approved router.");
  if (!same(quote.estimate.approvalAddress, SWAP_ROUTER)) throw new VenueError("The swap route asks for approval to a contract other than the approved router.");
  if (!same(tx.from, request.wallet)) throw new VenueError("The swap route was built for a different wallet.");
  if (!same(quote.action.fromToken?.address, request.tokenIn) || !same(quote.action.toToken?.address, request.tokenOut)) {
    throw new VenueError("The swap route trades different tokens from the ones requested.");
  }
  if (amount(quote.action.fromAmount, "input amount") !== request.amountIn) throw new VenueError("The swap route spends a different amount from the one requested.");
  if (amount(tx.value ?? "0", "value") !== 0n) throw new VenueError("The swap route attaches ETH, which a token swap must not.");
  if (typeof tx.data !== "string" || !HEX.test(tx.data)) throw new VenueError("The swap route has no transaction data.");
  if (!ADDRESS.test(request.tokenIn) || !ADDRESS.test(request.tokenOut)) throw new VenueError("The tokens are not valid addresses.");

  const toAmount = amount(quote.estimate.toAmount, "output amount");
  const toAmountMin = amount(quote.estimate.toAmountMin, "minimum output");
  if (toAmount <= 0n || toAmountMin <= 0n || toAmountMin > toAmount) throw new VenueError("The swap route's output amounts do not make sense.");
  const gasLimit = amount(tx.gasLimit ?? "0", "gas limit");
  if (gasLimit <= 0n || gasLimit > MAX_GAS) throw new VenueError("The swap route's gas limit is out of range.");

  return {
    tool: String(quote.tool ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32),
    tokenIn: request.tokenIn.toLowerCase() as `0x${string}`,
    tokenOut: request.tokenOut.toLowerCase() as `0x${string}`,
    amountIn: request.amountIn,
    to: SWAP_ROUTER,
    data: tx.data as `0x${string}`,
    gasLimit,
    toAmount,
    toAmountMin,
    fetchedAt,
  };
}

/** Asks LI.FI for a same-chain swap route and validates it. Throws VenueError when there is none or it fails a check. */
export async function fetchRoute(request: RouteRequest, fetchImpl: typeof fetch = fetch): Promise<SwapRoute> {
  // Below a hundredth of a percent the limit would round to zero when sent.
  if (!(request.slippagePercent >= 0.01) || request.slippagePercent > 50 || request.amountIn <= 0n) throw new VenueError("The trade size or slippage limit is not valid.");
  const params = new URLSearchParams({
    fromChain: String(CHAIN_ID),
    toChain: String(CHAIN_ID),
    fromToken: request.tokenIn,
    toToken: request.tokenOut,
    fromAmount: request.amountIn.toString(),
    fromAddress: request.wallet,
    toAddress: request.wallet,
    slippage: (request.slippagePercent / 100).toFixed(6),
  });
  let response: Response;
  try {
    response = await fetchImpl(`${API}/quote?${params}`, {
      headers: { accept: "application/json", ...(env.lifiApiKey ? { "x-lifi-api-key": env.lifiApiKey } : {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new VenueError("The swap router's quote service could not be reached.");
  }
  if (response.status === 429) throw new VenueError("The swap router's quote service is rate limiting this server.");
  if (response.status === 404) throw new VenueError("No swap route is available for this trade.");
  if (!response.ok) throw new VenueError(`The swap router's quote service returned HTTP ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VenueError("The swap router's quote service sent an unreadable reply.");
  }
  return validateRoute(body, request, Date.now());
}
