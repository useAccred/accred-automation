function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appSecret() {
    const secret = required("APP_SECRET");
    if (secret.length < 32) throw new Error("APP_SECRET must be at least 32 characters.");
    return secret;
  },
  /** True when APP_URL is set explicitly, as opposed to falling back to the host's own address. */
  get appUrlConfigured() {
    return Boolean(read("APP_URL"));
  },
  get appUrl() {
    // Render sets RENDER_EXTERNAL_URL to the service's public address.
    return (read("APP_URL") ?? read("RENDER_EXTERNAL_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  get accredBaseUrl() {
    return (read("ACCRED_BASE_URL") ?? "https://accred.sh").replace(/\/+$/, "");
  },
  /** Token of the shared Telegram bot. Without it, users link their own bot by hand. */
  get telegramBotToken() {
    return read("TELEGRAM_BOT_TOKEN");
  },
  /** OAuth client from Google Cloud, for the Gmail connection. */
  get googleClientId() {
    return read("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return read("GOOGLE_CLIENT_SECRET");
  },
  /**
   * Protects trading-wallet keys. When unset, a key is derived from APP_SECRET
   * under its own label, so wallet keys still never share a key with stored API keys.
   */
  get tradingWalletSecret() {
    const secret = read("TRADING_WALLET_SECRET");
    if (secret && secret.length < 32) throw new Error("TRADING_WALLET_SECRET must be at least 32 characters.");
    return secret;
  },
  /**
   * Whether this server may trade with real funds. Off unless LIVE_TRADING is
   * exactly "on". With it off, no code path can sign a trade.
   */
  get liveTrading() {
    return read("LIVE_TRADING") === "on";
  },
  /**
   * Tests only. The retired Paper Mode's fill model is kept as a fixture for the
   * test suite; nothing in the product can create or run a paper agent without this.
   */
  get paperFixture() {
    return read("TRADING_PAPER_FIXTURE") === "on";
  },
  /** Optional LI.FI API key, for a higher request limit on swap routes. */
  get lifiApiKey() {
    return read("LIFI_API_KEY");
  },
  /**
   * Optional CoinGecko API keys, for market data whose request limit belongs to
   * the key. The public providers limit by address, which a shared host exceeds.
   */
  get coingeckoProApiKey() {
    return read("COINGECKO_PRO_API_KEY");
  },
  get coingeckoDemoApiKey() {
    return read("COINGECKO_DEMO_API_KEY");
  },
  /** An extra Robinhood Chain RPC endpoint, tried before the public ones. HTTPS only. */
  get robinhoodRpcUrl() {
    const url = read("ROBINHOOD_RPC_URL");
    return url && /^https:\/\/[^\s]+$/.test(url) ? url : undefined;
  },
  get cronSecret() {
    return read("CRON_SECRET");
  },
  get schedulerMode() {
    return read("SCHEDULER") === "off" ? "off" : "internal";
  },
  routerOverride(tier: "smart" | "fast" | "top") {
    return read(`ROUTER_${tier.toUpperCase()}_MODEL`);
  },
};
