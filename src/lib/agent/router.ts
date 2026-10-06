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
