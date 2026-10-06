import { and, desc, eq } from "drizzle-orm";
import { ArrowUpRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/status";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/lib/balance";
import { CONNECTION_KINDS } from "@/lib/connections/kinds";
import { formatCredits, formatUsd } from "@/lib/credits";
import { automations, db, runs } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { latestRuns, monthlyUsage } from "@/lib/queries";
import { describeCron } from "@/lib/schedule";
import { TEMPLATES } from "@/lib/templates";

export const metadata: Metadata = { title: "Automations" };

function triggerText(automation: { triggerType: string; cron: string | null }): string {
  if (automation.triggerType === "schedule" && automation.cron) return describeCron(automation.cron);
  return automation.triggerType === "webhook" ? "When a webhook arrives" : "Manual";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [balance, list, usage, latest, waiting] = await Promise.all([
    getBalance(user),
    db.select().from(automations).where(eq(automations.userId, user.id)).orderBy(desc(automations.createdAt)),
    monthlyUsage(user.id),
    latestRuns(user.id),
    db
      .select({ id: runs.id, automationId: runs.automationId })
      .from(runs)
      .where(and(eq(runs.userId, user.id), eq(runs.status, "waiting_approval")))
      .orderBy(desc(runs.createdAt)),
  ]);
  const monthCredits = [...usage.values()].reduce((total, row) => total + row.credits, 0n);
  const monthRuns = [...usage.values()].reduce((total, row) => total + row.count, 0);
  const names = new Map(list.map((automation) => [automation.id, automation.name]));

  return (
    <>
      <PageHeader
        title="Automations"
        description="Each one is a job an agent runs for you, paid per run from your Accred credits."
        actions={
          <Link href="/app/new" className="btn btn-primary">
            <Plus size={15} />
            New automation
          </Link>
        }
      />

      {waiting.length > 0 && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-medium text-warning">
            {waiting.length === 1 ? "One run is waiting for your approval" : `${waiting.length} runs are waiting for your approval`}
          </p>
          <ul className="mt-2 space-y-1">
            {waiting.slice(0, 5).map((run) => (
              <li key={run.id}>
                <Link href={`/app/runs/${run.id}`} className="text-[13px] underline underline-offset-4">
                  Review “{names.get(run.automationId) ?? "automation"}”
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-background p-4">
          <dt className="eyebrow flex items-center justify-between gap-2">
            Credit balance
            <a href="https://accred.sh" target="_blank" rel="noreferrer" className="normal-case tracking-normal text-primary-soft underline-offset-4 hover:underline">
              Add credit
            </a>
          </dt>
          {balance ? (
            <>
              <dd className="mt-2 font-mono text-lg">{formatCredits(balance.micro)} credits</dd>
              <dd className="mt-0.5 text-xs text-muted">
                {formatUsd(balance.micro)} · {balance.source === "live" ? `live from Accred, ${timeAgo(balance.at)}` : `as of your last run, ${timeAgo(balance.at)}`}
              </dd>
            </>
          ) : (
            <>
              <dd className="mt-2 font-mono text-lg text-muted">—</dd>
              <dd className="mt-0.5 text-xs text-muted">Shown after your first run</dd>
            </>
          )}
        </div>
        {[
          { label: "Spent this month", value: `${formatCredits(monthCredits)} credits`, sub: formatUsd(monthCredits) },
          { label: "Runs this month", value: String(monthRuns), sub: `${list.filter((automation) => automation.enabled).length} automations on` },
          { label: "Waiting for approval", value: String(waiting.length), sub: waiting.length ? "Needs you" : "Nothing pending" },
        ].map((stat) => (
          <div key={stat.label} className="bg-background p-4">
            <dt className="eyebrow">{stat.label}</dt>
            <dd className="mt-2 font-mono text-lg">{stat.value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{stat.sub}</dd>
          </div>
        ))}
      </dl>

      {list.length === 0 ? (
        <section>
          <div className="card p-6 sm:p-8">
            <p className="eyebrow mb-3">Start here</p>
            <h2 className="text-lg font-semibold tracking-tight">Pick a template, or describe your own job</h2>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Templates fill in the instruction and schedule. You can change every word before anything runs.
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((template) => (
              <Link key={template.id} href={`/app/new?template=${template.id}`} className="card group flex flex-col p-4 transition-colors hover:border-line-strong">
                <p className="eyebrow">{template.category}</p>
                <p className="mt-2 text-sm font-medium">{template.name}</p>
                <p className="mt-1 flex-1 text-[13px] text-muted">{template.description}</p>
                <p className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{template.triggerLabel}</span>
                  <span className="text-faint">{template.connections.map((kind) => CONNECTION_KINDS[kind].label).join(" + ")}</span>
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.map((automation) => {
            const last = latest.get(automation.id);
            const used = usage.get(automation.id);
            return (
              <li key={automation.id}>
                <Link href={`/app/automations/${automation.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:bg-card">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className={`dot flex-none ${automation.enabled ? "text-success" : "text-faint"}`} aria-hidden />
                      <span className="truncate">{automation.name}</span>
                      {!automation.enabled && <span className="eyebrow">Paused</span>}
                    </p>
                    <p className="mt-1 truncate pl-3.5 text-xs text-muted">{triggerText(automation)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    {last ? (
                      <>
                        <StatusBadge status={last.status} />
                        <span>{timeAgo(last.createdAt)}</span>
                      </>
                    ) : (
                      <span>No runs yet</span>
                    )}
                  </div>
                  <div className="w-28 text-right font-mono text-xs text-muted">
                    {formatCredits(used?.credits ?? 0n)}
                    <span className="text-faint"> / {formatCredits(automation.maxPerMonthMicro)}</span>
                  </div>
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
