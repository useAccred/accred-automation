import { CronExpressionParser } from "cron-parser";

/** Shortest gap allowed between scheduled runs. */
export const MIN_INTERVAL_MINUTES = 5;

export function nextRun(cron: string, timezone: string, from = new Date()): Date {
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: from }).next().toDate();
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Returns an error message for a bad or too-frequent expression, or null when it is fine. */
export function validateCron(cron: string, timezone: string): string | null {
  if (cron.trim().split(/\s+/).length !== 5) return "Use a five-field cron expression: minute hour day month weekday.";
  try {
    const expression = CronExpressionParser.parse(cron, { tz: timezone });
    let previous = expression.next().getTime();
    // Look a few fires ahead so uneven schedules such as "0,1 * * * *" are caught.
    for (let index = 0; index < 6; index++) {
      const next = expression.next().getTime();
      if (next - previous < MIN_INTERVAL_MINUTES * 60_000) return `Runs must be at least ${MIN_INTERVAL_MINUTES} minutes apart.`;
      previous = next;
    }
    return null;
  } catch {
    return "That is not a valid cron expression.";
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (value: string) => value.padStart(2, "0");

/** Plain-words form of the schedules the form can produce; other expressions are shown as written. */
export function describeCron(cron: string): string {
  const [minute, hour, day, month, weekday] = cron.trim().split(/\s+/);
  if (day !== "*" || month !== "*" || minute === undefined || hour === undefined) return `Cron ${cron}`;
  const fixedMinute = /^\d+$/.test(minute);
  if (weekday === "*") {
    const everyMinutes = /^\*\/(\d+)$/.exec(minute)?.[1];
    if (everyMinutes && hour === "*") return `Every ${everyMinutes} minutes`;
    if (fixedMinute && hour === "*") return minute === "0" ? "Every hour" : `Every hour at :${pad(minute)}`;
    const everyHours = /^\*\/(\d+)$/.exec(hour)?.[1];
    if (fixedMinute && everyHours) return `Every ${everyHours} hours`;
    if (fixedMinute && /^\d+$/.test(hour)) return `Every day at ${pad(hour)}:${pad(minute)}`;
  } else if (fixedMinute && /^\d+$/.test(hour) && /^[0-6]$/.test(weekday ?? "")) {
    return `${WEEKDAYS[Number(weekday)]}s at ${pad(hour)}:${pad(minute)}`;
  }
  return `Cron ${cron}`;
}
