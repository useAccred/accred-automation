/** Model-choice modes. Kept free of server imports so the form can use it in the browser. */
export type ModelMode = "auto" | "economy" | "quality" | "pinned";

export const MODEL_MODES: Record<ModelMode, { label: string; blurb: string }> = {
  auto: { label: "Auto", blurb: "A strong model decides each step. A fast, cheap one reads long pages." },
  economy: { label: "Economy", blurb: "A fast, cheap model does everything. Best for simple jobs that run often." },
  quality: { label: "Best quality", blurb: "A top model decides each step. Costs several times more per run." },
  pinned: { label: "Choose models", blurb: "Pick the brain model yourself, and optionally a cheaper one for reading." },
};
