import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/connections/gmail";
import { randomToken } from "@/lib/crypto";
import { requestOrigin } from "@/lib/origin";

const GOOGLE_STATE_COOKIE = "accred_google_oauth_state";

/** Sends the signed-in user to Google's consent screen. */
export async function GET() {
  const origin = await requestOrigin();
  if (!(await getUser())) return Response.redirect(`${origin}/login`);
  if (!googleConfigured()) return Response.redirect(`${origin}/app/connections?gmail=unconfigured`);

  // The state ties Google's answer to this browser, so a forged callback cannot attach someone else's mailbox.
  const state = randomToken(24);
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/oauth/google",
    maxAge: 600,
  });
  return Response.redirect(googleAuthUrl(state, origin));
}
