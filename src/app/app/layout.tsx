import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/lib/balance";
import { formatCredits } from "@/lib/credits";
import { timeAgo } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const balance = await getBalance(user);
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <Logo href="/app" />
          <nav className="ml-auto flex items-center gap-1 sm:ml-6 sm:mr-auto" aria-label="Main">
            <NavLink href="/app" exact>
              Automations
            </NavLink>
            <NavLink href="/app/connections">Connections</NavLink>
            <NavLink href="/app/settings">Settings</NavLink>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            {balance && (
              <span className="badge" title={`Balance from Accred, ${timeAgo(balance.at)}`}>
                <span className="dot text-primary-soft" />
                {formatCredits(balance.micro)} credits
              </span>
            )}
            <form action={signOut}>
              <button type="submit" className="btn btn-secondary btn-sm" aria-label="Sign out">
                <LogOut size={13} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
    </div>
  );
}
