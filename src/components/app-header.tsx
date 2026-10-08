import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/ui";
import { getBalance } from "@/lib/balance";
import { formatCredits } from "@/lib/credits";
import type { User } from "@/lib/db";
import { timeAgo } from "@/lib/format";

/** The signed-in header: logo, section links, balance and sign-out. `wide` stretches it to the bot workspace. */
export async function AppHeader({ user, wide = false }: { user: User; wide?: boolean }) {
  const balance = await getBalance(user);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
      <div className={`mx-auto flex h-14 w-full items-center gap-3 px-4 ${wide ? "max-w-[1600px]" : "max-w-5xl"}`}>
        <Logo href="/app" />
        <nav className="ml-auto flex items-center gap-1 sm:ml-6 sm:mr-auto" aria-label="Main">
          <NavLink href="/app/bot">Bot</NavLink>
          <NavLink href="/app" exact>
            Automations
          </NavLink>
          <NavLink href="/app/trading">Trading</NavLink>
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
  );
}
