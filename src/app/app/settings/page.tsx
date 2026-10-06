import type { Metadata } from "next";
import { deleteAccount, signOut } from "@/app/actions";
import { PageHeader } from "@/components/status";
import { ConfirmButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/lib/balance";
import { formatCredits } from "@/lib/credits";
import { timeAgo } from "@/lib/format";
import { ReplaceKeyForm } from "./replace-key-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const balance = await getBalance(user);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-6">
        <section className="card p-5 sm:p-6">
          <p className="eyebrow">Accred API key</p>
          <p className="mt-3 font-mono text-sm">ct_live_••••••••{user.keyHint}</p>
          <p className="mt-1 text-xs text-muted">
            {balance
              ? `Balance ${formatCredits(balance.micro)} credits, as reported by Accred ${timeAgo(balance.at)}.`
              : "Your balance appears here after the first run."}
          </p>
          <p className="mt-4 text-[13px] text-muted">
            Every run is paid with this key. If you revoke it at accred.sh, replace it here first, or your automations stop and you will need the new key to sign in.
          </p>
          <ReplaceKeyForm />
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <div>
            <p className="eyebrow">Session</p>
            <p className="mt-2 text-[13px] text-muted">Sign out on this device. Scheduled automations keep running.</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <div className="max-w-md">
            <p className="eyebrow !text-danger">Delete account</p>
            <p className="mt-2 text-[13px] text-muted">
              Removes your automations, run history, connections and the stored key from this service. Your Accred account and credits are not affected.
            </p>
          </div>
          <form action={deleteAccount}>
            <ConfirmButton confirmText="Yes, delete everything">Delete account</ConfirmButton>
          </form>
        </section>
      </div>
    </>
  );
}
