import { htmlToText } from "../agent/extract";
import { sha256 } from "../crypto";
import { env } from "../env";

/**
 * Gmail through Google OAuth. The connection is read-only: it asks for the
 * `gmail.readonly` scope and offers search and read, nothing that sends or changes mail.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function googleConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function googleRedirectUri(): string {
  return `${env.appUrl}/api/oauth/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    // "offline" with a forced consent screen is what makes Google return a refresh token.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Thrown when Google no longer honours the stored grant and the user has to connect again. */
export class GmailAccessError extends Error {}

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId ?? "", client_secret: env.googleClientSecret ?? "", ...fields }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      throw new GmailAccessError("Gmail access has expired or was removed. Connect Gmail again under Connections.");
    }
    throw new Error(`Google sign-in failed${body.error ? `: ${body.error}` : ""}.`);
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

export async function exchangeGoogleCode(code: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
}

// Access tokens last about an hour; keep them in memory, keyed by a hash of the refresh token.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(refreshToken: string): Promise<string> {
  const key = sha256(refreshToken);
  const cached = accessTokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const fresh = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  accessTokens.set(key, { token: fresh.access_token, expiresAt: Date.now() + (fresh.expires_in ?? 3000) * 1000 });
  return fresh.access_token;
}

async function gmailGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new GmailAccessError("Gmail refused the request. Connect Gmail again under Connections.");
  }
  if (!response.ok) throw new Error(`Gmail returned ${response.status}.`);
  return (await response.json()) as T;
}

export async function gmailAddress(token: string): Promise<string> {
  return (await gmailGet<{ emailAddress: string }>(token, "/profile")).emailAddress;
}

/** Tells Google to forget the grant. Best effort: the connection is removed either way. */
export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  accessTokens.delete(sha256(refreshToken));
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  // A part with a filename is an attachment, not the message text.
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const match = findPart(child, mimeType);
    if (match) return match;
  }
  return undefined;
}

const decode = (part: GmailPart) => Buffer.from(part.body?.data ?? "", "base64url").toString("utf8");

/** The readable body of a message: the plain-text part when there is one, otherwise the HTML as text. */
export function messageText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain) return decode(plain).trim();
  const html = findPart(payload, "text/html");
  return html ? htmlToText(decode(html)) : "";
}

export async function searchGmail(refreshToken: string, query: string, max: number): Promise<string> {
  const token = await accessToken(refreshToken);
  const list = await gmailGet<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(
    token,
    `/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
  );
  const ids = (list.messages ?? []).map((message) => message.id);
  if (ids.length === 0) return "No emails match.";
  const messages = await Promise.all(
    ids.map((id) =>
      gmailGet<GmailMessage>(token, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`),
    ),
  );
  const lines = messages.map((message, index) =>
    [
      `${index + 1}. ${header(message, "Subject") || "(no subject)"}`,
      `   From: ${header(message, "From")}`,
      `   Date: ${header(message, "Date")}${message.labelIds?.includes("UNREAD") ? " · unread" : ""}`,
      `   Preview: ${message.snippet ?? ""}`,
      `   id: ${message.id}`,
    ].join("\n"),
  );
  return `${ids.length} emails:\n${lines.join("\n")}`;
}

export async function readGmail(refreshToken: string, id: string): Promise<string> {
  const token = await accessToken(refreshToken);
  const message = await gmailGet<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`);
  return [
    `Subject: ${header(message, "Subject") || "(no subject)"}`,
    `From: ${header(message, "From")}`,
    `To: ${header(message, "To")}`,
    `Date: ${header(message, "Date")}`,
    "",
    messageText(message.payload).slice(0, 16_000) || "(no readable text in this email)",
  ].join("\n");
}

/** Used by the OAuth callback: confirms the grant works and returns the mailbox address. */
export async function describeGrant(accessTokenValue: string): Promise<string> {
  return gmailAddress(accessTokenValue);
}
