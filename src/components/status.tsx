import type { RunStatus } from "@/lib/db/schema";
import { RUN_STATUS } from "@/lib/format";

const TONES = {
  muted: "text-muted",
  blue: "text-primary-soft",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
} as const;

export function StatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS[status];
  return (
    <span className={`badge ${TONES[meta.tone]}`}>
      <span className={`dot ${meta.active ? "pulse" : ""}`} />
      {meta.label}
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "success" | "warning"; children: React.ReactNode }) {
  const styles = {
    danger: "border-danger/30 bg-danger/10 text-danger",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
  } as const;
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-[13px] ${styles[tone]}`}>
      {children}
    </p>
  );
}
