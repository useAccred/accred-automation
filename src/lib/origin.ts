import { headers } from "next/headers";
import { env } from "./env";

/**
 * The public address the current request came in on, e.g. https://agent.accred.sh.
 *
 * An explicit APP_URL always wins. Without one, the address is read from the
 * request, so the app works on every domain attached to it and a sign-in flow
 * that starts on one domain returns to the same one.
 */
export async function requestOrigin(): Promise<string> {
  if (env.appUrlConfigured) return env.appUrl;
  const incoming = await headers();
  const host = (incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "").split(",")[0]!.trim();
  // Anything that is not a plain host name is ignored rather than echoed into a redirect.
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(host)) return env.appUrl;
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const forwarded = (incoming.get("x-forwarded-proto") ?? "").split(",")[0]!.trim();
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${protocol}://${host}`;
}
