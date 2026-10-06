/**
 * Market data for Robinhood Chain. Prices, liquidity and volume come from
 * DexScreener or GeckoTerminal, whichever answers; the list of assets offered
 * in the form comes from GeckoTerminal. Both are public APIs that need no key
 * and limit requests per address, which a shared host's address often exceeds
 * through no doing of this app. A CoinGecko API key, when set, adds a source
 * whose limit belongs to the key instead.
 */

import { env } from "../env";

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
  source: "dexscreener" | "geckoterminal" | "coingecko";
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    /** The HTTP status the provider answered with, when it answered. */
    readonly status?: number,
    /** How long the provider asked to be left alone, when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const NETWORK = "robinhood";
const DEXSCREENER = "https://api.dexscreener.com";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const BATCH = 30;
const CACHE_MS = 10_000;
/** A provider that failed is left alone for this long, unless it named its own wait, so requests do not queue up on it. */
const REST_MS = 15_000;
const MAX_REST_MS = 60_000;
/**
 * Pauses before each further round of asking, when every provider has refused.
 * The providers count requests per address in short windows, and a shared host's
 * address is over the limit about as often as not, so a later try often lands.
 */
const RETRY_PAUSES_MS = [700, 2_500, 5_000];
/**
 * When no provider answers, the last snapshot is used again if it is no older
 * than this. It keeps the time it was really fetched, so every check that
 * refuses old data still judges it by its true age.
 */
const BRIDGE_MS = 75_000;

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

interface GeckoToken {
  attributes?: { address?: string; symbol?: string; name?: string; price_usd?: string; market_cap_usd?: string; fdv_usd?: string };
  relationships?: { top_pools?: { data?: Array<{ id?: string }> } };
}

interface GeckoPool {
  id?: string;
  attributes?: {
    address?: string;
    name?: string;
    pool_created_at?: string;
    reserve_in_usd?: string;
    volume_usd?: { h1?: string; h6?: string; h24?: string };
    price_change_percentage?: { m5?: string; h1?: string; h6?: string; h24?: string };
    transactions?: { h1?: { buys?: number; sells?: number } };
  };
  relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
}

/**
 * Turns a GeckoTerminal token reply, with each token's top pools included, into
 * one snapshot per token, taken from its deepest pool. GeckoTerminal counts a
 * pool's depth more narrowly than DexScreener, so liquidity reads lower here.
 */
export function snapshotsFromGecko(body: unknown, fetchedAt: number, source: "geckoterminal" | "coingecko" = "geckoterminal"): Map<string, MarketSnapshot> {
  const found = new Map<string, MarketSnapshot>();
  const reply = body as { data?: GeckoToken[]; included?: GeckoPool[] } | null;
  if (!reply || !Array.isArray(reply.data)) return found;
  const pools = new Map((Array.isArray(reply.included) ? reply.included : []).map((pool) => [pool?.id, pool]));
  for (const token of reply.data) {
    const address = token?.attributes?.address?.toLowerCase();
    const priceUsd = number(token?.attributes?.price_usd);
    if (!address || !/^0x[0-9a-f]{40}$/.test(address) || priceUsd === null || priceUsd <= 0) continue;
    let pool: GeckoPool | undefined;
    for (const entry of token.relationships?.top_pools?.data ?? []) {
      const candidate = pools.get(entry?.id);
      const depth = number(candidate?.attributes?.reserve_in_usd);
      if (candidate && depth !== null && depth > (number(pool?.attributes?.reserve_in_usd) ?? -1)) pool = candidate;
    }
    const liquidityUsd = number(pool?.attributes?.reserve_in_usd);
    if (!pool || liquidityUsd === null) continue;
    // A pool's price changes describe its base token. For a token on the other side they are left unknown.
    const isBase = pool.relationships?.base_token?.data?.id === `${NETWORK}_${address}`;
    const change = isBase ? pool.attributes?.price_change_percentage : undefined;
    const created = Date.parse(pool.attributes?.pool_created_at ?? "");
    found.set(address, {
      network: NETWORK,
      address,
      symbol: cleanSymbol(token.attributes?.symbol) || "TOKEN",
      name: cleanSymbol(token.attributes?.name, 40),
      priceUsd,
      liquidityUsd,
      marketCapUsd: number(token.attributes?.market_cap_usd) ?? number(token.attributes?.fdv_usd),
      volumeH1: number(pool.attributes?.volume_usd?.h1),
      volumeH6: number(pool.attributes?.volume_usd?.h6),
      volumeH24: number(pool.attributes?.volume_usd?.h24),
      priceChangeM5: number(change?.m5),
      priceChangeH1: number(change?.h1),
      priceChangeH6: number(change?.h6),
      priceChangeH24: number(change?.h24),
      buysH1: number(pool.attributes?.transactions?.h1?.buys),
      sellsH1: number(pool.attributes?.transactions?.h1?.sells),
      pairAddress: String(pool.attributes?.address ?? ""),
      pairCreatedAt: Number.isFinite(created) ? created : null,
      dex: cleanSymbol(pool.relationships?.dex?.data?.id, 24),
      quoteSymbol: cleanSymbol(String(pool.attributes?.name ?? "").split(" / ")[isBase ? 1 : 0]),
      fetchedAt,
      source,
    });
  }
  return found;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new MarketDataError("could not be reached");
  }
  if (!response.ok) {
    const wait = Number(response.headers.get("retry-after"));
    throw new MarketDataError(`returned HTTP ${response.status}`, response.status, Number.isFinite(wait) && wait > 0 ? wait * 1000 : undefined);
  }
  try {
    return await response.json();
  } catch {
    throw new MarketDataError("sent an unreadable reply");
  }
}

interface Provider {
  name: string;
  url(addresses: string[]): string;
  headers?: Record<string, string>;
  parse(body: unknown, fetchedAt: number): Map<string, MarketSnapshot>;
}

/** Sources of token snapshots, in the order they are asked. Every one covers the same pools. */
function providers(): Provider[] {
  const list: Provider[] = [];
  // A keyed source first: its limit is the key's own, not shared with other tenants of the host.
  const pro = env.coingeckoProApiKey;
  const demo = env.coingeckoDemoApiKey;
  if (pro || demo) {
    list.push({
      name: "CoinGecko",
      url: (addresses) => `https://${pro ? "pro-api" : "api"}.coingecko.com/api/v3/onchain/networks/${NETWORK}/tokens/multi/${addresses.join(",")}?include=top_pools`,
      headers: pro ? { "x-cg-pro-api-key": pro } : { "x-cg-demo-api-key": demo! },
      parse: (body, at) => snapshotsFromGecko(body, at, "coingecko"),
    });
  }
  list.push(
    { name: "DexScreener", url: (addresses) => `${DEXSCREENER}/tokens/v1/${NETWORK}/${addresses.join(",")}`, parse: snapshotsFromPairs },
    // The same pairs from DexScreener's older endpoint, which is limited separately.
    { name: "DexScreener (latest)", url: (addresses) => `${DEXSCREENER}/latest/dex/tokens/${addresses.join(",")}`, parse: (body, at) => snapshotsFromPairs((body as { pairs?: unknown } | null)?.pairs, at) },
    { name: "GeckoTerminal", url: (addresses) => `${GECKOTERMINAL}/networks/${NETWORK}/tokens/multi/${addresses.join(",")}?include=top_pools`, parse: (body, at) => snapshotsFromGecko(body, at) },
  );
  return list;
}

const cache = new Map<string, MarketSnapshot>();
/** When each provider may be asked again. A wait the provider named itself is firm; our own default is not. */
const rests = new Map<string, { until: number; firm: boolean }>();

/**
 * Snapshots for one batch of addresses, from the first provider that answers.
 * A provider that refuses rests for as long as it asks, or a default. If every
 * provider refuses, they are asked again after a pause, a few times over, except
 * one still inside a wait it named itself. Then the error goes to the caller.
 */
async function fetchBatch(chunk: string[]): Promise<Map<string, MarketSnapshot>> {
  const failures = new Map<string, string>();
  for (let round = 0; round <= RETRY_PAUSES_MS.length; round++) {
    // Nothing has failed yet only when every provider was resting: then there is nothing to wait for.
    if (round > 0 && failures.size > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSES_MS[round - 1]));
    for (const provider of providers()) {
      const rest = rests.get(provider.name);
      // The first round skips any resting provider. Later rounds are the last chances, so only a wait the provider named is kept.
      if (rest && Date.now() < rest.until && (round === 0 || rest.firm)) continue;
      try {
        return provider.parse(await getJson(provider.url(chunk), provider.headers), Date.now());
      } catch (error) {
        const failure = error instanceof MarketDataError ? error : new MarketDataError("failed");
        const wait = Math.min(failure.retryAfterMs ?? REST_MS, MAX_REST_MS);
        if (!failures.has(provider.name)) console.warn(`[market-data] ${provider.name} ${failure.message}; resting it for ${Math.round(wait / 1000)}s`);
        rests.set(provider.name, { until: Date.now() + wait, firm: failure.retryAfterMs !== undefined });
        failures.set(provider.name, failure.message);
      }
    }
  }
  const resting = providers().filter((provider) => !failures.has(provider.name)).map((provider) => `${provider.name} asked to be left alone`);
  const limited = [...failures.values()].every((message) => message.includes("429"));
  throw new MarketDataError(
    `${limited ? "The market data providers are limiting requests from this server" : "No market data provider answered"} (${[...[...failures].map(([name, message]) => `${name} ${message}`), ...resting].join("; ")}).`,
    limited ? 429 : undefined,
  );
}

/**
 * Current snapshots for the given token addresses. A token with no pool on
 * Robinhood Chain is simply absent from the result. When no provider answers,
 * a snapshot fetched in the last minute or so is used again with its real age;
 * failing that it throws MarketDataError, so callers stop instead of trading on
 * old numbers.
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
    let found: Map<string, MarketSnapshot>;
    try {
      found = await fetchBatch(chunk);
    } catch (error) {
      const recent = chunk.flatMap((address) => {
        const last = cache.get(address);
        return last && Date.now() - last.fetchedAt <= BRIDGE_MS ? [[address, last] as const] : [];
      });
      // Bridge the gap only when every asset asked for has a recent snapshot; half an answer would read as "no pool".
      if (recent.length < chunk.length) throw error;
      for (const [address, snapshot] of recent) result.set(address, snapshot);
      continue;
    }
    for (const [address, snapshot] of found) {
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
  if (topCache && Date.now() - topCache.at < 15 * 60_000) return topCache.value;
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
