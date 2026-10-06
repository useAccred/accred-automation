import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit } from "undici";

/**
 * Outbound HTTP for tools. URLs come from users and from model output, so
 * requests must never reach this server's own network: private, loopback and
 * link-local addresses are refused, both as literals and after DNS resolution.
 */

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return blocked.check(mapped, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return blocked.check(address, "ipv4");
}

export class FetchBlockedError extends Error {}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;

// Runs at connection time, so the address that was checked is the address that is dialled.
function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, options, (error, address, family) => {
    if (error) return callback(error, address, family);
    const entries = Array.isArray(address) ? address : [{ address }];
    for (const entry of entries as Array<{ address: string }>) {
      if (isBlockedAddress(entry.address)) {
        return callback(new FetchBlockedError(`${hostname} resolves to a private address`), address, family);
      }
    }
    callback(null, address, family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never },
  headersTimeout: 20_000,
  bodyTimeout: 20_000,
});

function assertPublicUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchBlockedError("Only http and https URLs are allowed");
  }
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && isBlockedAddress(host)) throw new FetchBlockedError("That address is not reachable from here");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FetchBlockedError("That address is not reachable from here");
  }
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  truncated: boolean;
}

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 1_500_000;

export async function safeFetch(
  input: string,
  init: Pick<RequestInit, "method" | "headers" | "body"> = {},
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<SafeResponse> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchBlockedError("That is not a valid URL");
  }
  const method = (init.method ?? "GET").toUpperCase();

  for (let hop = 0; ; hop++) {
    assertPublicUrl(url);
    let response;
    try {
      response = await undiciFetch(url, {
        ...init,
        method,
        redirect: "manual",
        dispatcher: agent,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      // undici wraps the real reason (DNS failure, refused connection, blocked address) in `cause`.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      if (cause instanceof FetchBlockedError) throw cause;
      const reason = !(cause instanceof Error) ? "network error" : cause.name === "TimeoutError" ? "timed out" : cause.message;
      throw new Error(`Request to ${url.host} failed: ${reason}`);
    }

    const location = response.headers.get("location");
    // Only safe requests follow redirects; a redirected write could land somewhere unintended.
    if (response.status >= 300 && response.status < 400 && location && method === "GET") {
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = new URL(location, url);
      continue;
    }

    const { text, truncated } = await readCapped(response.body, maxBytes);
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") ?? "",
      text,
      truncated,
    };
  }
}

async function readCapped(
  body: AsyncIterable<Uint8Array> | null,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of body) {
    if (size + chunk.byteLength > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - size));
      truncated = true;
      break;
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}
