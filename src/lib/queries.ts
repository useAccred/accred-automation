import { and, desc, eq, gte, sql } from "drizzle-orm";
import { listModels } from "./accred";
import { pickRouting, suggestedModels, usableTextModels, worstCaseMicro, type ModelMode } from "./agent/router";
import { formatCredits } from "./credits";
import { automations, connections, db, runs } from "./db";

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getAutomation(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [automation] = await db.select().from(automations).where(and(eq(automations.id, id), eq(automations.userId, userId)));
  return automation;
}

export async function listConnections(userId: string) {
  return db
    .select({ id: connections.id, kind: connections.kind, name: connections.name, display: connections.display, createdAt: connections.createdAt })
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(connections.createdAt);
}

/** Credits and run counts per automation for the current month. */
export async function monthlyUsage(userId: string) {
  const rows = await db
    .select({
      automationId: runs.automationId,
      credits: sql<string>`coalesce(sum(${runs.creditsMicro}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), gte(runs.createdAt, monthStart())))
    .groupBy(runs.automationId);
  return new Map(rows.map((row) => [row.automationId, { credits: BigInt(row.credits), count: row.count }]));
}

export async function latestRuns(userId: string) {
  const rows = await db
    .selectDistinctOn([runs.automationId], { automationId: runs.automationId, id: runs.id, status: runs.status, createdAt: runs.createdAt })
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(runs.automationId, desc(runs.createdAt));
  return new Map(rows.map((row) => [row.automationId, row]));
}

export interface ModelOption {
  id: string;
  name: string;
  input: string;
  output: string;
}

export interface FormCatalog {
  models: ModelOption[];
  /** Which models each mode would use right now, and a worst-case cost for one step. */
  preview: Partial<Record<Exclude<ModelMode, "pinned">, { planner: string; reader: string; stepCredits: string }>>;
  /** One-click picks when choosing models by hand. */
  suggested: Array<{ id: string; name: string; note: string }>;
  error?: string;
}

/** A decision step with a typical mid-run context: about 9,000 characters in, 1,200 tokens out at most. */
const TYPICAL_CONTEXT_CHARS = 9_000;
const STEP_MAX_OUTPUT = 1_200;

export async function formCatalog(): Promise<FormCatalog> {
  try {
    const catalog = await listModels();
    const models = usableTextModels(catalog)
      .map((model) => ({ id: model.id, name: model.name, input: model.inputCostUsdPerMillion!, output: model.outputCostUsdPerMillion! }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const preview: FormCatalog["preview"] = {};
    for (const mode of ["auto", "economy", "quality"] as const) {
      const routing = pickRouting(catalog, mode);
      preview[mode] = {
        planner: routing.planner.name,
        reader: routing.reader.name,
        stepCredits: formatCredits(worstCaseMicro(routing.planner, TYPICAL_CONTEXT_CHARS, STEP_MAX_OUTPUT)),
      };
    }
    const tiers = suggestedModels(catalog);
    const suggested = [
      { id: tiers.smart.id, name: tiers.smart.name, note: "balanced" },
      { id: tiers.top.id, name: tiers.top.name, note: "strongest" },
      { id: tiers.fast.id, name: tiers.fast.name, note: "fast and cheap" },
    ].filter((entry, index, all) => all.findIndex((other) => other.id === entry.id) === index);
    return { models, preview, suggested };
  } catch {
    return { models: [], preview: {}, suggested: [], error: "The Accred model catalog could not be loaded. You can still save with Auto mode." };
  }
}
