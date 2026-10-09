import { z } from "zod";
import { decideAction } from "@/lib/bot/engine";
import { isUuid, readJson, requireApiUser } from "@/lib/bot/http";

/** Confirms or cancels a write tool the bot asked for. The click is the only thing that runs it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await readJson(request, z.object({ decision: z.enum(["confirm", "cancel"]) }));
  if (body instanceof Response) return body;
  const outcome = await decideAction(id, user.id, body.decision === "confirm");
  if (outcome === "gone") return Response.json({ error: "That request was already handled." }, { status: 409 });
  if (outcome === "expired") return Response.json({ error: "That request expired. Ask the bot again." }, { status: 410 });
  return Response.json({ outcome });
}
