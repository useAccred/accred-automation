import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { createRun, executeRun } from "@/lib/agent/runner";
import { rateLimited } from "@/lib/auth";
import { automations, db } from "@/lib/db";

const MAX_BODY_BYTES = 64_000;

/** Starts a run of the webhook-triggered automation that owns this token. The body becomes the trigger payload. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 16 || token.length > 128) return Response.json({ error: "Not found." }, { status: 404 });
  if (rateLimited(`hook:${token}`, 30, 60_000)) {
    return Response.json({ error: "Too many requests for this webhook. Limit: 30 per minute." }, { status: 429 });
  }

  const [automation] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.webhookToken, token), eq(automations.triggerType, "webhook")));
  if (!automation) return Response.json({ error: "Not found." }, { status: 404 });
  if (!automation.enabled) return Response.json({ error: "This automation is paused." }, { status: 409 });

  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return Response.json({ error: "Payload too large. Limit: 64 KB." }, { status: 413 });

  const run = await createRun(automation, "webhook", body);
  if (!run.runnable) {
    return Response.json({ error: "This automation has reached its monthly credit cap.", runId: run.id }, { status: 429 });
  }
  after(() => executeRun(run.id));
  await db.update(automations).set({ lastRunAt: new Date() }).where(eq(automations.id, automation.id));
  return Response.json({ runId: run.id, status: "queued" }, { status: 202 });
}
