import { createPublicClient, defineChain, fallback, http, type PublicClient } from "viem";
import { env } from "../env";

/** Robinhood Chain mainnet, the only network a trading agent may use. */

export const CHAIN_ID = 4663;
export const EXPLORER_URL = "https://robin.etherscan.io";
const PUBLIC_RPC_URLS = ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org"];

/** The chain's dollar stablecoin and wrapped ether. */
export const USDG = { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6 } as const;
export const WETH = { address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", symbol: "WETH", decimals: 18 } as const;

/**
 * The only contract a trading wallet may approve or call: LI.FI's router on
 * Robinhood Chain, as published in LI.FI's chain registry (li.quest/v1/chains,
 * chain 4663, "diamondAddress"). Pinned here so a route that names any other
 * address is refused.
 */
export const SWAP_ROUTER = "0xb477751b76cf82d00a686a1232f5fcd772414af3" as const;

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: PUBLIC_RPC_URLS } },
  blockExplorers: { default: { name: "Etherscan", url: EXPLORER_URL } },
});

export function rpcTransport() {
  const urls = [...(env.robinhoodRpcUrl ? [env.robinhoodRpcUrl] : []), ...PUBLIC_RPC_URLS];
  return fallback(urls.map((url) => http(url, { timeout: 8_000, retryCount: 1 })));
}

let client: PublicClient | undefined;

export function publicClient(): PublicClient {
  client ??= createPublicClient({ chain: robinhoodChain, transport: rpcTransport() }) as PublicClient;
  return client;
}

/**
 * Gas a swap is assumed to use when estimating a fee without sending anything.
 * Deliberately generous: Robinhood Chain is an Arbitrum Orbit chain, where gas
 * also carries the cost of posting the transaction to Ethereum.
 */
export const SWAP_GAS_UNITS = 350_000n;

interface Cached<T> {
  value: T;
  at: number;
}
let gasPrice: Cached<bigint> | undefined;
let ethUsd: Cached<number> | undefined;

async function currentGasPrice(): Promise<bigint> {
  if (gasPrice && Date.now() - gasPrice.at < 30_000) return gasPrice.value;
  const value = await publicClient().getGasPrice();
  gasPrice = { value, at: Date.now() };
  return value;
}

export async function ethPriceUsd(): Promise<number> {
  if (ethUsd && Date.now() - ethUsd.at < 60_000) return ethUsd.value;
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(6_000), cache: "no-store" });
  if (!response.ok) throw new Error(`ETH price request failed with HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { amount?: string } };
  const value = Number(body.data?.amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("ETH price was not a number");
  ethUsd = { value, at: Date.now() };
  return value;
}

/** What a swap would cost in network fees right now, in dollars. Throws when it cannot be determined. */
export async function networkFeeUsd(): Promise<number> {
  const [price, eth] = await Promise.all([currentGasPrice(), ethPriceUsd()]);
  const fee = (Number(price * SWAP_GAS_UNITS) / 1e18) * eth;
  if (!Number.isFinite(fee) || fee < 0) throw new Error("The network fee could not be estimated");
  return fee;
}
