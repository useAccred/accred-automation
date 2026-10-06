import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getUser()) redirect("/app");
  return (
    <main className="glow flex flex-1 flex-col items-center px-4 py-10 sm:py-16">
      <Logo />
      <div className="card mt-12 w-full max-w-md p-6 sm:p-8">
        <p className="eyebrow mb-3">Sign in</p>
        <h1 className="text-xl font-semibold tracking-tight">Paste your Accred API key</h1>
        <p className="mt-2 text-sm text-muted">
          Your key is your account here. Runs are paid from the credit behind it, so there is nothing else to set up.
        </p>
        <LoginForm />
        <ol className="mt-6 space-y-2 border-t border-line pt-5 text-[13px] text-muted">
          <li>
            <span className="eyebrow mr-2">01</span>Open the API page at{" "}
            <a className="text-foreground underline underline-offset-4" href="https://accred.sh" target="_blank" rel="noreferrer">
              accred.sh
            </a>{" "}
            and create a key.
          </li>
          <li>
            <span className="eyebrow mr-2">02</span>Activate some credit on the Wallet page.
          </li>
          <li>
            <span className="eyebrow mr-2">03</span>Paste the key above. It is stored encrypted and used only to run your automations.
          </li>
        </ol>
      </div>
      <p className="mt-6 max-w-md text-center text-xs text-faint">
        Tip: create a separate key just for automations, so you can revoke it without touching your other apps.
      </p>
      <p className="mt-4 text-center text-xs text-faint">
        By continuing you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
