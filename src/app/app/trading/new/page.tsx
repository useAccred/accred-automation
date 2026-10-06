import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/status";
import { TradingForm, type TradingFormValues } from "@/components/trading/trading-form";
import { requireUser } from "@/lib/auth";
import { isConnectionKind } from "@/lib/connections/kinds";
import { formCatalog, listConnections } from "@/lib/queries";
import { presetMandate } from "@/lib/trading/mandate";
import { topAssets } from "@/lib/trading/market-data";
import { PERMISSION_LIST } from "@/lib/trading/permissions";
import { listWallets } from "@/lib/trading/queries";
import { walletBalances } from "@/lib/trading/wallets";

export const metadata: Metadata = { title: "New trading agent" };

/** Connection types that can carry a notice out. */
const NOTIFY_KINDS = ["telegram", "slack", "discord", "http"];

export default async function NewTradingAgentPage() {
  const user = await requireUser();
  const [wallets, rows, catalog, assets] = await Promise.all([listWallets(user.id), listConnections(user.id), formCatalog(), topAssets()]);
  const balances = await Promise.all(wallets.map((wallet) => walletBalances(wallet.address)));
  const connections = rows.flatMap((row) => (isConnectionKind(row.kind) && NOTIFY_KINDS.includes(row.kind) ? [{ id: row.id, kind: row.kind, name: row.name }] : []));
  const usable = wallets.find((wallet) => wallet.tradingRevokedAt === null);

  const initial: TradingFormValues = {
    name: "",
    walletId: usable?.id ?? "",
    modelMode: "auto",
    modelId: "",
    maxPerRun: "5",
    maxPerMonth: "300",
    intervalMinutes: 15,
    strategies: ["momentum"],
    instructions: "",
    mandate: presetMandate("balanced", 1000),
    // Shown ticked so the review is of the whole grant; nothing takes effect until the approval box is ticked.
    permissions: PERMISSION_LIST,
    connectionIds: [],
  };

  return (
    <>
      <PageHeader
        eyebrow="New · Trading agent"
        title="Define exactly how your agent can trade"
        description="The agent researches the market and proposes trades. Deterministic backend controls approve every one before anything moves. You are giving it a mandate, not your wallet."
        actions={
          <Link href="/app/trading" className="btn btn-secondary">
            Back
          </Link>
        }
      />
      <TradingForm
        initial={initial}
        wallets={wallets.map((wallet, index) => ({
          id: wallet.id,
          name: wallet.name,
          address: wallet.address,
          balanceUsd: balances[index]?.totalUsd ?? null,
          revoked: wallet.tradingRevokedAt !== null,
        }))}
        connections={connections}
        catalog={catalog}
        topAssets={assets}
      />
    </>
  );
}
