import { after } from "next/server";
import { z } from "zod";
import { rateLimited } from "@/lib/auth";
import { botTurn } from "@/lib/bot/engine";
import { isUuid, readJson, requireApiUser } from "@/lib/bot/http";
import { BUSY_STALE_MS, addMessage, listMessages, loadBot } from "@/lib/bot/store";
import { microToExact } from "@/lib/credits";
import type { WebBotMessage } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const MESSAGE_CHARS = 8_000;

export interface ThreadMessage {
  id: string;
  role: WebBotMessage["role"];
  kind: WebBotMessage["kind"];
  content: string;
  meta: Record<string, unknown>;
  credits: string;
  at: string;
}

export function toThreadMessage(row: WebBotMessage): ThreadMessage {
  return { id: row.id, role: row.role, kind: row.kind, content: row.content, meta: row.meta, credits: microToExact(row.creditsMicro), at: row.createdAt.toISOString() };
}

/** The thread. `?after=<ISO time>` returns only what arrived since then, for polling. */
export async function GET(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const loaded = isUuid(id) ? await loadBot(id, user.id) : undefined;
  if (!loaded) return Response.json({ error: "Not found." }, { status: 404 });
  const afterParam = new URL(request.url).searchParams.get("after");
  const after = afterParam && !Number.isNaN(Date.parse(afterParam)) ? new Date(afterParam) : undefined;
  const rows = await listMessages(id, after);
  const busy = Boolean(loaded.bot.busySince && Date.now() - loaded.bot.busySince.getTime() < BUSY_STALE_MS);
  return Response.json({ messages: rows.map(toThreadMessage), busy });
}

/** Sends a message to the bot. The reply is produced in the background; poll GET to see it arrive. */
export async function POST(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const loaded = isUuid(id) ? await loadBot(id, user.id) : undefined;
  if (!loaded) return Response.json({ error: "Not found." }, { status: 404 });
  if (rateLimited(`bot-msg:${user.id}`, 30, 60_000)) return Response.json({ error: "Too many messages at once. Wait a minute." }, { status: 429 });
  const body = await readJson(request, z.object({ text: z.string().trim().min(1).max(MESSAGE_CHARS) }));
  if (body instanceof Response) return body;
  const message = await addMessage({ botId: id, userId: user.id, role: "user", kind: "text", content: body.text });
  after(() => botTurn(id, user.id, body.text));
  return Response.json({ message: toThreadMessage(message) }, { status: 202 });
}
