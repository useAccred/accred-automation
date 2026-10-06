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
  get appUrl() {
    return (read("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
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
