// A stand-in for the Accred API, for developing without spending credit.
//
//   node scripts/mock-accred.mjs          # listens on :4010
//   ACCRED_BASE_URL=http://localhost:4010 pnpm dev
//
// Sign in with the key printed at startup. The "model" follows a fixed script:
// read a feed, save a note, use a write tool if one is linked, then finish.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const KEY = "ct_live_mock_key_for_local_development_only";
let balanceMicro = 500_000_000n;

const model = (id, name, input, output) => ({
  provider: "mock",
  id,
  name,
  inputCostUsdPerMillion: input,
  outputCostUsdPerMillion: output,
  cachedInputCostUsdPerMillion: null,
  cacheWrite5mCostUsdPerMillion: null,
  cacheWrite1hCostUsdPerMillion: null,
  cacheReadCostUsdPerMillion: null,
  capabilities: ["text-generation"],
  available: true,
  unavailableReason: null,
  maxInputTokens: 400000,
  maxOutputTokens: 8192,
  pricingSource: "mock",
  pricingVerifiedAt: null,
  pricingExpiresAt: null,
  pricingType: "configured",
});
const MODELS = [
  model("claude-sonnet-5", "Claude Sonnet 5", "2", "10"),
  model("claude-haiku-4-5", "Claude Haiku 4.5", "1", "5"),
  model("claude-opus-5", "Claude Opus 5", "5", "25"),
];

const exact = (micro) => {
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};

function scriptedReply(messages) {
  const system = messages[0]?.content ?? "";
  if (system.startsWith("You condense")) {
    return "Top stories from the feed (mock summary):\n1. First story — https://example.com/1\n2. Second story — https://example.com/2\n3. Third story — https://example.com/3";
  }
  const results = messages.filter((message) => message.role === "user" && message.content.startsWith("<tool_result"));
  const last = results.at(-1)?.content ?? "";
  const writeTool = ["telegram.send_message", "slack.post_message", "discord.post_message"].find((name) => system.includes(`- ${name}:`));
  const has = (name) => system.includes(`- ${name}:`);

  if (last.includes('status="rejected"')) {
    return JSON.stringify({ thought: "The user declined, so I stop here.", final: "I read the feed and saved a note, but the message was not sent because you declined it." });
  }
  if (results.length === 0) {
    return JSON.stringify({ thought: "Start by reading the feed.", tool: "web.fetch", args: { url: "https://hnrss.org/frontpage" } });
  }
  if (results.length === 1) {
    return `Here is my next step:\n${JSON.stringify({ thought: "Remember what I saw.", tool: "memory.save", args: { text: `Last checked ${new Date().toISOString()}` } })}`;
  }
  if (results.length === 2 && writeTool) {
    return JSON.stringify({ thought: "Send the summary.", tool: writeTool, args: { text: "Mock briefing:\n1. First story\n2. Second story\n3. Third story" } });
  }
  if (results.length === 2 && has("http.request")) {
    return JSON.stringify({ thought: "Post the summary to the API.", tool: "http.request", args: { method: "POST", path: "/post", body: { summary: "Mock briefing with three stories" } } });
  }
  return JSON.stringify({ thought: "Everything is done.", final: "Read the feed, saved a note for next time, and delivered a three-story summary." });
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/customer/models") return send(response, 200, { models: MODELS });
  if (request.method === "GET" && url.pathname === "/api/customer/v1/balance") {
    // MOCK_NO_BALANCE=1 imitates an API without this endpoint.
    if (process.env.MOCK_NO_BALANCE) return send(response, 404, { error: "Not found." });
    if (request.headers["x-platform-api-key"] !== KEY) return send(response, 401, { error: "The platform API key is invalid or revoked." });
    return send(response, 200, { availableCredits: Number(balanceMicro) / 1e6, availableCreditsExact: exact(balanceMicro), creditUnit: "service_credit" });
  }
  if (request.method !== "POST" || url.pathname !== "/api/customer/v1/chat/completions") return send(response, 404, { error: "Not found." });
  if (request.headers["x-platform-api-key"] !== KEY) return send(response, 401, { error: "The platform API key is invalid or revoked." });

  let raw = "";
  for await (const chunk of request) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const entry = MODELS.find((candidate) => candidate.id === body?.model);
  if (!entry || !Array.isArray(body.messages) || body.messages.length === 0 || !request.headers["idempotency-key"]) {
    return send(response, 400, { error: "Valid request body and Idempotency-Key header are required." });
  }

  const content = scriptedReply(body.messages);
  const inputTokens = Math.ceil(JSON.stringify(body.messages).length / 4);
  const outputTokens = Math.ceil(content.length / 4);
  // Microcredits: tokens × USD per million × 100 credits per USD.
  const charged = BigInt(Math.ceil(inputTokens * Number(entry.inputCostUsdPerMillion) * 100 + outputTokens * Number(entry.outputCostUsdPerMillion) * 100));
  if (charged > balanceMicro) return send(response, 402, { error: "Insufficient available credit." });
  balanceMicro -= charged;
  await new Promise((resolve) => setTimeout(resolve, 900));
  send(response, 200, {
    id: `mock-${Date.now()}`,
    model: entry.id,
    content,
    usage: { inputTokens, outputTokens },
    creditsCharged: Number(charged) / 1e6,
    creditsChargedExact: exact(charged),
    providerCostUsdExact: exact(charged / 100n),
    creditUnit: "service_credit",
    cashbackUsdExact: null,
    remainingCredits: Number(balanceMicro) / 1e6,
    remainingCreditsExact: exact(balanceMicro),
  });
}).listen(PORT, () => {
  console.log(`Mock Accred API on http://localhost:${PORT}`);
  console.log(`Sign in with: ${KEY}`);
});
