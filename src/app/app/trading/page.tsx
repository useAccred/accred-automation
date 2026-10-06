import { ArrowUpRight, Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/status";
import { AgentBadges } from "@/components/trading/badges";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { fmtUsd, pnlTone, signedUsd } from "@/lib/trading/format";
import { intervalLabel } from "@/lib/trading/mandate-fields";
import { listTradingAgents, listWallets } from "@/lib/trading/queries";

export const metadata: Metadata = { title: "Trading agents" };

const PRINCIPLES = [
  { title: "A hard allocation", body: "You set the most the agent may deploy. The rest of the wallet is out of its reach." },
  { title: "Limits the model cannot move", body: "Seventeen risk checks run in the backend before every trade. One failure rejects it." },
  { title: "Every decision shown", body: "Executed or rejected, each proposal is listed with the checks it passed and failed." },
  { title: "Simulated before signed", body: "Every swap is run on the chain from the wallet first. It is only signed if that passes." },
  { title: "Stops that do not sleep", body: "Stop loss and take profit are enforced by a monitor that needs no model." },
  { title: "Yours to stop", body: "Pause, close everything or revoke access at any moment." },
];

export default async function TradingPage() {
  const user = await requireUser();
  const [agents, wallets] = await Promise.all([listTradingAgents(user.id), listWallets(user.id)]);

  return (
    <>
      <PageHeader
        eyebrow="Trading agents"
        title="Define exactly how your agent can trade"
        description="Give an AI agent a mandate on Robinhood Chain: a capped allocation, strict risk rules and the assets it may touch. It proposes; a deterministic risk engine decides."
        actions={
          <>
            <Link href="/app/trading/wallets" className="btn btn-secondary">
              <Wallet size={14} />
              Wallets{wallets.length ? ` · ${wallets.length}` : ""}
            </Link>
            <Link href="/app/trading/new" className="btn btn-primary">
              <Plus size={15} />
              New trading agent
            </Link>
          </>
        }
      />

      {agents.length === 0 ? (
        <>
          <div className="card p-6 sm:p-8">
            <p className="eyebrow mb-3">Start here</p>
            <h2 className="text-lg font-semibold tracking-tight">Set up your first agent</h2>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Create a dedicated wallet, fund it with USDG and a little ETH, set an allocation and a risk mandate, and pick the assets. The agent then trades for real on Robinhood Chain, inside those limits.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={wallets.length ? "/app/trading/new" : "/app/trading/wallets"} className="btn btn-primary">
                {wallets.length ? "Set up an agent" : "Create a dedicated wallet"}
              </Link>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="card p-4">
                <p className="text-sm font-medium">{principle.title}</p>
                <p className="mt-1 text-[13px] text-muted">{principle.body}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {agents.map(({ automation, mandate, portfolio }) => {
            const total = portfolio.realizedNetUsd + portfolio.unrealizedUsd;
            return (
              <li key={automation.id}>
                <Link href={`/app/trading/${automation.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:bg-card">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">{automation.name}</p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {intervalLabel(automation.intervalMinutes)} · {mandate.allowedAssets.map((asset) => asset.symbol).join(", ")}
                    </p>
                  </div>
                  <AgentBadges mode={automation.mode} status={automation.status} pausedBy={automation.pausedBy} />
                  <div className="w-36 text-right text-xs text-muted">
                    <span className="block font-mono text-foreground">
                      {fmtUsd(portfolio.openCostUsd)} <span className="text-faint">/ {fmtUsd(mandate.agentAllocationUsd)}</span>
                    </span>
                    {portfolio.openPositions} open · last cycle {timeAgo(automation.lastRunAt)}
                  </div>
                  <div className={`w-24 text-right font-mono text-sm ${pnlTone(total)}`}>{signedUsd(total)}</div>
                  <ArrowUpRight size={15} className="hidden text-faint transition-colors group-hover:text-foreground sm:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
