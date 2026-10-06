import { auditEvents, db } from "../db";

/** Anything that can write to the database: the pool or an open transaction. */
export type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute">;

type AuditInsert = typeof auditEvents.$inferInsert;

export type AuditEntry = Pick<AuditInsert, "userId" | "type" | "actor" | "summary"> &
  Partial<Pick<AuditInsert, "automationId" | "walletId" | "runId" | "proposalId" | "positionId" | "data">>;

const SECRET_NAME = /(private|secret|seed|mnemonic|password|passphrase|keyenc|apikey|bottoken|accesstoken|refreshtoken|authorization|signature|webhookurl|headervalue)/;
/** Matches however the name is written: privateKey, private_key, PRIVATE-KEY. */
const isSecretName = (key: string) => SECRET_NAME.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));

/** Drops any field whose name suggests a secret, at any depth, before it can reach the log. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isSecretName(key))
        .map(([key, entry]) => [key, redact(entry, depth + 1)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

/** Appends one event to the audit log. Events are never updated or deleted by the app. */
export async function audit(entry: AuditEntry, executor: Executor = db): Promise<void> {
  await executor.insert(auditEvents).values({
    ...entry,
    summary: entry.summary.slice(0, 500),
    data: entry.data ? (redact(entry.data) as Record<string, unknown>) : null,
  });
}
