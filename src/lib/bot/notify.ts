import { and, eq } from "drizzle-orm";
import { decrypt } from "../crypto";
import { connections, db } from "../db";
import { env } from "../env";
import { addMessage } from "./store";

/**
 * How a bot reaches the user when they are not looking at the thread: the
 * notice always lands in the thread, and goes to Telegram too when the user
 * has a Telegram connection. Nothing here calls a model.
 */

export interface Delivered {
  thread: true;
  telegram: "sent" | "no_connection" | "failed";
}

export interface TelegramChatLink {
  id: string;
  /** "@name" or a first name, as the Connections page shows it. */
  label: string;
  chatId: string;
  token: string;
}

/** Every Telegram chat the user has linked, with the token that reaches each. */
export async function telegramChats(userId: string): Promise<TelegramChatLink[]> {
  const rows = await db
    .select({ id: connections.id, display: connections.display, configEnc: connections.configEnc })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.kind, "telegram")))
    .orderBy(connections.createdAt);
  const out: TelegramChatLink[] = [];
  for (const row of rows) {
    try {
      const config = JSON.parse(decrypt(row.configEnc)) as { chatId?: string; botToken?: string };
      const token = config.botToken ?? env.telegramBotToken;
      if (config.chatId && token) out.push({ id: row.id, label: row.display.chat ?? row.display.chatId ?? "Telegram", chatId: config.chatId, token });
    } catch {
      // An unreadable connection is skipped.
    }
  }
  return out;
}

const handle = (value: string) => value.trim().replace(/^@/, "").toLowerCase();

/**
 * The chat to message: the one whose handle the user named, else the first.
 * Null when the user named an account that is not linked, or has none.
 */
export async function telegramTarget(userId: string, account?: string | null): Promise<{ chatId: string; token: string; label: string } | null> {
  const chats = await telegramChats(userId);
  if (chats.length === 0) return null;
  if (account) {
    const wanted = handle(account);
    const match = chats.find((chat) => handle(chat.label) === wanted);
    return match ?? null;
  }
  return chats[0]!;
}

export async function sendTelegram(target: { chatId: string; token: string }, text: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${target.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: target.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Posts a notice from a bot: an event line and the message in the thread, and the message in Telegram. */
export async function notify(input: { botId: string; userId: string; botName: string; title: string; text: string; kind?: "alert" | "routine" | "notice" }): Promise<Delivered> {
  await addMessage({ botId: input.botId, userId: input.userId, role: "event", kind: "alert", content: input.title, meta: { status: "ok", via: input.kind ?? "alert" } });
  await addMessage({ botId: input.botId, userId: input.userId, role: "bot", kind: "text", content: input.text, meta: { notice: true } });
  const target = await telegramTarget(input.userId);
  if (!target) return { thread: true, telegram: "no_connection" };
  const ok = await sendTelegram(target, `${input.botName}: ${input.text}`);
  return { thread: true, telegram: ok ? "sent" : "failed" };
}
