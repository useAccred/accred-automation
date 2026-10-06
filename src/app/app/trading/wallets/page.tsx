import type { Metadata } from "next";
import Link from "next/link";
import { setWalletAuthority } from "@/app/trading-actions";
import { PageHeader } from "@/components/status";
import { CreateWalletForm, ImportWalletForm, RemoveWalletForm, WithdrawForm } from "@/components/trading/wallet-forms";
import { CopyField, SubmitButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import { EXPLORER_URL } from "@/lib/trading/chain";
import { fmtUsd } from "@/lib/trading/format";
import { listTradingAgents, listWalletAudit, listWallets } from "@/lib/trading/queries";
import { MAX_WALLETS, walletBalances } from "@/lib/trading/wallets";

export const metadata: Metadata = { title: "Trading wallets" };

export default async function WalletsPage({ searchParams }: { searchParams: Promise<{ withdraw?: string }> }) {
  const user = await requireUser();
  const { withdraw } = await searchParams;
  const [wallets, agents, history] = await Promise.all([listWallets(user.id), listTradingAgents(user.id), listWalletAudit(user.id)]);
  const balances = new Map(await Promise.all(wallets.map(async (wallet) => [wallet.id, await walletBalances(wallet.address)] as const)));

  return (
    <>
      <PageHeader
        eyebrow="Trading"
        title="Dedicated wallets"
        description="A trading agent works from its own wallet on Robinhood Chain, never from your main one. The agent's allocation is a cap inside this wallet; the rest stays out of its reach."
        actions={
          <Link href="/app/trading" className="btn btn-secondary">
            Back to agents
          </Link>
        }
      />

      {wallets.length === 0 ? (
        <p className="mb-6 rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">No trading wallet yet. Create one below.</p>
      ) : (
        <ul className="mb-8 space-y-4">
          {wallets.map((wallet) => {
            const balance = balances.get(wallet.id) ?? null;
            const using = agents.filter((agent) => agent.automation.walletId === wallet.id);
            const allocated = using.reduce((total, agent) => total + agent.mandate.agentAllocationUsd, 0);
            const revoked = wallet.tradingRevokedAt !== null;
            return (
              <li key={wallet.id} id={wallet.id} className="card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {wallet.name}
                      <span className="eyebrow">{wallet.source === "created" ? "Created here" : "Imported"}</span>
                      {revoked && <span className="badge text-warning">Trading authority revoked</span>}
                    </p>
                    <a href={`${EXPLORER_URL}/address/${wallet.address}`} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-xs text-muted underline-offset-4 hover:underline">
                      {wallet.address}
                    </a>
                  </div>
                  <form action={setWalletAuthority}>
                    <input type="hidden" name="walletId" value={wallet.id} />
                    <input type="hidden" name="allowed" value={String(revoked)} />
                    <SubmitButton className={revoked ? "btn btn-secondary btn-sm" : "btn btn-danger btn-sm"}>{revoked ? "Restore trading authority" : "Revoke trading authority"}</SubmitButton>
                  </form>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
                  {[
                    { label: "Wallet balance", value: balance ? fmtUsd(balance.totalUsd) : "Unavailable", sub: balance ? "live from Robinhood Chain" : "the chain could not be read" },
                    { label: "ETH", value: balance ? balance.eth.toFixed(5) : "—", sub: balance ? fmtUsd(balance.eth * balance.ethUsd) : "" },
                    { label: "USDG", value: balance ? balance.usdg.toFixed(2) : "—", sub: "dollar stablecoin" },
                    { label: "Agent allocation", value: using.length ? fmtUsd(allocated) : "None", sub: using.length ? `${using.length} agent${using.length === 1 ? "" : "s"} · paper` : "no agent uses this wallet" },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-card p-3">
                      <dt className="eyebrow">{stat.label}</dt>
                      <dd className="mt-1.5 font-mono text-sm">{stat.value}</dd>
                      <dd className="mt-0.5 text-[11px] text-muted">{stat.sub}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-muted">
                  {revoked
                    ? "While authority is revoked, no agent can open a position with this wallet. Protective exits on open positions continue."
                    : "Revoking stops every agent that uses this wallet from opening positions, at once. You can restore it later."}
                </p>

                <div className="mt-5 grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
                  <div>
                    <p className="eyebrow mb-3">Deposit</p>
                    <CopyField value={wallet.address} label="Deposit address" />
                    <p className="hint">
                      Send ETH (for network fees) or USDG on Robinhood Chain (chain ID 4663) to this address. Funds sent on another network cannot be recovered. Paper Mode needs no deposit.
                    </p>
                  </div>
                  <details open={withdraw === wallet.id}>
                    <summary className="eyebrow mb-3 cursor-pointer">Withdraw funds</summary>
                    <WithdrawForm walletId={wallet.id} emergency={withdraw === wallet.id} />
                  </details>
                </div>
                {using.length === 0 && (
                  <div className="mt-5 border-t border-line pt-4">
                    <RemoveWalletForm walletId={wallet.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {wallets.length < MAX_WALLETS && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-5 sm:p-6">
            <p className="eyebrow mb-1">Create a wallet</p>
            <p className="mb-4 text-[13px] text-muted">The recommended way: a fresh wallet that has never been used for anything else.</p>
            <CreateWalletForm />
          </section>
          <section className="card p-5 sm:p-6">
            <p className="eyebrow mb-1">Import a wallet</p>
            <p className="mb-4 text-[13px] text-muted">For a wallet you already made for this purpose. Do not import a wallet that holds anything else.</p>
            <ImportWalletForm />
          </section>
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium">Wallet history</h2>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 break-all text-[13px]">{event.summary}</span>
                <span className="flex-none text-xs text-muted">{formatWhen(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
