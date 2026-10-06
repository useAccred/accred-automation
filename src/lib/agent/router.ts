import { estimateCost, type Model } from "accred";
import { toMicro } from "../credits";
import { env } from "../env";
import type { ModelMode } from "./modes";

export type { ModelMode } from "./modes";

type Tier = "smart" | "fast" | "top";

export interface Routing {
  /** Decides each next action. */
  planner: Model;
  /** Condenses long tool output before the planner sees it. */
  reader: Model;
}

// Variants that are not plain synchronous chat models.
const EXCLUDED = /(:batch|:free|image|audio|embed|vision-exp|guard|moderation|tts|whisper)/i;

export function usableTextModels(models: Model[]): Model[] {
  return models.filter(
    (model) =>
      model.available &&
      model.capabilities.includes("text-generation") &&
      model.inputCostUsdPerMillion !== null &&
      model.outputCostUsdPerMillion !== null &&
      !model.id.startsWith("~") &&
      !EXCLUDED.test(model.id),
  );
}

/**
 * Known-good picks per tier, tried in order. The catalog changes, so when none
 * match, the tier falls back to the model priced closest to the tier's target.
 */
const TIERS: Record<Tier, { prefer: RegExp[]; targetOutputUsd: number; band: [number, number] }> = {
  smart: {
    prefer: [/^claude-sonnet-5$/, /claude-sonnet-5(\.\d+)?$/, /gpt-5\.\d+-terra$/, /gemini-3\.\d+-pro/, /claude-sonnet-4/],
    targetOutputUsd: 10,
    band: [5, 16],
  },
  fast: {
    prefer: [/^claude-haiku-4-5$/, /claude-haiku/, /gpt-5\.\d+-luna$/, /gemini-3\.\d+-flash$/, /gemini-3\.\d+-flash-lite$/],
    targetOutputUsd: 3,
    band: [0.4, 5],
  },
  top: {
    prefer: [/^claude-opus-5$/, /claude-opus-5(\.\d+)?$/, /claude-opus-4/, /gpt-5\.\d+-sol$/],
    targetOutputUsd: 25,
    band: [16, 60],
  },
};

function pickTier(models: Model[], tier: Tier): Model {
  const override = env.routerOverride(tier);
  const pinned = override ? models.find((model) => model.id === override) : undefined;
  if (pinned) return pinned;

  const { prefer, targetOutputUsd, band } = TIERS[tier];
  for (const pattern of prefer) {
    const match = models.find((model) => pattern.test(model.id));
    if (match) return match;
  }
  const price = (model: Model) => Number(model.outputCostUsdPerMillion);
  const inBand = models.filter((model) => price(model) >= band[0] && price(model) <= band[1]);
  const pool = inBand.length > 0 ? inBand : models;
  return pool.reduce((best, model) =>
    Math.abs(price(model) - targetOutputUsd) < Math.abs(price(best) - targetOutputUsd) ? model : best,
  );
}

export class RoutingError extends Error {}

export function pickRouting(
  catalog: Model[],
  mode: ModelMode,
  pinnedId?: string | null,
  readerId?: string | null,
): Routing {
  const models = usableTextModels(catalog);
  if (models.length === 0) throw new RoutingError("No text models are available in the Accred catalog right now.");

  if (mode === "pinned") {
    const model = models.find((candidate) => candidate.id === pinnedId);
    if (!model) throw new RoutingError(`The chosen model "${pinnedId}" is not available right now.`);
    // A reader that has left the catalog falls back to the brain model, so the run still works.
    return { planner: model, reader: models.find((candidate) => candidate.id === readerId) ?? model };
  }
  if (mode === "economy") {
    const fast = pickTier(models, "fast");
    return { planner: fast, reader: fast };
  }
  if (mode === "quality") return { planner: pickTier(models, "top"), reader: pickTier(models, "smart") };
  return { planner: pickTier(models, "smart"), reader: pickTier(models, "fast") };
}

/** The current pick for each tier, offered as one-click suggestions when choosing models by hand. */
export function suggestedModels(catalog: Model[]): Record<Tier, Model> {
  const models = usableTextModels(catalog);
  if (models.length === 0) throw new RoutingError("No text models are available in the Accred catalog right now.");
  return { smart: pickTier(models, "smart"), fast: pickTier(models, "fast"), top: pickTier(models, "top") };
}

/**
 * Flagship models from the best-known makers, offered as one-click picks. Each
 * entry lists patterns tried in order, because versions come and go; an entry
 * with no match is left out.
 */
const FEATURED: RegExp[][] = [
  [/claude-fable-5\.1$/, /claude-fable-5/],
  [/claude-opus-5\.5$/, /^claude-opus-5$/, /claude-opus-5/, /claude-opus-4/],
  [/claude-sonnet-5\.5$/, /^claude-sonnet-5$/, /claude-sonnet-5/, /claude-sonnet-4/],
  [/^claude-haiku-4-5$/, /claude-haiku/],
  [/^gpt-6-astra$/, /gpt-[\d.]+-astra$/],
  [/^gpt-6\.1-sol$/, /^gpt-[\d.]+-sol$/, /gpt-[\d.]+-sol$/],
  [/^gpt-6-luna$/, /^gpt-[\d.]+-luna$/, /gpt-[\d.]+-luna$/],
  [/^gemini-3\.\d+-pro/, /gemini-[\d.]+-pro/],
  [/gemini-3\.8-flash$/, /gemini-3\.\d+-flash$/],
  [/grok-4\.7$/, /grok-4\.\d+$/, /grok-[\d.]+$/],
  [/deepseek-v4(\.\d+)?-pro/, /deepseek-v[\d.]+/],
  [/kimi-k3$/, /kimi-k[\d.]+$/],
  [/qwen3-max$/, /qwen[\d.]*-max$/],
  [/glm-5\.3$/, /glm-5(\.\d+)?$/],
  [/mistral-large-4/, /mistral-large/],
  [/minimax-m3$/, /minimax-m[\d.]+$/],
  [/llama-4-maverick/, /llama-4/],
];

export function featuredModels(catalog: Model[]): Model[] {
  const models = usableTextModels(catalog);
  const picks: Model[] = [];
  for (const prefer of FEATURED) {
    for (const pattern of prefer) {
      const match = models.find((model) => pattern.test(model.id));
      if (!match) continue;
      if (!picks.includes(match)) picks.push(match);
      break;
    }
  }
  return picks;
}

/**
 * A name fit to show. Models listed by a provider directly are named by their
 * id, so this borrows the name of the same model listed under its maker's
 * prefix ("claude-haiku-4-5" reads as "Claude Haiku 4.5").
 */
export function displayName(model: Model, catalog: Model[]): string {
  const withoutMaker = (name: string) => name.replace(/^[^:]{1,30}:\s+/, "");
  if (model.name !== model.id) return withoutMaker(model.name);
  const key = (id: string) => id.slice(id.lastIndexOf("/") + 1).replace(/[._-]/g, "").toLowerCase();
  const twin = catalog.find((other) => other.name !== other.id && key(other.id) === key(model.id));
  return twin ? withoutMaker(twin.name) : model.id;
}

/** Rough token count for text of mixed prose, JSON and URLs. Errs high so cost checks stay safe. */
export function approxTokens(characters: number): number {
  return Math.ceil(characters / 3) + 16;
}

/** Worst-case cost of one call in microcredits: the amount Accred holds up front. */
export function worstCaseMicro(model: Model, inputCharacters: number, maxOutputTokens: number): bigint {
  const { credits } = estimateCost(model, {
    inputTokens: approxTokens(inputCharacters),
    outputTokens: maxOutputTokens,
  });
  return toMicro(credits);
}
