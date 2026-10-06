/**
 * Market data for Robinhood Chain. Prices, liquidity and volume come from
 * DexScreener; the list of assets offered in the form comes from GeckoTerminal.
 * Both are public APIs that need no key.
 */

export interface MarketSnapshot {
  network: "robinhood";
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  /** Both sides of the deepest pool, in dollars. */
  liquidityUsd: number;
  marketCapUsd: number | null;
  volumeH1: number | null;
  volumeH6: number | null;
  volumeH24: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;
  priceChangeH6: number | null;
  priceChangeH24: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  pairAddress: string;
  pairCreatedAt: number | null;
  dex: string;
  quoteSymbol: string;
  fetchedAt: number;
  source: "dexscreener";
}

export class MarketDataError extends Error {}

const NETWORK = "robinhood";
const DEXSCREENER = "https://api.dexscreener.com";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const BATCH = 30;
const CACHE_MS = 10_000;

/** Names and symbols are written by whoever deployed the token. Keep only harmless characters. */
export function cleanSymbol(value: unknown, max = 16): string {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9._$ -]/g, "")
    .trim()
    .slice(0, max);
}

const number = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { h1?: number; h6?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
}

/** Turns DexScreener pairs into one snapshot per token, taken from its deepest pool. */
export function snapshotsFromPairs(pairs: unknown, fetchedAt: number): Map<string, MarketSnapshot> {
  const best = new Map<string, MarketSnapshot>();
  if (!Array.isArray(pairs)) return best;
  for (const pair of pairs as DexPair[]) {
    const address = pair?.baseToken?.address?.toLowerCase();
    const priceUsd = number(pair?.priceUsd);
    const liquidityUsd = number(pair?.liquidity?.usd);
    if (pair?.chainId !== NETWORK || !address || !/^0x[0-9a-f]{40}$/.test(address)) continue;
    if (priceUsd === null || priceUsd <= 0 || liquidityUsd === null) continue;
    const current = best.get(address);
    if (current && current.liquidityUsd >= liquidityUsd) continue;
    best.set(address, {
      network: NETWORK,
      address,
      symbol: cleanSymbol(pair.baseToken?.symbol) || "TOKEN",
      name: cleanSymbol(pair.baseToken?.name, 40),
      priceUsd,
      liquidityUsd,
      marketCapUsd: number(pair.marketCap) ?? number(pair.fdv),
      volumeH1: number(pair.volume?.h1),
      volumeH6: number(pair.volume?.h6),
      volumeH24: number(pair.volume?.h24),
      priceChangeM5: number(pair.priceChange?.m5),
      priceChangeH1: number(pair.priceChange?.h1),
      priceChangeH6: number(pair.priceChange?.h6),
      priceChangeH24: number(pair.priceChange?.h24),
      buysH1: number(pair.txns?.h1?.buys),
      sellsH1: number(pair.txns?.h1?.sells),
      pairAddress: String(pair.pairAddress ?? ""),
      pairCreatedAt: number(pair.pairCreatedAt),
      dex: cleanSymbol(pair.dexId, 24),
      quoteSymbol: cleanSymbol(pair.quoteToken?.symbol),
      fetchedAt,
      source: "dexscreener",
    });
  }
  return best;
}

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new MarketDataError("The market data provider could not be reached.");
  }
  if (!response.ok) throw new MarketDataError(`The market data provider returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new MarketDataError("The market data provider sent an unreadable reply.");
  }
}

const cache = new Map<string, MarketSnapshot>();

/**
 * Current snapshots for the given token addresses. A token with no pool on
 * Robinhood Chain is simply absent from the result. Throws MarketDataError when
 * the provider fails, so callers stop instead of trading on old numbers.
 */
export async function fetchSnapshots(addresses: string[], options: { fresh?: boolean } = {}): Promise<Map<string, MarketSnapshot>> {
  const wanted = [...new Set(addresses.map((address) => address.toLowerCase()))].filter((address) => /^0x[0-9a-f]{40}$/.test(address));
  const result = new Map<string, MarketSnapshot>();
  const missing: string[] = [];
  for (const address of wanted) {
    const hit = cache.get(address);
    if (!options.fresh && hit && Date.now() - hit.fetchedAt < CACHE_MS) result.set(address, hit);
    else missing.push(address);
  }
  for (let start = 0; start < missing.length; start += BATCH) {
    const chunk = missing.slice(start, start + BATCH);
    const pairs = await getJson(`${DEXSCREENER}/tokens/v1/${NETWORK}/${chunk.join(",")}`);
    for (const [address, snapshot] of snapshotsFromPairs(pairs, Date.now())) {
      if (!chunk.includes(address)) continue;
      cache.set(address, snapshot);
      result.set(address, snapshot);
    }
  }
  if (cache.size > 2000) cache.clear();
  return result;
}

export interface AssetOption {
  address: string;
  symbol: string;
  name: string;
  liquidityUsd: number;
  volumeH24: number;
}

let topCache: { at: number; value: AssetOption[] } | undefined;
/** Stablecoins and wrapped ether are what positions are bought with, not what the agent trades. */
const NOT_TRADED = new Set(["0x5fc5360d0400a0fd4f2af552add042d716f1d168", "0x0bd7d308f8e1639fab988df18a8011f41eacad73", "0x0000000000000000000000000000000000000000"]);

/** The most traded tokens on Robinhood Chain with real liquidity, for the asset picker. Empty when the provider fails. */
export async function topAssets(): Promise<AssetOption[]> {
  if (topCache && Date.now() - topCache.at < 5 * 60_000) return topCache.value;
  try {
    const body = (await getJson(`${GECKOTERMINAL}/networks/${NETWORK}/pools?page=1&sort=h24_volume_usd_desc&include=base_token`)) as {
      data?: Array<{ attributes?: { reserve_in_usd?: string; volume_usd?: { h24?: string } }; relationships?: { base_token?: { data?: { id?: string } } } }>;
      included?: Array<{ id?: string; attributes?: { address?: string; symbol?: string; name?: string } }>;
    };
    const tokens = new Map((body.included ?? []).map((token) => [token.id, token.attributes]));
    const byAddress = new Map<string, AssetOption>();
    for (const pool of body.data ?? []) {
      const token = tokens.get(pool.relationships?.base_token?.data?.id);
      const address = token?.address?.toLowerCase();
      const liquidityUsd = number(pool.attributes?.reserve_in_usd) ?? 0;
      if (!address || !/^0x[0-9a-f]{40}$/.test(address) || NOT_TRADED.has(address) || liquidityUsd < 10_000) continue;
      const existing = byAddress.get(address);
      if (existing && existing.liquidityUsd >= liquidityUsd) continue;
      byAddress.set(address, {
        address,
        symbol: cleanSymbol(token?.symbol) || "TOKEN",
        name: cleanSymbol(token?.name, 40),
        liquidityUsd,
        volumeH24: number(pool.attributes?.volume_usd?.h24) ?? 0,
      });
    }
    const value = [...byAddress.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 16);
    topCache = { at: Date.now(), value };
    return value;
  } catch {
    return topCache?.value ?? [];
  }
}
