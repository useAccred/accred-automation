export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // SCHEDULER=off marks an instance that should not run background work.
  if (process.env.SCHEDULER === "off") return;
  const { startInternalScheduler } = await import("./lib/scheduler");
  startInternalScheduler();
  // Protective exits run on their own timer, with no model in the loop.
  const { startTradingMonitor } = await import("./lib/trading/monitor");
  startTradingMonitor();
  // The Telegram agent (accred-telegram-agent) polls the bot when it runs; then this app only sends.
  if (process.env.TELEGRAM_POLLING !== "off") {
    const { startTelegramPolling } = await import("./lib/telegram");
    startTelegramPolling();
  }
}
