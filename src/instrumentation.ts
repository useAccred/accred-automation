export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // SCHEDULER=off marks an instance that should not run background work.
  if (process.env.SCHEDULER === "off") return;
  const { startInternalScheduler } = await import("./lib/scheduler");
  startInternalScheduler();
  const { startTelegramPolling } = await import("./lib/telegram");
  startTelegramPolling();
}
