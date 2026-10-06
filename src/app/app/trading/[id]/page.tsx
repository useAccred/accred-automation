import { ArrowLeft, Ban, CircleStop, Pause, Pencil, Play, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { closeAllPositions, closeOnePosition, pauseTradingAgent, resumeTradingAgent, revokeTradingAccess, runTradingCycleNow } from "@/app/trading-actions";
import { Notice } from "@/components/status";
import { AgentBadges, TradeStateBadge } from "@/components/trading/badges";
import { DeleteAgentForm } from "@/components/trading/wallet-forms";
import { AutoRefresh, ConfirmButton, SubmitButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import type { AuditEvent, Execution, Position, RiskEvaluation, TradeProposal } from "@/lib/db/schema";
import { formatWhen, timeAgo } from "@/lib/format";
import { fmtPct, fmtPrice, fmtUsd, pnlTone, shortAddress, signedUsd } from "@/lib/trading/format";
import { LIVE_BLOCKERS, PAPER_REQUIREMENTS } from "@/lib/trading/live";
import { positionCapUsd, type Mandate } from "@/lib/trading/mandate";
import { MANDATE_GROUPS, formatMandateValue, intervalLabel } from "@/lib/trading/mandate-fields";
import { PERMISSIONS } from "@/lib/trading/permissions";
import { agentDashboard, getTradingAgent, listAudit, listDecisions, listPositions, listRuns } from "@/lib/trading/queries";
import { resolveStops } from "@/lib/trading/risk-engine";
import { STRATEGIES } from "@/lib/trading/strategy";
import { walletBalances } from "@/lib/trading/wallets";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const agent = await getTradingAgent(user.id, (await params).id);
  return { title: agent?.automation.name ?? "Trading agent" };
}

function Stat({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-background p-4">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-2 font-mono text-lg ${tone}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Line({ label, children, tone = "" }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-mono ${tone}`}>{children}</dd>
    </div>
  );
}

/** One decision, executed or not, with the numbers it was judged on and every check behind the verdict. */
function Decision({ proposal, evaluation, entry, mandate }: { proposal: TradeProposal; evaluation: RiskEvaluation | null; entry: Execution | null; mandate: Mandate }) {
  const rejected = proposal.state === "RISK_REJECTED" || proposal.state === "CANCELLED" || proposal.state === "FAILED";
  const stops = resolveStops(mandate, proposal);
  const market = proposal.market as { priceUsd?: number; liquidityUsd?: number } | null;
  const price = entry?.priceUsd ?? market?.priceUsd ?? null;
  const failed = evaluation?.checks.filter((check) => check.status === "fail") ?? [];
  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          <span className={rejected ? "text-warning" : "text-success"}>{rejected ? "SKIPPED" : "BUY"}</span> — {proposal.assetSymbol}
        </p>
        <span className="flex items-center gap-2">
          <TradeStateBadge state={proposal.state} />
          <span className="text-xs text-muted">{timeAgo(proposal.createdAt)}</span>
        </span>
      </div>
      <dl className="mt-3 grid gap-x-8 text-[13px] sm:grid-cols-2">
        <div>
          <Line label="Confidence">{proposal.confidence === null ? "—" : `${Math.round(proposal.confidence * 100)}%`}</Line>
          <Line label="Requested position">{fmtUsd(proposal.requestedUsd)}</Line>
          <Line label="Agent allocation">{fmtUsd(mandate.agentAllocationUsd)}</Line>
          <Line label={entry ? "Entry" : "Price when proposed"}>{fmtPrice(price)}</Line>
        </div>
        <div>
          <Line label="Stop loss">{price !== null && stops.stopLossPercent !== null ? `${fmtPrice(price * (1 - stops.stopLossPercent / 100))} (-${stops.stopLossPercent}%)` : "none stated"}</Line>
          <Line label="Take profit">{price !== null ? `${fmtPrice(price * (1 + stops.takeProfitPercent / 100))} (+${stops.takeProfitPercent}%)` : "—"}</Line>
          <Line label="Maximum planned loss">{stops.stopLossPercent !== null ? fmtUsd((proposal.requestedUsd * stops.stopLossPercent) / 100) : "—"}</Line>
          <Line label="Risk checks" tone={evaluation?.approved ? "text-success" : "text-warning"}>
            {evaluation ? `${evaluation.passed}/${evaluation.total} passed` : "not run"}
          </Line>
        </div>
      </dl>
      {proposal.reason && (
        <p className="mt-2 text-[13px] text-muted">
          <span className="text-foreground">Reason:</span> {proposal.reason}
        </p>
      )}
      {rejected && (
        <p className="mt-2 text-[13px] text-warning">
          {proposal.state === "RISK_REJECTED" ? "Risk engine: rejected automatically. " : ""}
          {proposal.outcome}
        </p>
      )}
      {evaluation && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-primary-soft">
            All {evaluation.total} checks · mandate v{proposal.mandateVersion}
            {failed.length > 0 && ` · ${failed.length} failed`}
          </summary>
          <ol className="mt-2 space-y-1 rounded-lg border border-line bg-background p-3 text-xs">
            {evaluation.checks.map((check) => (
              <li key={check.id} className="flex gap-2">
                <span className={`w-12 flex-none font-mono ${check.status === "pass" ? "text-success" : check.status === "fail" ? "text-danger" : "text-faint"}`}>
                  {check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "—"}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground">
                    {check.id}. {check.label}
                  </span>
                  <span className="text-muted"> · {check.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function PositionRow({ position, canClose }: { position: Position; canClose: boolean }) {
  const value = position.quantity * position.lastPriceUsd;
  const unrealized = position.quantity * (position.lastPriceUsd - position.entryPriceUsd);
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-[13px]">
      <div className="min-w-0 flex-1 basis-32">
        <p className="font-medium">{position.symbol}</p>
        <p className="text-xs text-muted">
          {fmtUsd(value)} · opened {timeAgo(position.openedAt)}
          {position.partialTaken && " · partly sold"}
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-x-5 text-xs">
        {[
          ["Entry", fmtPrice(position.entryPriceUsd)],
          ["Last", fmtPrice(position.lastPriceUsd)],
          ["Stop loss", fmtPrice(position.stopLossPrice)],
          ["Take profit", fmtPrice(position.takeProfitPrice)],
        ].map(([label, text]) => (
          <div key={label}>
            <dt className="text-faint">{label}</dt>
            <dd className="font-mono">{text}</dd>
          </div>
        ))}
      </dl>
      <span className={`w-20 text-right font-mono ${pnlTone(unrealized)}`}>{signedUsd(unrealized)}</span>
      {canClose && (
        <form action={closeOnePosition}>
          <input type="hidden" name="positionId" value={position.id} />
          <ConfirmButton className="btn btn-secondary btn-sm" confirmText="Close at market">
            Close
          </ConfirmButton>
        </form>
      )}
    </li>
  );
}

const ACTOR_TONE: Record<AuditEvent["actor"], string> = {
  user: "text-foreground",
  agent: "text-primary-soft",
  risk_engine: "text-warning",
  execution: "text-success",
  monitor: "text-success",
  system: "text-muted",
};

export default async function TradingAgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const user = await requireUser();
  const agent = await getTradingAgent(user.id, (await params).id);
  if (!agent) notFound();
  const { automation, mandate, mandateRow, strategy, wallet } = agent;
  const [dashboard, open, closed, decisions, runs, events, balance] = await Promise.all([
    agentDashboard(agent),
    listPositions(automation.id, "open", 50),
    listPositions(automation.id, "closed", 10),
    listDecisions(automation.id, 15),
    listRuns(automation.id, 8),
    listAudit(automation.id, 30),
    walletBalances(wallet.address),
  ]);
  const { portfolio, stats, costs } = dashboard;
  const { notice } = await searchParams;
  const total = portfolio.realizedNetUsd + portfolio.unrealizedUsd;
  // 100 credits = $1, so one microcredit is 1e-8 dollars.
  const llmUsd = Number(costs.creditsMicro) / 1e8;
  const grossUsd = portfolio.realizedGrossUsd + portfolio.unrealizedUsd;
  const netUsd = grossUsd - dashboard.swapFeesUsd - dashboard.networkFeesUsd - llmUsd;
  const running = automation.status === "running";
  const revoked = automation.accessRevokedAt !== null;
  const { paperDays } = dashboard;
  const cycleActive = runs.some((run) => run.status === "running");

  return (
    <>
      <AutoRefresh active={running || open.length > 0} intervalMs={cycleActive ? 3000 : 15_000} />
      <Link href="/app/trading" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={14} />
        Trading agents
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <AgentBadges mode={automation.mode} status={automation.status} pausedBy={automation.pausedBy} />
            <span className="eyebrow">
              {automation.modelMode === "pinned" ? automation.modelId : `${automation.modelMode} model`} · {intervalLabel(automation.intervalMinutes)}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{automation.name}</h1>
          <p className="mt-1 text-xs text-muted">
            Last cycle {timeAgo(automation.lastRunAt)}
            {running && automation.nextRunAt && ` · next ${timeAgo(automation.nextRunAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/trading/${automation.id}/edit`} className="btn btn-secondary">
            <Pencil size={14} />
            Edit mandate
          </Link>
          {running && (
            <form action={runTradingCycleNow}>
              <input type="hidden" name="id" value={automation.id} />
              <SubmitButton pendingText="Starting…">
                <RefreshCw size={14} />
                Run a cycle now
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {notice === "no_price" && (
        <div className="mb-6">
          <Notice tone="warning">A position could not be closed because no current price was available. It stays open under its stop loss. Try again in a moment.</Notice>
        </div>
      )}
      {automation.pauseReason && !running && (
        <div className="mb-6">
          <Notice tone="warning">
            {automation.pausedBy === "breaker" ? "Paused automatically. " : ""}
            {automation.pauseReason} No new positions are opened. Open positions keep their protective exits.
            {automation.pausedBy === "breaker" && " Resuming restarts the loss streak and the drawdown high-water mark from the current equity."}
          </Notice>
        </div>
      )}
      {wallet.tradingRevokedAt && (
        <div className="mb-6">
          <Notice tone="warning">
            Trading authority is revoked for this agent&apos;s wallet, so no position can be opened.{" "}
            <Link href={`/app/trading/wallets#${wallet.id}`} className="underline underline-offset-4">
              Manage the wallet
            </Link>
          </Notice>
        </div>
      )}

      <section className="mb-6 rounded-xl border border-danger/25 p-4 sm:p-5">
        <p className="eyebrow !text-danger">Emergency controls</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            {running ? (
              <form action={pauseTradingAgent}>
                <input type="hidden" name="id" value={automation.id} />
                <SubmitButton className="btn btn-danger w-full">
                  <Pause size={14} />
                  Pause agent
                </SubmitButton>
              </form>
            ) : revoked ? (
              <Link href={`/app/trading/${automation.id}/edit`} className="btn btn-secondary w-full">
                Review and re-approve
              </Link>
            ) : (
              <form action={resumeTradingAgent}>
                <input type="hidden" name="id" value={automation.id} />
                <SubmitButton className="btn btn-secondary w-full">
                  <Play size={14} />
                  Resume agent
                </SubmitButton>
              </form>
            )}
            <p className="hint">Stops new positions at once. Stop loss, take profit and time limits keep running on what is open.</p>
          </div>
          <div>
            <form action={closeAllPositions}>
              <input type="hidden" name="id" value={automation.id} />
              <ConfirmButton className="btn btn-danger w-full" confirmText={`Close ${open.length} now`}>
                <CircleStop size={14} />
                Close all positions
              </ConfirmButton>
            </form>
            <p className="hint">Pauses the agent, then sells every open position at the current market price.</p>
          </div>
          <div>
            {revoked ? (
              <button type="button" className="btn btn-secondary w-full" disabled>
                <Ban size={14} />
                Access revoked
              </button>
            ) : (
              <form action={revokeTradingAccess}>
                <input type="hidden" name="id" value={automation.id} />
                <ConfirmButton className="btn btn-danger w-full" confirmText="Yes, revoke access">
                  <Ban size={14} />
                  Revoke trading access
                </ConfirmButton>
              </form>
            )}
            <p className="hint">Removes the agent&apos;s permission to propose or open trades. Open positions stay protected. Starting again needs a fresh approval.</p>
          </div>
          <div>
            <Link href={`/app/trading/wallets?withdraw=${wallet.id}#${wallet.id}`} className="btn btn-danger w-full">
              <Wallet size={14} />
              Withdraw funds
            </Link>
            <p className="hint">Opens the wallet with the withdrawal form ready. Only you can move funds out; the agent never can.</p>
          </div>
        </div>
      </section>

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        <Stat label="Agent allocation" value={fmtUsd(mandate.agentAllocationUsd)} sub={`wallet ${shortAddress(wallet.address)} holds ${balance ? fmtUsd(balance.totalUsd) : "—"}`} />
        <Stat label="Available capital" value={fmtUsd(portfolio.availableUsd)} sub={mandate.reserveUsd > 0 ? `after a ${fmtUsd(mandate.reserveUsd)} reserve` : `largest position ${fmtUsd(positionCapUsd(mandate))}`} />
        <Stat label="Open exposure" value={fmtUsd(portfolio.openCostUsd)} sub={`${portfolio.openPositions} of ${mandate.maxOpenPositions} positions · limit ${fmtUsd((mandate.agentAllocationUsd * mandate.maxTotalExposurePercent) / 100)}`} />
        <Stat label="Drawdown" value={fmtPct(portfolio.drawdownPercent)} sub={`worst ${fmtPct(automation.maxDrawdownPercent)} · pauses at ${mandate.maxDrawdownPercent}%`} tone={portfolio.drawdownPercent >= mandate.maxDrawdownPercent / 2 ? "text-warning" : ""} />
      </dl>
      <dl className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        <Stat label="Realized PnL" value={signedUsd(portfolio.realizedNetUsd)} sub="sold positions, less every fee paid" tone={pnlTone(portfolio.realizedNetUsd)} />
        <Stat label="Unrealized PnL" value={signedUsd(portfolio.unrealizedUsd)} sub="open positions at the last price" tone={pnlTone(portfolio.unrealizedUsd)} />
        <Stat label="Today" value={signedUsd(portfolio.dayNetUsd)} sub={`pauses at -${fmtUsd((mandate.agentAllocationUsd * mandate.dailyLossLimitPercent) / 100)}`} tone={pnlTone(portfolio.dayNetUsd)} />
        <Stat label="Total PnL" value={signedUsd(total)} sub={automation.mode === "paper" ? "hypothetical: Paper Mode" : "live"} tone={pnlTone(total)} />
      </dl>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Open positions</h2>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">No open positions.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {open.map((position) => (
              <PositionRow key={position.id} position={position} canClose />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-1 text-sm font-medium">Decisions</h2>
            <p className="mb-3 text-xs text-muted">Every proposal the model made, including the ones the risk engine rejected.</p>
            {decisions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">
                No proposals yet. The model is only asked when an asset passes your market filters and strategy screens.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {decisions.map((decision) => (
                  <Decision key={decision.proposal.id} proposal={decision.proposal} evaluation={decision.evaluation} entry={decision.entry} mandate={decision.mandate ?? mandate} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Cycles</h2>
            {runs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">No cycle has run yet. The first one starts within a minute.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {runs.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                    <span className={`badge ${run.status === "failed" ? "text-danger" : run.status === "completed" ? "text-success" : run.status === "running" ? "text-primary-soft" : "text-muted"}`}>
                      <span className={`dot ${run.status === "running" ? "pulse" : ""}`} />
                      {run.status === "skipped" ? "No model call" : run.status}
                    </span>
                    <span className="min-w-0 flex-1 basis-56 text-muted">{run.summary ?? run.error ?? "In progress"}</span>
                    <span className="font-mono text-xs text-muted">
                      {run.model ? `${run.model} · ${run.inputTokens.toLocaleString("en")} in / ${run.outputTokens.toLocaleString("en")} out · ${formatCredits(run.creditsMicro)} cr` : "0 cr"}
                    </span>
                    <span className="w-16 text-right text-xs text-muted">{timeAgo(run.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">Activity</h2>
              <Link href={`/app/trading/${automation.id}/audit`} className="text-xs text-primary-soft underline-offset-4 hover:underline">
                Full audit log
              </Link>
            </div>
            <ol className="divide-y divide-line rounded-xl border border-line">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
                  <span className={`eyebrow w-24 flex-none ${ACTOR_TONE[event.actor]}`}>{event.actor.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 basis-60 break-words">{event.summary}</span>
                  <span className="flex-none text-xs text-muted">{timeAgo(event.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>

          {closed.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium">Closed positions</h2>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {closed.map((position) => {
                  const net = position.realizedPnlUsd - position.feesUsd;
                  return (
                    <li key={position.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
                      <span className="w-20 font-medium">{position.symbol}</span>
                      <span className="eyebrow">{position.closeReason?.replace(/_/g, " ")}</span>
                      <span className="min-w-0 flex-1 text-xs text-muted">
                        entry {fmtPrice(position.entryPriceUsd)} · {fmtUsd(position.initialQuantity * position.entryPriceUsd)} · fees {fmtUsd(position.feesUsd)} · mandate v{position.mandateVersion}
                      </span>
                      <span className={`font-mono ${pnlTone(net)}`}>{signedUsd(net)}</span>
                      <span className="w-16 text-right text-xs text-muted">{timeAgo(position.closedAt)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card p-5 text-[13px]">
            <p className="eyebrow">Net result after costs</p>
            <dl className="mt-3">
              <Line label="Gross trading PnL" tone={pnlTone(grossUsd)}>
                {signedUsd(grossUsd)}
              </Line>
              <Line label="Swap fees">{signedUsd(-dashboard.swapFeesUsd)}</Line>
              <Line label="Network fees">{signedUsd(-dashboard.networkFeesUsd)}</Line>
              <Line label="LLM cost">{signedUsd(-llmUsd)}</Line>
              <div className="mt-1 border-t border-line pt-1">
                <Line label="Net result" tone={pnlTone(netUsd)}>
                  {signedUsd(netUsd)}
                </Line>
              </div>
            </dl>
            <dl className="mt-4 border-t border-line pt-3 text-xs">
              <Line label="LLM credits charged">{formatCredits(costs.creditsMicro)}</Line>
              <Line label="Tokens in / out">
                {costs.inputTokens.toLocaleString("en")} / {costs.outputTokens.toLocaleString("en")}
              </Line>
              <Line label="Cycles · with a model call">
                {costs.cycles} · {costs.modelCalls}
              </Line>
            </dl>
            <p className="mt-3 text-xs text-muted">Paper fees are modelled: a 0.3% pool fee and the chain&apos;s current gas price.</p>
          </section>

          <section className="card p-5 text-[13px]">
            <p className="eyebrow">Paper results</p>
            <dl className="mt-3">
              <Line label="Closed trades">{stats.closedTrades}</Line>
              <Line label="Win rate">{stats.winRatePercent === null ? "—" : fmtPct(stats.winRatePercent, 0)}</Line>
              <Line label="Average win">{stats.averageWinUsd === null ? "—" : signedUsd(stats.averageWinUsd)}</Line>
              <Line label="Average loss">{stats.averageLossUsd === null ? "—" : signedUsd(-stats.averageLossUsd)}</Line>
              <Line label="Realized risk/reward">{stats.realizedRiskReward === null ? "—" : `${stats.realizedRiskReward.toFixed(2)}×`}</Line>
              <Line label="Max drawdown">{fmtPct(automation.maxDrawdownPercent)}</Line>
              <Line label="Proposals · rejected">
                {dashboard.proposals} · {dashboard.rejected}
              </Line>
              <Line label="Average slippage">{dashboard.averageSlippagePercent === null ? "—" : fmtPct(dashboard.averageSlippagePercent)}</Line>
            </dl>
            {dashboard.rejectionReasons.length > 0 && (
              <>
                <p className="mb-1 mt-3 border-t border-line pt-3 text-xs text-muted">Why proposals were rejected</p>
                <ul className="space-y-1 text-xs">
                  {dashboard.rejectionReasons.slice(0, 6).map((reason) => (
                    <li key={reason.label} className="flex justify-between gap-3">
                      <span>{reason.label}</span>
                      <span className="font-mono text-muted">{reason.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card p-5 text-[13px]">
            <p className="eyebrow">Going live</p>
            <p className="mt-2 text-xs text-muted">Run Paper Mode, review the results, then explicitly go live. Live Mode is locked for everyone for now.</p>
            <ul className="mt-3 space-y-1.5 text-xs">
              {[
                { done: stats.closedTrades >= PAPER_REQUIREMENTS.closedTrades, text: `${PAPER_REQUIREMENTS.closedTrades} closed paper trades (${stats.closedTrades} so far)` },
                { done: paperDays >= PAPER_REQUIREMENTS.days, text: `${PAPER_REQUIREMENTS.days} days in Paper Mode (${paperDays} so far)` },
                { done: false, text: "Live trading enabled on this server" },
              ].map((item) => (
                <li key={item.text} className="flex items-baseline gap-2">
                  <span className={`dot flex-none translate-y-[-2px] ${item.done ? "text-success" : "text-faint"}`} />
                  {item.text}
                </li>
              ))}
            </ul>
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer text-primary-soft">Why Live Mode is locked</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {LIVE_BLOCKERS.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </details>
          </section>

          <section className="card p-5 text-[13px]">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Mandate v{mandateRow.version}</p>
              <span className="eyebrow">{mandateRow.profile}</span>
            </div>
            <p className="mt-2 text-xs text-muted">Approved {formatWhen(mandateRow.approvedAt, automation.timezone)}. Enforced by the backend on every trade.</p>
            <p className="mt-3 text-xs">
              <span className="text-muted">Assets:</span> {mandate.allowedAssets.map((asset) => asset.symbol).join(", ")}
            </p>
            <p className="mt-1 text-xs">
              <span className="text-muted">Strategy v{strategy.version}:</span> {strategy.kinds.map((kind) => STRATEGIES[kind].label).join(", ") || "instructions only"}
            </p>
            {strategy.instructions && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">“{strategy.instructions}”</p>}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-primary-soft">All limits</summary>
              {MANDATE_GROUPS.map((group) => (
                <dl key={group.id} className="mt-3 text-xs">
                  <p className="mb-1 text-muted">{group.title}</p>
                  {group.fields.map((field) => (
                    <Line key={field.key} label={`${field.label}${field.unit === "$" || field.unit === "%" ? ` (${field.unit})` : ""}`}>
                      {formatMandateValue(field, mandate[field.key])}
                    </Line>
                  ))}
                </dl>
              ))}
              <dl className="mt-3 text-xs">
                <Line label="Stop loss must be stated">{mandate.stopLossRequired ? "yes" : "no, default applied"}</Line>
                <Line label="Trading hours">{mandate.tradingHours.enabled ? `${mandate.tradingHours.startHour}:00–${mandate.tradingHours.endHour}:59` : "any time"}</Line>
              </dl>
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-primary-soft">Permissions granted ({automation.permissions.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {automation.permissions.map((permission) => (
                  <li key={permission} className="flex items-baseline gap-2">
                    <span className="dot flex-none translate-y-[-2px] text-primary-soft" />
                    {PERMISSIONS[permission].label}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </aside>
      </div>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
        <p className="text-[13px] text-muted">Deleting removes this agent with its decisions and audit history. Positions must be closed first. This cannot be undone.</p>
        <DeleteAgentForm id={automation.id} />
      </section>
    </>
  );
}
