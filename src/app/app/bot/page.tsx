import type { Metadata } from "next";
import { BotWorkspace } from "@/components/bot/workspace";
import { requireUser } from "@/lib/auth";
import { ensureStarterBot, listBots } from "@/lib/bot/store";
import { formCatalog } from "@/lib/queries";

export const metadata: Metadata = { title: "Bot" };
export const dynamic = "force-dynamic";

export default async function BotPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const user = await requireUser();
  const { preset } = await searchParams;
  await ensureStarterBot(user.id);
  const [bots, catalog] = await Promise.all([listBots(user.id), formCatalog()]);
  const models = (catalog.featured.length ? catalog.featured : catalog.models).map((model) => ({ id: model.id, name: model.name }));
  const person = { initials: `A${user.keyHint.slice(-1).toUpperCase()}`, name: `Accred · key …${user.keyHint}` };
  return <BotWorkspace initialBots={bots} person={person} models={models} createPreset={preset ?? null} />;
}
