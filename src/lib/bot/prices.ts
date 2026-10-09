import { env } from "../env";
import { USDG, WETH } from "../trading/chain";
import { fetchSnapshots, topAssets } from "../trading/market-data";

/**
 * One price lookup for anything the user names: a token on Robinhood Chain
 * (by symbol or address) or a major coin anywhere (through CoinGecko). Chain
 * tokens come first because they are what the user's agents trade.
 */

export interface PriceQuote {
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPercent: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  source: "robinhood-chain" | "coingecko";
  /** Set for chain tokens. */
  address?: string;
  /** Set for coins looked up through CoinGecko. */
  coingeckoId?: string;
}

const CRED = { address: "0xaab950f473370aae2fe3a469a8099e9bd2f4ef26", symbol: "CRED", name: "Accred" } as const;

/** The chain's own tokens, known without asking anyone. */
export const CHAIN_TOKENS: Record<string, { address: string; symbol: string; name: string }> = {
  ETH: { ...WETH, name: "Ether (wrapped)" },
  WETH: { ...WETH, name: "Ether (wrapped)" },
  USDG: { ...USDG, name: "Global Dollar" },
  CRED,
};

/** Coins most people ask about, mapped to CoinGecko ids so no search round trip is needed. */
export const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  MATIC: "matic-network",
  POL: "matic-network",
  DOT: "polkadot",
  TRX: "tron",
  TON: "the-open-network",
  LTC: "litecoin",
  SHIB: "shiba-inu",
  UNI: "uniswap",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  PEPE: "pepe",
  USDT: "tether",
  USDC: "usd-coin",
  HYPE: "hyperliquid",
  HOOD: "robinhood-markets",
};

const GECKO_TIMEOUT_MS = 8_000;

function geckoHeaders(): Record<string, string> {
  if (env.coingeckoProApiKey) return { "x-cg-pro-api-key": env.coingeckoProApiKey };
  if (env.coingeckoDemoApiKey) return { "x-cg-demo-api-key": env.coingeckoDemoApiKey };
  return {};
}

function geckoBase(): string {
  return env.coingeckoProApiKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
}

export class PriceError extends Error {}

async function gecko<T>(path: string): Promise<T> {
  const response = await fetch(`${geckoBase()}${path}`, { headers: { accept: "application/json", ...geckoHeaders() }, signal: AbortSignal.timeout(GECKO_TIMEOUT_MS) });
  if (response.status === 429) throw new PriceError("The price provider is limiting requests right now. Try again in a minute.");
  if (!response.ok) throw new PriceError(`The price provider answered ${response.status}.`);
  return (await response.json()) as T;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; row: CoinRow }>();

export interface CoinRow {
  priceUsd: number;
  change24hPercent: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
}

const SYMBOL_BY_ID = new Map(Object.entries(COIN_IDS).map(([symbol, id]) => [id, symbol]));
const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(GECKO_TIMEOUT_MS) });
  if (!response.ok) throw new PriceError(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
};

/** Keyless exchange tickers, tried in turn. Any one of them is enough. */
export async function exchangePrice(symbol: string): Promise<CoinRow | null> {
  const pair = symbol.toUpperCase();
  const stable = pair === "USDT" || pair === "USDC";
  if (stable) return { priceUsd: 1, change24hPercent: 0, marketCapUsd: null, volume24hUsd: null };
  const sources: Array<() => Promise<CoinRow>> = [
    async () => {
      const t = await fetchJson<{ lastPrice: string; priceChangePercent: string; quoteVolume: string }>(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}USDT`);
      return { priceUsd: Number(t.lastPrice), change24hPercent: Number(t.priceChangePercent), marketCapUsd: null, volume24hUsd: Number(t.quoteVolume) };
    },
    async () => {
      const t = await fetchJson<{ data: { amount: string } }>(`https://api.coinbase.com/v2/prices/${pair}-USD/spot`);
      return { priceUsd: Number(t.data.amount), change24hPercent: null, marketCapUsd: null, volume24hUsd: null };
    },
    async () => {
      const t = await fetchJson<{ result: Record<string, { c: [string, string]; p: [string, string]; v: [string, string]; o: string }> }>(`https://api.kraken.com/0/public/Ticker?pair=${pair}USD`);
      const row = Object.values(t.result)[0];
      if (!row) throw new PriceError("no pair");
      const price = Number(row.c[0]);
      const open = Number(row.o);
      return { priceUsd: price, change24hPercent: open ? ((price - open) / open) * 100 : null, marketCapUsd: null, volume24hUsd: Number(row.v[1]) * price };
    },
  ];
  for (const source of sources) {
    try {
      const row = await source();
      if (Number.isFinite(row.priceUsd) && row.priceUsd > 0) return row;
    } catch {
      // Try the next exchange.
    }
  }
  return null;
}

/**
 * Prices for CoinGecko ids, in dollars. CoinGecko is asked once for the batch
 * (it carries market cap); whatever it did not answer is filled from exchange
 * tickers, which need no key. Everything is cached for a minute.
 */
export async function coinPrices(ids: string[], options: { cheap?: boolean } = {}): Promise<Map<string, CoinRow>> {
  const out = new Map<string, CoinRow>();
  const now = Date.now();
  const wanted = [...new Set(ids)].filter((id) => {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_MS) {
      out.set(id, hit.row);
      return false;
    }
    return true;
  });
  if (wanted.length === 0) return out;
  // Background checks (the alert watcher) take the keyless exchanges first, so CoinGecko's monthly
  // allowance stays for questions that need market cap or coins the exchanges do not list.
  if (options.cheap) {
    for (const id of wanted) {
      const symbol = SYMBOL_BY_ID.get(id);
      if (!symbol) continue;
      const row = await exchangePrice(symbol);
      if (row) out.set(id, row);
    }
  }
  const missing = wanted.filter((id) => !out.has(id));
  if (missing.length === 0) {
    for (const id of wanted) cache.set(id, { at: now, row: out.get(id)! });
    return out;
  }
  try {
    const body = await gecko<Record<string, { usd?: number; usd_24h_change?: number; usd_market_cap?: number; usd_24h_vol?: number }>>(
      `/simple/price?ids=${encodeURIComponent(missing.join(","))}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
    );
    for (const [id, row] of Object.entries(body)) {
      if (typeof row.usd === "number") out.set(id, { priceUsd: row.usd, change24hPercent: row.usd_24h_change ?? null, marketCapUsd: row.usd_market_cap ?? null, volume24hUsd: row.usd_24h_vol ?? null });
    }
  } catch {
    // Rate-limited or down: the exchanges below cover the common coins.
  }
  for (const id of wanted) {
    if (out.has(id)) continue;
    const symbol = SYMBOL_BY_ID.get(id);
    if (!symbol) continue;
    const row = await exchangePrice(symbol);
    if (row) out.set(id, row);
  }
  for (const id of wanted) {
    const row = out.get(id);
    if (row) cache.set(id, { at: now, row });
  }
  return out;
}

/** Finds a CoinGecko id for a symbol or name that is not in the short list. */
export async function searchCoin(query: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const body = await gecko<{ coins?: Array<{ id: string; symbol: string; name: string; market_cap_rank: number | null }> }>(`/search?query=${encodeURIComponent(query)}`);
  const coins = body.coins ?? [];
  const wanted = query.toLowerCase();
  const exact = coins.filter((coin) => coin.symbol.toLowerCase() === wanted || coin.name.toLowerCase() === wanted);
  const pick = (exact.length ? exact : coins).sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0];
  return pick ? { id: pick.id, symbol: pick.symbol.toUpperCase(), name: pick.name } : null;
}

export interface Resolved {
  symbol: string;
  name: string;
  address?: string;
  coingeckoId?: string;
}

/** Where a name points: a chain token (by address) or a coin (by CoinGecko id). `preferChain` wins ties such as ETH. */
export async function resolveAsset(query: string, options: { preferChain?: boolean } = {}): Promise<Resolved | null> {
  const clean = query.trim().replace(/^\$/, "");
  const upper = clean.toUpperCase();
  if (/^0x[0-9a-f]{40}$/i.test(clean)) {
    const snapshot = (await fetchSnapshots([clean.toLowerCase()]).catch(() => new Map())).get(clean.toLowerCase());
    return { symbol: snapshot?.symbol ?? clean.slice(0, 8), name: snapshot?.name ?? "Token", address: clean.toLowerCase() };
  }
  const chain = CHAIN_TOKENS[upper];
  if (chain && (options.preferChain || !COIN_IDS[upper])) return { symbol: chain.symbol, name: chain.name, address: chain.address };
  if (COIN_IDS[upper]) return { symbol: upper, name: upper, coingeckoId: COIN_IDS[upper] };
  if (chain) return { symbol: chain.symbol, name: chain.name, address: chain.address };
  const top = await topAssets().catch(() => []);
  const listed = top.find((asset) => asset.symbol.toUpperCase() === upper) ?? top.find((asset) => asset.name.toUpperCase() === upper);
  if (listed) return { symbol: listed.symbol, name: listed.name, address: listed.address };
  const coin = await searchCoin(clean).catch(() => null);
  return coin ? { symbol: coin.symbol, name: coin.name, coingeckoId: coin.id } : null;
}

/** The live price of one resolved asset. */
export async function quote(resolved: Resolved): Promise<PriceQuote> {
  if (resolved.address) {
    let snapshot;
    try {
      snapshot = (await fetchSnapshots([resolved.address], { fresh: true })).get(resolved.address);
    } catch (error) {
      throw new PriceError(error instanceof Error ? error.message : "The chain's price providers did not answer.");
    }
    if (!snapshot) throw new PriceError(`No market found for ${resolved.symbol} on Robinhood Chain right now.`);
    return {
      symbol: snapshot.symbol || resolved.symbol,
      name: snapshot.name || resolved.name,
      priceUsd: snapshot.priceUsd,
      change24hPercent: snapshot.priceChangeH24,
      marketCapUsd: snapshot.marketCapUsd,
      volume24hUsd: snapshot.volumeH24,
      source: "robinhood-chain",
      address: resolved.address,
    };
  }
  const prices = await coinPrices([resolved.coingeckoId!]);
  const row = prices.get(resolved.coingeckoId!);
  if (row) return { symbol: resolved.symbol, name: resolved.name, ...row, source: "coingecko", coingeckoId: resolved.coingeckoId };
  // ETH also trades on the chain as WETH; use that market before giving up.
  const chain = CHAIN_TOKENS[resolved.symbol.toUpperCase()];
  if (chain) return quote({ symbol: chain.symbol, name: chain.name, address: chain.address });
  throw new PriceError(`Every price source is busy or rate-limiting right now; ${resolved.symbol} could not be read. Try again in a minute.`);
}

export function formatQuote(q: PriceQuote): string {
  const price = q.priceUsd >= 1 ? `$${q.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${q.priceUsd.toPrecision(4)}`;
  const parts = [`${q.symbol} ${price}`];
  if (q.change24hPercent !== null) parts.push(`${q.change24hPercent >= 0 ? "+" : ""}${q.change24hPercent.toFixed(2)}% 24h`);
  if (q.marketCapUsd) parts.push(`market cap $${Math.round(q.marketCapUsd).toLocaleString("en-US")}`);
  if (q.volume24hUsd) parts.push(`24h volume $${Math.round(q.volume24hUsd).toLocaleString("en-US")}`);
  parts.push(q.source === "robinhood-chain" ? "on Robinhood Chain" : "spot");
  return parts.join(" · ");
}
