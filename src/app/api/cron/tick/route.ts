import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { tick } from "@/lib/scheduler";
import { monitorTick, tradingTick } from "@/lib/trading/monitor";

// Lets an external cron drive the scheduler when SCHEDULER=off. Call it every minute.
async function handle(request: Request) {
  const secret = env.cronSecret;
  const supplied = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = Buffer.from(secret ?? "");
  const given = Buffer.from(supplied);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  // The position monitor runs first, so protective exits never wait on new cycles.
  const monitor = await monitorTick();
  const [automations, trading] = await Promise.all([tick(), tradingTick()]);
  return Response.json({ ...automations, trading: trading.started, positionsWatched: monitor.positions });
}

export const GET = handle;
export const POST = handle;
