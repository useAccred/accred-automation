import { and, desc, eq, gt, gte, sql, sum } from "drizzle-orm";
import { db, users, webBotActions, webBotMessages, webBots, type User, type WebBot, type WebBotMessage, type WebBotMessageKind, type WebBotMessageRole } from "../db";
import { BOT_PRESETS, presetById } from "./presets";

/** Database access for web bots: bots, their threads and pending actions. */

export const TRANSCRIPT_BYTES = 16_000;
export const TRANSCRIPT_MESSAGES = 30;
export const MEMORY_CHARS = 2_000;
export const THREAD_PAGE = 200;
const ACTION_MINUTES = 15;
/** A reply that has taken longer than this is treated as abandoned. */
export const BUSY_STALE_MS = 4 * 60_000;

export type Transcript = WebBot["transcript"];

export async function loadBot(botId: string, userId: string): Promise<{ bot: WebBot; user: User } | undefined> {
  const [row] = await db
    .select({ bot: webBots, user: users })
    .from(webBots)
    .innerJoin(users, eq(users.id, webBots.userId))
    .where(and(eq(webBots.id, botId), eq(webBots.userId, userId)));
  return row;
}

export interface BotSummary {
  id: string;
  name: string;
  color: WebBot["color"];
  shape: WebBot["shape"];
  preset: string | null;
  role: string;
  modelMode: WebBot["modelMode"];
  modelId: string | null;
  busy: boolean;
  lastMessageAt: string | null;
  /** The newest line in the thread, for the sidebar. */
  preview: string;
  previewRole: WebBotMessageRole | null;
}

export async function listBots(userId: string): Promise<BotSummary[]> {
  const rows = await db
    .select()
    .from(webBots)
    .where(eq(webBots.userId, userId))
    .orderBy(desc(sql`coalesce(${webBots.lastMessageAt}, ${webBots.createdAt})`));
  const now = Date.now();
  return Promise.all(
    rows.map(async (bot) => {
      const [last] = await db
        .select({ role: webBotMessages.role, content: webBotMessages.content, kind: webBotMessages.kind, meta: webBotMessages.meta })
        .from(webBotMessages)
        .where(eq(webBotMessages.botId, bot.id))
        .orderBy(desc(webBotMessages.createdAt))
        .limit(1);
      return {
        id: bot.id,
        name: bot.name,
        color: bot.color,
        shape: bot.shape,
        preset: bot.preset,
        role: bot.role,
        modelMode: bot.modelMode,
        modelId: bot.modelId,
        busy: Boolean(bot.busySince && now - bot.busySince.getTime() < BUSY_STALE_MS),
        lastMessageAt: bot.lastMessageAt?.toISOString() ?? null,
        preview: last ? preview(last) : presetById(bot.preset)?.tagline ?? "Say hello.",
        previewRole: last?.role ?? null,
      };
    }),
  );
}

function preview(message: { role: WebBotMessageRole; content: string; kind: WebBotMessageKind; meta: Record<string, unknown> }): string {
  if (message.kind === "action") {
    const status = String(message.meta.status ?? "pending");
    const label = { pending: "Waiting for your confirmation", done: "Done", cancelled: "Cancelled", failed: "Failed", expired: "Expired" }[status] ?? status;
    return status === "pending" ? label : `${label}: ${message.content}`;
  }
  const flat = message.content.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

export async function createBot(userId: string, input: { name: string; role: string; color: WebBot["color"]; shape: WebBot["shape"]; preset?: string | null }): Promise<WebBot> {
  const [bot] = await db
    .insert(webBots)
    .values({ userId, name: input.name, role: input.role, color: input.color, shape: input.shape, preset: input.preset ?? null })
    .returning();
  return bot!;
}

/** The first visit gets the Chief, so the workspace is never empty. */
export async function ensureStarterBot(userId: string): Promise<void> {
  const [existing] = await db.select({ id: webBots.id }).from(webBots).where(eq(webBots.userId, userId)).limit(1);
  if (existing) return;
  const chief = BOT_PRESETS[0]!;
  const bot = await createBot(userId, { name: chief.name, role: chief.role, color: chief.color, shape: chief.shape, preset: chief.id });
  await addMessage({
    botId: bot.id,
    userId,
    role: "bot",
    kind: "text",
    content: "hi, i'm your chief of staff. tell me what you're working on and i'll keep track, research, and chase the loose ends. for anything that writes or sends, i'll ask you first.",
  });
}

export async function updateBot(botId: string, patch: Partial<typeof webBots.$inferInsert>): Promise<void> {
  await db.update(webBots).set({ ...patch, updatedAt: new Date() }).where(eq(webBots.id, botId));
}

export async function deleteBot(botId: string, userId: string): Promise<boolean> {
  const deleted = await db.delete(webBots).where(and(eq(webBots.id, botId), eq(webBots.userId, userId))).returning({ id: webBots.id });
  return deleted.length > 0;
}

export async function addMessage(message: typeof webBotMessages.$inferInsert): Promise<WebBotMessage> {
  const [row] = await db.insert(webBotMessages).values(message).returning();
  await db.update(webBots).set({ lastMessageAt: row!.createdAt, updatedAt: new Date() }).where(eq(webBots.id, message.botId));
  return row!;
}

export async function updateMessage(id: string, patch: Partial<typeof webBotMessages.$inferInsert>): Promise<void> {
  await db.update(webBotMessages).set(patch).where(eq(webBotMessages.id, id));
}

/** The thread, oldest first. With `after`, only what arrived since that instant. */
export async function listMessages(botId: string, after?: Date): Promise<WebBotMessage[]> {
  const rows = await db
    .select()
    .from(webBotMessages)
    .where(after ? and(eq(webBotMessages.botId, botId), gt(webBotMessages.createdAt, after)) : eq(webBotMessages.botId, botId))
    .orderBy(desc(webBotMessages.createdAt))
    .limit(THREAD_PAGE);
  return rows.reverse();
}

export async function clearThread(botId: string): Promise<void> {
  await db.delete(webBotMessages).where(eq(webBotMessages.botId, botId));
  await db.update(webBots).set({ transcript: [], updatedAt: new Date() }).where(eq(webBots.id, botId));
}

/** Keeps the working context short enough for the request limit and the budget. Oldest turns go first. */
export function trimTranscript(transcript: Transcript, maxBytes = TRANSCRIPT_BYTES, maxMessages = TRANSCRIPT_MESSAGES): Transcript {
  let kept = transcript.slice(-maxMessages);
  const size = () => Buffer.byteLength(JSON.stringify(kept));
  while (kept.length > 2 && size() > maxBytes) kept = kept.slice(1);
  if (size() > maxBytes) kept = kept.map((message) => ({ ...message, content: message.content.slice(0, Math.floor(maxBytes / Math.max(1, kept.length) / 2)) }));
  return kept;
}

export async function saveTranscript(botId: string, transcript: Transcript): Promise<void> {
  await db.update(webBots).set({ transcript: trimTranscript(transcript), updatedAt: new Date() }).where(eq(webBots.id, botId));
}

/** Credits this bot has spent since UTC midnight. */
export async function creditsToday(botId: string, now = Date.now()): Promise<bigint> {
  const start = new Date(now - (now % 86_400_000));
  const [row] = await db
    .select({ total: sum(webBotMessages.creditsMicro) })
    .from(webBotMessages)
    .where(and(eq(webBotMessages.botId, botId), gte(webBotMessages.createdAt, start)));
  return BigInt(row?.total ?? 0);
}

// ── Pending actions ─────────────────────────────────────────────────────────

export async function createAction(input: { botId: string; userId: string; tool: string; args: Record<string, unknown>; title: string; messageId: string }) {
  const [action] = await db
    .insert(webBotActions)
    .values({ ...input, expiresAt: new Date(Date.now() + ACTION_MINUTES * 60_000) })
    .returning();
  return action!;
}

/** Marks a pending action decided. Returns it, "expired", or undefined when it was already handled. */
export async function claimAction(id: string, userId: string, outcome: "confirmed" | "cancelled") {
  const [action] = await db
    .select()
    .from(webBotActions)
    .where(and(eq(webBotActions.id, id), eq(webBotActions.userId, userId)));
  if (!action || action.status !== "pending") return undefined;
  const expired = action.expiresAt.getTime() < Date.now();
  const [claimed] = await db
    .update(webBotActions)
    .set({ status: expired ? "expired" : outcome })
    .where(and(eq(webBotActions.id, id), eq(webBotActions.status, "pending")))
    .returning();
  if (!claimed) return undefined;
  return expired ? ("expired" as const) : claimed;
}
