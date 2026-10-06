import type { RunStatus } from "./db/schema";

export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "never";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const [value, unit] =
    abs < 60 ? [abs, "s"] : abs < 3600 ? [Math.round(abs / 60), " min"] : abs < 86_400 ? [Math.round(abs / 3600), " h"] : [Math.round(abs / 86_400), " d"];
  if (abs < 5) return "just now";
  return future ? `in ${value}${unit}` : `${value}${unit} ago`;
}

export function formatWhen(date: Date | null | undefined, timezone = "UTC"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const RUN_STATUS: Record<RunStatus, { label: string; tone: "muted" | "blue" | "success" | "danger" | "warning"; active: boolean }> = {
  queued: { label: "Queued", tone: "muted", active: true },
  running: { label: "Running", tone: "blue", active: true },
  waiting_approval: { label: "Needs approval", tone: "warning", active: false },
  succeeded: { label: "Succeeded", tone: "success", active: false },
  failed: { label: "Failed", tone: "danger", active: false },
  stopped_budget: { label: "Stopped at budget", tone: "warning", active: false },
  cancelled: { label: "Cancelled", tone: "muted", active: false },
};

export const TRIGGER_LABEL = { manual: "Manual", schedule: "Schedule", webhook: "Webhook" } as const;
