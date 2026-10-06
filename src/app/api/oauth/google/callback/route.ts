import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { GMAIL_SCOPE, describeGrant, exchangeGoogleCode, googleConfigured } from "@/lib/connections/gmail";
import { encrypt } from "@/lib/crypto";
import { connections, db } from "@/lib/db";
import { env } from "@/lib/env";

const STATE_COOKIE = "accred_google_oauth_state";

function back(result: string) {
  return Response.redirect(`${env.appUrl}/app/connections?gmail=${result}`);
}

/** Google returns here after the consent screen. Stores the grant as a Gmail connection. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(`${env.appUrl}/login`);
  if (!googleConfigured()) return back("unconfigured");

  const url = new URL(request.url);
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value ?? "";
  store.delete({ name: STATE_COOKIE, path: "/api/oauth/google" });

  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const matches = expected.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!code || !matches) return back("failed");

  try {
    const grant = await exchangeGoogleCode(code);
    // People can untick a permission on Google's screen; without it the connection would be useless.
    if (!grant.scope?.split(" ").includes(GMAIL_SCOPE)) return back("noscope");
    if (!grant.refresh_token) return back("failed");

    const email = await describeGrant(grant.access_token);
    const configEnc = encrypt(JSON.stringify({ refreshToken: grant.refresh_token, email }));
    const existing = await db
      .select({ id: connections.id, display: connections.display })
      .from(connections)
      .where(and(eq(connections.userId, user.id), eq(connections.kind, "gmail")));
    const same = existing.find((row) => row.display.email === email);
    if (same) {
      await db.update(connections).set({ configEnc }).where(eq(connections.id, same.id));
    } else {
      await db.insert(connections).values({ userId: user.id, kind: "gmail", name: email, configEnc, display: { email } });
    }
    return back("connected");
  } catch (error) {
    console.error("[google oauth]", error);
    return back("failed");
  }
}
