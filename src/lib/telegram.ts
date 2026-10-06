import { and, eq, gt, lt } from "drizzle-orm";
import { encrypt, randomToken } from "./crypto";
import { connections, db, telegramLinks } from "./db";
import { env } from "./env";

/**
 * The shared Telegram bot. A user links a chat by opening a one-time
 * `t.me/<bot>?start=<code>` link and pressing Start; the bot receives the code
 * together with the chat, so nobody has to look up a chat ID.
 */

const API = "https://api.telegram.org";
const LINK_MINUTES = 15;

export function sharedBotConfigured(): boolean {
  return Boolean(env.telegramBotToken);
}

async function call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(`${API}/bot${env.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!payload.ok) throw Object.assign(new Error(payload.description ?? `Telegram ${method} failed`), { status: response.status });
  return payload.result as T;
}

let botUsername: string | undefined;

export async function getBotUsername(): Promise<string> {
  botUsername ??= (await call<{ username: string }>("getMe", {})).username;
  return botUsername;
}

/** Creates a one-time link for the user to open in Telegram. */
export async function createTelegramLink(userId: string): Promise<string> {
  await db.delete(telegramLinks).where(lt(telegramLinks.expiresAt, new Date()));
  const code = randomToken(18);
  await db.insert(telegramLinks).values({ code, userId, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
  return `https://t.me/${await getBotUsername()}?start=${code}`;
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

async function reply(chatId: number, text: string): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).catch(() => {});
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(message?.text ?? "");
  if (!message || !start) return;
  const code = start[1];
  if (!code) {
    await reply(message.chat.id, `To link this chat, open ${env.appUrl}/app/connections and press Connect Telegram.`);
    return;
  }

  const [link] = await db
    .delete(telegramLinks)
    .where(and(eq(telegramLinks.code, code), gt(telegramLinks.expiresAt, new Date())))
    .returning();
  if (!link) {
    await reply(message.chat.id, "That link has expired or was already used. Press Connect Telegram again to get a new one.");
    return;
  }

  const chatId = String(message.chat.id);
  const label = chatLabel(message.chat);
  const existing = await db
    .select({ id: connections.id, display: connections.display })
    .from(connections)
    .where(and(eq(connections.userId, link.userId), eq(connections.kind, "telegram")));
  if (existing.some((row) => row.display.chatId === chatId)) {
    await reply(message.chat.id, "This chat is already connected to Accred Automation.");
    return;
  }
  await db.insert(connections).values({
    userId: link.userId,
    kind: "telegram",
    name: label,
    configEnc: encrypt(JSON.stringify({ chatId })),
    display: { chat: label, chatId },
  });
  await reply(message.chat.id, "Connected. Your automations can now send messages to this chat.");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const globalForTelegram = globalThis as unknown as { __accredTelegramPolling?: boolean };

/** Receives bot messages by long polling, which works on any long-running server, including localhost. */
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
