import { Accred, type Model } from "accred";
import { env } from "./env";

// Each call reserves and settles credit onchain, so allow more time than the SDK default.
const CALL_TIMEOUT_MS = 120_000;

export function accredFor(apiKey: string): Accred {
  return new Accred({ apiKey, baseUrl: env.accredBaseUrl, timeoutMs: CALL_TIMEOUT_MS });
}

let catalogClient: Accred | undefined;

/** The public model catalog. Cached by the SDK for 60 seconds. */
export function listModels(): Promise<Model[]> {
  catalogClient ??= new Accred({ baseUrl: env.accredBaseUrl });
  return catalogClient.models.list();
}

export type KeyCheck = "valid" | "invalid" | "unavailable";

/**
 * Checks a key without spending credit. The API authenticates before it
 * validates, so an empty body returns 401 for a bad key and 400 for a good one.
 */
export async function checkApiKey(apiKey: string): Promise<KeyCheck> {
  try {
    const response = await fetch(`${env.accredBaseUrl}/api/customer/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-platform-api-key": apiKey,
        "idempotency-key": `keycheck-${crypto.randomUUID()}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 400) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export type BalanceResult = { status: "ok"; exact: string } | { status: "unsupported" } | { status: "unavailable" };

/**
 * The credit this key can spend right now, from `GET /api/customer/v1/balance`.
 * "unsupported" means the API does not offer the endpoint (404), as opposed to a passing failure.
 */
export async function fetchBalance(apiKey: string): Promise<BalanceResult> {
  try {
    const response = await fetch(`${env.accredBaseUrl}/api/customer/v1/balance`, {
      headers: { "x-platform-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (response.status === 404 || response.status === 405) return { status: "unsupported" };
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json()) as { availableCreditsExact?: unknown };
    return typeof body.availableCreditsExact === "string" && /^\d+(\.\d+)?$/.test(body.availableCreditsExact)
      ? { status: "ok", exact: body.availableCreditsExact }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
