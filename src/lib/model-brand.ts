/** Who makes a model, for showing its logo. Kept free of server imports so the form can use it in the browser. */
export interface ModelBrand {
  /** The logo is served from /brand/models/<key>.svg. */
  key: string;
  label: string;
}

const BRANDS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  meta: "Meta",
  mistral: "Mistral",
  qwen: "Qwen",
  moonshot: "Moonshot AI",
  zai: "Z.ai",
  minimax: "MiniMax",
  perplexity: "Perplexity",
  cohere: "Cohere",
  amazon: "Amazon",
  nvidia: "NVIDIA",
  microsoft: "Microsoft",
  bytedance: "ByteDance",
  tencent: "Tencent",
  xiaomi: "Xiaomi",
  baidu: "Baidu",
  ibm: "IBM",
  sakana: "Sakana AI",
  aionlabs: "AionLabs",
  nousresearch: "Nous Research",
  upstage: "Upstage",
  stepfun: "StepFun",
  inception: "Inception",
};

// Maker prefixes in catalog ids ("x-ai/grok-4.7") that are spelled differently from the logo's key.
const PREFIX_ALIASES: Record<string, string> = {
  "x-ai": "xai",
  "meta-llama": "meta",
  mistralai: "mistral",
  moonshotai: "moonshot",
  "z-ai": "zai",
  "bytedance-seed": "bytedance",
  "ibm-granite": "ibm",
  "aion-labs": "aionlabs",
};

// Ids with no maker prefix ("claude-sonnet-5"), recognised by the model family's name.
const FAMILIES: Array<[RegExp, string]> = [
  [/^claude/, "anthropic"],
  [/^(gpt|chatgpt|o\d)/, "openai"],
  [/^gemini/, "google"],
  [/^grok/, "xai"],
  [/^deepseek/, "deepseek"],
  [/^llama/, "meta"],
  [/^mistral/, "mistral"],
  [/^qwen/, "qwen"],
  [/^kimi/, "moonshot"],
  [/^glm/, "zai"],
];

/** The maker of a model, or null when there is no logo for it. */
export function modelBrand(modelId: string): ModelBrand | null {
  const id = modelId.trim().toLowerCase();
  const slash = id.indexOf("/");
  const prefix = slash > 0 ? id.slice(0, slash) : "";
  const key = prefix ? (PREFIX_ALIASES[prefix] ?? prefix) : FAMILIES.find(([pattern]) => pattern.test(id))?.[1];
  return key && key in BRANDS ? { key, label: BRANDS[key] } : null;
}
