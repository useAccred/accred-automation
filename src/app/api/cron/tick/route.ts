import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { tick } from "@/lib/scheduler";

// Lets an external cron drive the scheduler when SCHEDULER=off. Call it every minute.
async function handle(request: Request) {
  const secret = env.cronSecret;
  const supplied = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = Buffer.from(secret ?? "");
  const given = Buffer.from(supplied);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return Response.json(await tick());
}

export const GET = handle;
export const POST = handle;
