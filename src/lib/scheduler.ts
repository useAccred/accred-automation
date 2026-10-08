import { and, eq, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { createRun, executeRun } from "./agent/runner";
import { automations, db, runs } from "./db";
import { nextRun } from "./schedule";
import { tradingTick } from "./trading/monitor";

const STALE_AFTER_MS = 15 * 60_000;

/**
 * Starts every scheduled automation that is due. Safe to call from several
 * processes at once: an automation is claimed by moving its next run time.
 */
export async function tick(): Promise<{ started: number }> {
  // A run whose process died never reports back; close it out so it does not block the schedule.
  await db
    .update(runs)
    .set({ status: "failed", error: "The run was interrupted. Nothing further was charged.", finishedAt: new Date() })
    .where(and(inArray(runs.status, ["running", "queued"]), lt(runs.updatedAt, new Date(Date.now() - STALE_AFTER_MS))));

  const now = new Date();
  const due = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.enabled, true),
        eq(automations.triggerType, "schedule"),
        isNotNull(automations.nextRunAt),
        lte(automations.nextRunAt, now),
      ),
    )
    .limit(25);

  let started = 0;
  for (const automation of due) {
    let following: Date | null = null;
    try {
      following = nextRun(automation.cron!, automation.timezone, now);
    } catch {
      // An unreadable schedule stops firing instead of firing every tick.
    }
    const claimed = await db
      .update(automations)
      .set({ nextRunAt: following, lastRunAt: now })
      // Still due means nobody else has claimed it. Comparing for equality would be fragile:
      // Postgres keeps microseconds and JavaScript dates do not.
      .where(and(eq(automations.id, automation.id), lte(automations.nextRunAt, now)))
      .returning({ id: automations.id });
    if (claimed.length === 0) continue;

    // Skip this slot while an earlier run is still going or waiting for approval.
    const [active] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.automationId, automation.id), inArray(runs.status, ["queued", "running", "waiting_approval"])))
      .limit(1);
    if (active) continue;

    const run = await createRun(automation, "schedule");
    if (run.runnable) {
      void executeRun(run.id);
      started++;
    }
  }
  return { started };
}

const globalForScheduler = globalThis as unknown as { __accredScheduler?: NodeJS.Timeout };

export function startInternalScheduler(intervalMs = 30_000): void {
  if (globalForScheduler.__accredScheduler) return;
  globalForScheduler.__accredScheduler = setInterval(() => {
    tick().catch((error) => console.error("[scheduler]", error));
    tradingTick().catch((error) => console.error("[scheduler] trading", error));
  }, intervalMs);
  globalForScheduler.__accredScheduler.unref();
}
