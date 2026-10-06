import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/connections/gmail";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";

const GOOGLE_STATE_COOKIE = "accred_google_oauth_state";

/** Sends the signed-in user to Google's consent screen. */
export async function GET() {
  if (!(await getUser())) return Response.redirect(`${env.appUrl}/login`);
  if (!googleConfigured()) return Response.redirect(`${env.appUrl}/app/connections?gmail=unconfigured`);

  // The state ties Google's answer to this browser, so a forged callback cannot attach someone else's mailbox.
  const state = randomToken(24);
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/api/oauth/google",
    maxAge: 600,
  });
  return Response.redirect(googleAuthUrl(state));
}
