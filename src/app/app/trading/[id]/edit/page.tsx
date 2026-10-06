import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/status";
import { TradingForm } from "@/components/trading/trading-form";
import { requireUser } from "@/lib/auth";
import { isConnectionKind } from "@/lib/connections/kinds";
import { microToExact } from "@/lib/credits";
import { formCatalog, listConnections } from "@/lib/queries";
import { topAssets } from "@/lib/trading/market-data";
import { getTradingAgent, listPositions, listWallets } from "@/lib/trading/queries";
import { walletBalances } from "@/lib/trading/wallets";

export const metadata: Metadata = { title: "Edit trading agent" };

const NOTIFY_KINDS = ["telegram", "slack", "discord", "http"];

export default async function EditTradingAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const agent = await getTradingAgent(user.id, (await params).id);
  if (!agent) notFound();
  const { automation, mandate, strategy } = agent;
  const [wallets, rows, catalog, assets, open] = await Promise.all([listWallets(user.id), listConnections(user.id), formCatalog(), topAssets(), listPositions(automation.id, "open", 50)]);
  const balances = await Promise.all(wallets.map((wallet) => walletBalances(wallet.address)));
  const connections = rows.flatMap((row) => (isConnectionKind(row.kind) && NOTIFY_KINDS.includes(row.kind) ? [{ id: row.id, kind: row.kind, name: row.name }] : []));

  return (
    <>
      <PageHeader
        eyebrow={`Edit · mandate v${automation.mandateVersion}`}
        title={automation.name}
        description="Saving creates a new version. Anything that lets the agent risk more has to be confirmed separately."
      />
      {automation.accessRevokedAt && (
        <div className="mb-6">
          <Notice tone="warning">Trading access is revoked. Review the permissions below and approve them to grant access again and restart the agent.</Notice>
        </div>
      )}
      <TradingForm
        initial={{
          id: automation.id,
          name: automation.name,
          walletId: automation.walletId,
          modelMode: automation.modelMode,
          modelId: automation.modelId ?? "",
          maxPerRun: microToExact(automation.maxPerRunMicro),
          maxPerMonth: microToExact(automation.maxPerMonthMicro),
          intervalMinutes: automation.intervalMinutes,
          strategies: strategy.kinds,
          instructions: strategy.instructions,
          mandate,
          permissions: automation.permissions,
          connectionIds: automation.connectionIds.filter((id) => connections.some((connection) => connection.id === id)),
        }}
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
        openPositions={open.length}
      />
    </>
  );
}
