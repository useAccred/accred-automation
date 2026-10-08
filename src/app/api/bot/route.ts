import { z } from "zod";
import { rateLimited } from "@/lib/auth";
import { readJson, requireApiUser } from "@/lib/bot/http";
import { BOT_COLOR_LIST, BOT_SHAPES, presetById } from "@/lib/bot/presets";
import { addMessage, createBot, ensureStarterBot, listBots } from "@/lib/bot/store";

const MAX_BOTS = 24;

/** The user's bots, newest activity first. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  await ensureStarterBot(user.id);
  return Response.json({ bots: await listBots(user.id) });
}

const CreateSchema = z.object({
  preset: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  role: z.string().trim().max(4000).optional(),
  color: z.enum(BOT_COLOR_LIST).optional(),
  shape: z.enum(BOT_SHAPES).optional(),
});

/** Creates a bot from a preset, or a custom one from a name and a job. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (rateLimited(`bot-create:${user.id}`, 20, 60_000)) return Response.json({ error: "Too many bots created at once. Wait a minute." }, { status: 429 });
  const body = await readJson(request, CreateSchema);
  if (body instanceof Response) return body;
  const existing = await listBots(user.id);
  if (existing.length >= MAX_BOTS) return Response.json({ error: `You can have up to ${MAX_BOTS} bots. Delete one first.` }, { status: 409 });

  const preset = presetById(body.preset);
  const name = body.name ?? preset?.name;
  if (!name) return Response.json({ error: "Give the bot a name." }, { status: 400 });
  const bot = await createBot(user.id, {
    name,
    role: body.role ?? preset?.role ?? "",
    color: body.color ?? preset?.color ?? BOT_COLOR_LIST[existing.length % BOT_COLOR_LIST.length]!,
    shape: body.shape ?? preset?.shape ?? "round",
    preset: preset?.id ?? null,
  });
  if (preset) {
    await addMessage({ botId: bot.id, userId: user.id, role: "bot", kind: "text", content: `hi, i'm your ${preset.name.toLowerCase()}. ${preset.tagline.toLowerCase()} try: "${preset.starter}"` });
  }
  return Response.json({ id: bot.id, bots: await listBots(user.id) }, { status: 201 });
}

