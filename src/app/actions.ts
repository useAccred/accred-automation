"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { checkApiKey, listModels } from "@/lib/accred";
import { usableTextModels } from "@/lib/agent/router";
import { cancelRun, createRun, executeRun, resolveApproval } from "@/lib/agent/runner";
import { testConnection } from "@/lib/agent/tools";
import { createSession, destroySession, rateLimited, requireUser } from "@/lib/auth";
import { revokeGoogleToken } from "@/lib/connections/gmail";
import { CONNECTION_KINDS, isConnectionKind } from "@/lib/connections/kinds";
import { MICRO, toMicro } from "@/lib/credits";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { automations, connections, db, runs, users } from "@/lib/db";
import { isValidTimezone, nextRun, validateCron } from "@/lib/schedule";
import {
  OwnBotError,
  checkOwnBotLink,
  createOwnBotLink,
  createTelegramLink,
  sharedBotConfigured,
  type OwnBotLinkStatus,
} from "@/lib/telegram";

export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

// ── Account ─────────────────────────────────────────────────────────────────

async function validatedKey(form: FormData): Promise<{ key: string } | { error: string }> {
  const key = text(form, "apiKey");
  if (key.length < 24 || key.length > 256 || /\s/.test(key)) {
    return { error: "That does not look like an Accred API key. Keys start with ct_live_." };
  }
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(`signin:${forwarded}`, 8, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  const check = await checkApiKey(key);
  if (check === "unavailable") return { error: "Accred could not be reached to check the key. Try again in a moment." };
  if (check === "invalid") return { error: "Accred did not accept that key. Check it has not been revoked." };
  return { key };
}

export async function signIn(_previous: FormState, form: FormData): Promise<FormState> {
  const result = await validatedKey(form);
  if ("error" in result) return result;
  const keyHash = sha256(result.key);
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.keyHash, keyHash));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ keyHash, keyEnc: encrypt(result.key), keyHint: result.key.slice(-4) })
      .onConflictDoUpdate({ target: users.keyHash, set: { keyHash } })
      .returning({ id: users.id });
  }
  await createSession(user!.id);
  redirect("/app");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function replaceKey(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await validatedKey(form);
  if ("error" in result) return result;
  const keyHash = sha256(result.key);
  const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.keyHash, keyHash), ne(users.id, user.id)));
  if (taken) return { error: "That key already signs in to a different automation account." };
  await db
    .update(users)
    .set({ keyHash, keyEnc: encrypt(result.key), keyHint: result.key.slice(-4), balanceExact: null, balanceAt: null, balanceSource: null })
    .where(eq(users.id, user.id));
  revalidatePath("/app", "layout");
  return { values: { saved: "1" } };
}

export async function deleteAccount(): Promise<void> {
  const user = await requireUser();
  await destroySession();
  await db.delete(users).where(eq(users.id, user.id));
  redirect("/");
}

// ── Connections ─────────────────────────────────────────────────────────────

export async function addConnection(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const kind = text(form, "kind");
  if (!isConnectionKind(kind)) return { error: "Unknown connection type." };
  const info = CONNECTION_KINDS[kind];
  if (info.oauth) return { error: `${info.label} is connected by signing in, not through this form.` };

  const config: Record<string, string> = {};
  const display: Record<string, string> = {};
  for (const field of info.fields) {
    const value = text(form, field.key);
    if (value.length > 2000) return { error: `${field.label} is too long.` };
    if (!value && field.required) return { error: `${field.label} is required.`, values: display };
    if (value) {
      config[field.key] = value;
      if (!field.secret) display[field.key] = value;
    }
  }
  const name = text(form, "name").slice(0, 60) || info.label;

  const problem = await testConnection(kind, config);
  if (problem) return { error: problem, values: { ...display, name } };

  await db.insert(connections).values({ userId: user.id, kind, name, configEnc: encrypt(JSON.stringify(config)), display });
  revalidatePath("/app/connections");
  return { values: { saved: kind } };
}

export async function startTelegramLink(): Promise<FormState> {
  const user = await requireUser();
  if (!sharedBotConfigured()) return { error: "The Telegram bot is not set up on this server." };
  if (rateLimited(`telegram-link:${user.id}`, 10, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  try {
    return { values: { url: await createTelegramLink(user.id) } };
  } catch {
    return { error: "Telegram could not be reached. Try again in a moment." };
  }
}

export async function startOwnTelegramLink(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (rateLimited(`telegram-link:${user.id}`, 10, 60_000)) return { error: "Too many attempts. Wait a minute and try again." };
  try {
    const link = await createOwnBotLink(user.id, text(form, "botToken"));
    return { values: link };
  } catch (error) {
    return { error: error instanceof OwnBotError ? error.message : "Telegram could not be reached. Try again in a moment." };
  }
}

/** Polled by the Connections page while a user is linking their own bot. */
export async function checkOwnTelegramLink(code: string): Promise<OwnBotLinkStatus> {
  const user = await requireUser();
  if (typeof code !== "string" || code.length > 64) return "expired";
  const status = await checkOwnBotLink(user.id, code);
  if (status === "linked") revalidatePath("/app/connections");
  return status;
}

export async function removeConnection(form: FormData): Promise<void> {
  const user = await requireUser();
  const [removed] = await db
    .delete(connections)
    .where(and(eq(connections.id, text(form, "id")), eq(connections.userId, user.id)))
    .returning({ kind: connections.kind, configEnc: connections.configEnc });
  if (removed?.kind === "gmail") {
    // Also withdraw the grant at Google, so removing here really ends the access.
    try {
      await revokeGoogleToken((JSON.parse(decrypt(removed.configEnc)) as { refreshToken: string }).refreshToken);
    } catch {
      // The connection is gone either way.
    }
  }
  revalidatePath("/app/connections");
}

// ── Automations ─────────────────────────────────────────────────────────────

const credits = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, "Enter a number of credits, such as 10 or 2.5.");

const AutomationInput = z.object({
  name: z.string().min(1, "Give the automation a name.").max(80),
  instruction: z.string().min(10, "Describe the job in at least a sentence.").max(4000),
  triggerType: z.enum(["manual", "schedule", "webhook"]),
  cron: z.string().max(100),
  timezone: z.string().max(64),
  modelMode: z.enum(["auto", "economy", "quality", "pinned"]),
  modelId: z.string().max(200),
  readerModelId: z.string().max(200),
  maxPerRun: credits,
  maxPerMonth: credits,
});

async function ownAutomation(userId: string, id: string) {
  const [automation] = await db.select().from(automations).where(and(eq(automations.id, id), eq(automations.userId, userId)));
  return automation;
}

export async function saveAutomation(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = AutomationInput.safeParse({
    name: text(form, "name"),
    instruction: text(form, "instruction"),
    triggerType: text(form, "triggerType"),
    cron: text(form, "cron"),
    timezone: text(form, "timezone") || "UTC",
    modelMode: text(form, "modelMode"),
    modelId: text(form, "modelId"),
    readerModelId: text(form, "readerModelId"),
    maxPerRun: text(form, "maxPerRun"),
    maxPerMonth: text(form, "maxPerMonth"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const input = parsed.data;
  const timezone = isValidTimezone(input.timezone) ? input.timezone : "UTC";

  const maxPerRunMicro = toMicro(input.maxPerRun);
  const maxPerMonthMicro = toMicro(input.maxPerMonth);
  if (maxPerRunMicro < MICRO / 10n) return { error: "The per-run budget must be at least 0.1 credits." };
  if (maxPerRunMicro > 1000n * MICRO) return { error: "The per-run budget can be at most 1,000 credits." };
  if (maxPerMonthMicro < maxPerRunMicro) return { error: "The monthly cap cannot be lower than the per-run budget." };

  if (input.triggerType === "schedule") {
    const problem = validateCron(input.cron, timezone);
    if (problem) return { error: problem };
  }

  const connectionIds = [...new Set(form.getAll("connectionIds").map(String))].filter((id) => z.uuid().safeParse(id).success);
  if (connectionIds.length > 0) {
    const owned = await db
      .select({ id: connections.id, kind: connections.kind })
      .from(connections)
      .where(and(eq(connections.userId, user.id), inArray(connections.id, connectionIds)));
    if (owned.length !== connectionIds.length) return { error: "One of the selected connections no longer exists." };
    if (new Set(owned.map((row) => row.kind)).size !== owned.length) {
      return { error: "Pick at most one connection of each type per automation." };
    }
  }

  let modelId: string | null = null;
  let readerModelId: string | null = null;
  if (input.modelMode === "pinned") {
    const models = usableTextModels(await listModels());
    if (!models.some((model) => model.id === input.modelId)) {
      return { error: "Pick the brain model from the list. That one is not available right now." };
    }
    if (input.readerModelId && !models.some((model) => model.id === input.readerModelId)) {
      return { error: "Pick the reading model from the list, or leave it empty to use the brain model." };
    }
    modelId = input.modelId;
    readerModelId = input.readerModelId || null;
  }

  const enabled = form.get("enabled") !== "off";
  const values = {
    name: input.name,
    instruction: input.instruction,
    triggerType: input.triggerType,
    cron: input.triggerType === "schedule" ? input.cron : null,
    timezone,
    connectionIds,
    modelMode: input.modelMode,
    modelId,
    readerModelId,
    maxPerRunMicro,
    maxPerMonthMicro,
    requireApproval: form.get("requireApproval") === "on",
    enabled,
    nextRunAt: input.triggerType === "schedule" && enabled ? nextRun(input.cron, timezone) : null,
    updatedAt: new Date(),
  };

  const id = text(form, "id");
  let targetId = id;
  if (id) {
    const existing = await ownAutomation(user.id, id);
    if (!existing) return { error: "This automation no longer exists." };
    await db.update(automations).set(values).where(eq(automations.id, id));
  } else {
    const [created] = await db
      .insert(automations)
      .values({ ...values, userId: user.id, webhookToken: randomToken(24) })
      .returning({ id: automations.id });
    targetId = created!.id;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/automations/${targetId}`);
}

export async function deleteAutomation(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.delete(automations).where(and(eq(automations.id, text(form, "id")), eq(automations.userId, user.id)));
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function setEnabled(form: FormData): Promise<void> {
  const user = await requireUser();
  const automation = await ownAutomation(user.id, text(form, "id"));
  if (!automation) return;
  const enabled = text(form, "enabled") === "true";
  await db
    .update(automations)
    .set({
      enabled,
      nextRunAt: enabled && automation.triggerType === "schedule" && automation.cron ? nextRun(automation.cron, automation.timezone) : null,
    })
    .where(eq(automations.id, automation.id));
  revalidatePath("/app", "layout");
}

export async function clearMemory(form: FormData): Promise<void> {
  const user = await requireUser();
  await db.update(automations).set({ memory: "" }).where(and(eq(automations.id, text(form, "id")), eq(automations.userId, user.id)));
  revalidatePath("/app", "layout");
}

export async function rotateWebhook(form: FormData): Promise<void> {
  const user = await requireUser();
  await db
    .update(automations)
    .set({ webhookToken: randomToken(24) })
    .where(and(eq(automations.id, text(form, "id")), eq(automations.userId, user.id)));
  revalidatePath("/app", "layout");
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function runNow(form: FormData): Promise<void> {
  const user = await requireUser();
  const automation = await ownAutomation(user.id, text(form, "id"));
  if (!automation) redirect("/app");
  const run = await createRun(automation, "manual");
  if (run.runnable) after(() => executeRun(run.id));
  redirect(`/app/runs/${run.id}`);
}

export async function decideApproval(form: FormData): Promise<void> {
  const user = await requireUser();
  const runId = text(form, "runId");
  const proceed = await resolveApproval(runId, user.id, text(form, "decision") === "approve");
  if (proceed) after(proceed);
  revalidatePath(`/app/runs/${runId}`);
}

export async function stopRun(form: FormData): Promise<void> {
  const user = await requireUser();
  const runId = text(form, "runId");
  const [run] = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.id)));
  if (run) await cancelRun(run.id, user.id);
  revalidatePath(`/app/runs/${runId}`);
}
