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

/** The user's first Telegram chat, with the token that reaches it. */
export async function telegramTarget(userId: string): Promise<{ chatId: string; token: string } | null> {
  const rows = await db.select({ configEnc: connections.configEnc }).from(connections).where(and(eq(connections.userId, userId), eq(connections.kind, "telegram"))).orderBy(connections.createdAt);
  for (const row of rows) {
    try {
      const config = JSON.parse(decrypt(row.configEnc)) as { chatId?: string; botToken?: string };
      const token = config.botToken ?? env.telegramBotToken;
      if (config.chatId && token) return { chatId: config.chatId, token };
    } catch {
      // An unreadable connection is skipped.
    }
  }
  return null;
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
