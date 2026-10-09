import { z } from "zod";
import { isUuid, readJson, requireApiUser } from "@/lib/bot/http";
import { BOT_COLOR_LIST, BOT_SHAPES } from "@/lib/bot/presets";
import { clearThread, deleteBot, listBots, loadBot, updateBot } from "@/lib/bot/store";
import { MICRO } from "@/lib/credits";

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.string().trim().max(4000).optional(),
  color: z.enum(BOT_COLOR_LIST).optional(),
  shape: z.enum(BOT_SHAPES).optional(),
  modelMode: z.enum(["auto", "economy", "quality", "pinned"]).optional(),
  modelId: z.string().max(120).nullable().optional(),
  /** Credits, as decimals. */
  maxPerMessage: z.number().min(0.05).max(100).optional(),
  maxPerDay: z.number().min(0.5).max(5000).optional(),
  memory: z.string().max(2000).optional(),
  clearThread: z.boolean().optional(),
});

/** Renames a bot, changes its job, look, model or budgets, or clears its thread. */
export async function PATCH(request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!isUuid(id) || !(await loadBot(id, user.id))) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await readJson(request, PatchSchema);
  if (body instanceof Response) return body;
  if (body.modelMode === "pinned" && !body.modelId) return Response.json({ error: "Choose a model to pin." }, { status: 400 });
  const { maxPerMessage, maxPerDay, clearThread: clear, ...rest } = body;
  await updateBot(id, {
    ...rest,
    ...(maxPerMessage !== undefined ? { maxPerMessageMicro: BigInt(Math.round(maxPerMessage * Number(MICRO))) } : {}),
    ...(maxPerDay !== undefined ? { maxPerDayMicro: BigInt(Math.round(maxPerDay * Number(MICRO))) } : {}),
  });
  if (clear) await clearThread(id);
  return Response.json({ bots: await listBots(user.id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!isUuid(id) || !(await deleteBot(id, user.id))) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ bots: await listBots(user.id) });
}

export async function GET(_request: Request, { params }: Params) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const loaded = isUuid(id) ? await loadBot(id, user.id) : undefined;
  if (!loaded) return Response.json({ error: "Not found." }, { status: 404 });
  const { bot } = loaded;
  return Response.json({
    bot: {
      id: bot.id,
      name: bot.name,
      role: bot.role,
      color: bot.color,
      shape: bot.shape,
      preset: bot.preset,
      modelMode: bot.modelMode,
      modelId: bot.modelId,
      maxPerMessage: Number(bot.maxPerMessageMicro) / Number(MICRO),
      maxPerDay: Number(bot.maxPerDayMicro) / Number(MICRO),
      memory: bot.memory,
      createdAt: bot.createdAt.toISOString(),
    },
  });
}
