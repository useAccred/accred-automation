import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { decrypt, encrypt, randomToken } from "./crypto";
import { connections, db, telegramLinks } from "./db";
import { env } from "./env";

/**
 * Telegram linking. A user links a chat by opening a one-time
 * `t.me/<bot>?start=<code>` link and pressing Start; the bot receives the code
 * together with the chat, so nobody has to look up a chat ID.
 *
 * Two kinds of bot work this way:
 * - the shared bot, whose token is the server's TELEGRAM_BOT_TOKEN, and
 * - a user's own bot, whose token is stored encrypted with that user's connection.
 */

const API = "https://api.telegram.org";
const LINK_MINUTES = 15;
const TOKEN_FORMAT = /^\d{6,}:[\w-]{30,}$/;

export function sharedBotConfigured(): boolean {
  return Boolean(env.telegramBotToken);
}

async function callBot<T>(token: string, method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!payload.ok) throw Object.assign(new Error(payload.description ?? `Telegram ${method} failed`), { status: response.status });
  return payload.result as T;
}

const call = <T>(method: string, body: Record<string, unknown>, timeoutMs?: number) =>
  callBot<T>(env.telegramBotToken ?? "", method, body, timeoutMs);

let botUsername: string | undefined;

export async function getBotUsername(): Promise<string> {
  botUsername ??= (await call<{ username: string }>("getMe", {})).username;
  return botUsername;
}

async function newLinkCode(userId: string, botTokenEnc: string | null): Promise<string> {
  await db.delete(telegramLinks).where(lt(telegramLinks.expiresAt, new Date()));
  const code = randomToken(18);
  await db.insert(telegramLinks).values({ code, userId, botTokenEnc, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
  return code;
}

/** Creates a one-time link to the shared bot. */
export async function createTelegramLink(userId: string): Promise<string> {
  return `https://t.me/${await getBotUsername()}?start=${await newLinkCode(userId, null)}`;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: TelegramChat };
}

function chatLabel(chat: TelegramChat): string {
  if (chat.type !== "private") return chat.title ?? "Group chat";
  return chat.username ? `@${chat.username}` : (chat.first_name ?? "Private chat");
}

/** Reads the code from a "/start <code>" message. */
function startCode(update: TelegramUpdate): string | undefined | null {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(update.message?.text ?? "");
  return match ? (match[1] ?? null) : undefined;
}

/**
 * Saves a chat as a Telegram connection. `botToken` is set only for a user's
 * own bot; shared-bot connections keep no token and use the server's.
 */
async function saveChat(userId: string, chat: TelegramChat, bot: string, botToken?: string): Promise<"created" | "exists"> {
  const chatId = String(chat.id);
  const label = chatLabel(chat);
  const existing = await db
    .select({ display: connections.display })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.kind, "telegram")));
  if (existing.some((row) => row.display.chatId === chatId && (row.display.bot ?? `@${bot}`) === `@${bot}`)) return "exists";
  await db.insert(connections).values({
    userId,
    kind: "telegram",
    name: label,
    configEnc: encrypt(JSON.stringify(botToken ? { chatId, botToken } : { chatId })),
    display: { chat: label, chatId, bot: `@${bot}`, ...(botToken ? { owner: "Your own bot" } : {}) },
  });
  return "created";
}

// ── Shared bot ──────────────────────────────────────────────────────────────

async function reply(chatId: number, text: string): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).catch(() => {});
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const code = startCode(update);
  if (!message || code === undefined) return;
  if (code === null) {
    await reply(message.chat.id, `To link this chat, open ${env.appUrl}/app/connections and press Connect on the Telegram card.`);
    return;
  }

  // Codes made for a user's own bot carry a token and are not valid here.
  const [link] = await db
    .delete(telegramLinks)
    .where(and(eq(telegramLinks.code, code), gt(telegramLinks.expiresAt, new Date()), isNull(telegramLinks.botTokenEnc)))
    .returning();
  if (!link) {
    await reply(message.chat.id, "That link has expired or was already used. Press Connect again to get a new one.");
    return;
  }
  const outcome = await saveChat(link.userId, message.chat, await getBotUsername());
  await reply(
    message.chat.id,
    outcome === "exists"
      ? "This chat is already connected to Accred Automation."
      : "Connected. Your automations can now send messages to this chat.",
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const globalForTelegram = globalThis as unknown as { __accredTelegramPolling?: boolean };

/** Receives shared-bot messages by long polling, which works on any long-running server, including localhost. */
export function startTelegramPolling(): void {
  if (!sharedBotConfigured() || globalForTelegram.__accredTelegramPolling) return;
  globalForTelegram.__accredTelegramPolling = true;
  void (async () => {
    getBotUsername()
      .then((username) => console.log(`[telegram] Listening for messages to @${username}`))
      .catch(() => {});
    let offset: number | undefined;
    for (;;) {
      try {
        const updates = await call<TelegramUpdate[]>("getUpdates", { timeout: 25, offset, allowed_updates: ["message"] }, 40_000);
        for (const update of updates) {
          offset = update.update_id + 1;
          await handleTelegramUpdate(update).catch((error) => console.error("[telegram]", error));
        }
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 404) {
          console.error("[telegram] The bot token was rejected. Telegram linking is off until it is fixed.");
          return;
        }
        // 409 means another process is polling the same bot, or a webhook is set. Back off and retry.
        await sleep(status === 409 ? 15_000 : 5_000);
      }
    }
  })();
}

// ── A user's own bot ────────────────────────────────────────────────────────

/** A problem with the user's bot that they can fix; the message is shown to them. */
export class OwnBotError extends Error {}

const BUSY_BOT =
  "This bot is already used by another app, so its messages cannot be read here. Create a separate bot with @BotFather for Accred Automation.";

/** Checks a user's bot token and returns a one-time link to that bot. */
export async function createOwnBotLink(userId: string, token: string): Promise<{ url: string; code: string; bot: string }> {
  if (!TOKEN_FORMAT.test(token)) throw new OwnBotError("That does not look like a bot token. Copy it again from @BotFather.");
  if (token === env.telegramBotToken) throw new OwnBotError("That is the Accred bot. Use the Accred bot option instead.");
  let bot: string;
  try {
    bot = (await callBot<{ username: string }>(token, "getMe", {})).username;
    const webhook = await callBot<{ url: string }>(token, "getWebhookInfo", {});
    if (webhook.url) throw new OwnBotError(BUSY_BOT);
  } catch (error) {
    if (error instanceof OwnBotError) throw error;
    const status = (error as { status?: number }).status;
    throw new OwnBotError(
      status === 401 || status === 404 ? "Telegram did not accept that bot token." : "Telegram could not be reached. Try again in a moment.",
    );
  }
  const code = await newLinkCode(userId, encrypt(token));
  return { url: `https://t.me/${bot}?start=${code}`, code, bot };
}

export type OwnBotLinkStatus = "waiting" | "linked" | "expired" | "busy";

/**
 * Looks in the user's bot for the Start message carrying their code. Called
 * repeatedly while the user is on the page; nothing listens to their bot otherwise.
 */
export async function checkOwnBotLink(userId: string, code: string): Promise<OwnBotLinkStatus> {
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(and(eq(telegramLinks.code, code), eq(telegramLinks.userId, userId), gt(telegramLinks.expiresAt, new Date())));
  if (!link?.botTokenEnc) return "expired";
  const token = decrypt(link.botTokenEnc);

  let updates: TelegramUpdate[];
  try {
    updates = await callBot<TelegramUpdate[]>(token, "getUpdates", { timeout: 0, limit: 100, allowed_updates: ["message"] });
  } catch (error) {
    return (error as { status?: number }).status === 409 ? "busy" : "waiting";
  }
  const match = updates.find((update) => startCode(update) === code);
  if (!match?.message) return "waiting";

  // Claim the code first, so two overlapping checks cannot both create the connection.
  const claimed = await db.delete(telegramLinks).where(eq(telegramLinks.code, code)).returning({ code: telegramLinks.code });
  if (claimed.length === 0) return "linked";
  const { username } = await callBot<{ username: string }>(token, "getMe", {});
  await saveChat(userId, match.message.chat, username, token);
  // Mark the messages as read, then confirm in the chat. Neither failing should undo the link.
  await callBot(token, "getUpdates", { timeout: 0, offset: updates[updates.length - 1]!.update_id + 1 }).catch(() => {});
  await callBot(token, "sendMessage", {
    chat_id: match.message.chat.id,
    text: "Connected. Your automations can now send messages to this chat through this bot.",
  }).catch(() => {});
  return "linked";
}
