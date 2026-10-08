import { and, desc, eq, inArray } from "drizzle-orm";
import { Pencil, Play } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clearMemory, deleteAutomation, rotateWebhook, runNow, setEnabled } from "@/app/actions";
import { Notice, PageHeader, StatusBadge } from "@/components/status";
import { AutoRefresh, ConfirmButton, CopyField, SubmitButton } from "@/components/ui";
import { MODEL_MODES } from "@/lib/agent/modes";
import { creditsThisMonth } from "@/lib/agent/runner";
import { requireUser } from "@/lib/auth";
import { CONNECTION_KINDS, isConnectionKind } from "@/lib/connections/kinds";
import { formatCredits } from "@/lib/credits";
import { connections, db, runs } from "@/lib/db";
import { requestOrigin } from "@/lib/origin";
import { RUN_STATUS, TRIGGER_LABEL, formatWhen, timeAgo } from "@/lib/format";
import { getAutomation, listConnections } from "@/lib/queries";
import { describeCron } from "@/lib/schedule";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const automation = await getAutomation(user.id, (await params).id);
  return { title: automation?.name ?? "Automation" };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
      <dt className="eyebrow w-32 flex-none pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px]">{children}</dd>
    </div>
  );
}

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const automation = await getAutomation(user.id, (await params).id);
  if (!automation) notFound();

  const [history, linked, monthSpent, available] = await Promise.all([
    db.select().from(runs).where(eq(runs.automationId, automation.id)).orderBy(desc(runs.createdAt)).limit(30),
    automation.connectionIds.length
      ? db
          .select({ id: connections.id, kind: connections.kind, name: connections.name, display: connections.display })
          .from(connections)
          .where(and(eq(connections.userId, user.id), inArray(connections.id, automation.connectionIds)))
      : [],
    creditsThisMonth(automation.id),
    listConnections(user.id),
  ]);
  const webhookUrl = `${await requestOrigin()}/api/hooks/${automation.webhookToken}`;
  const anyActive = history.some((run) => RUN_STATUS[run.status].active);
  const monthPercent = Math.min(100, Number((monthSpent * 100n) / (automation.maxPerMonthMicro || 1n)));

  return (
    <>
      <AutoRefresh active={anyActive} />
      <PageHeader
        eyebrow={automation.enabled ? "Automation · On" : "Automation · Paused"}
        title={automation.name}
        actions={
          <>
            <form action={setEnabled}>
              <input type="hidden" name="id" value={automation.id} />
              <input type="hidden" name="enabled" value={String(!automation.enabled)} />
              <SubmitButton className="btn btn-secondary">{automation.enabled ? "Pause" : "Turn on"}</SubmitButton>
            </form>
            <Link href={`/app/automations/${automation.id}/edit`} className="btn btn-secondary">
              <Pencil size={14} />
              Edit
            </Link>
            <form action={runNow}>
              <input type="hidden" name="id" value={automation.id} />
              <SubmitButton pendingText="Starting…">
                <Play size={14} />
                Run now
              </SubmitButton>
            </form>
          </>
        }
      />

      {linked.length === 0 && available.length > 0 && (
        <div className="mb-6">
          <Notice tone="warning">
            None of your connections are linked to this automation, so the agent can only read public web pages.{" "}
            <Link href={`/app/automations/${automation.id}/edit`} className="underline underline-offset-4">
              Edit it and select the connections it should use.
            </Link>
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card px-5 py-2 sm:px-6">
          <dl className="divide-y divide-line">
            <Row label="Job">
              <p className="whitespace-pre-wrap leading-relaxed">{automation.instruction}</p>
            </Row>
            <Row label="Trigger">
              {automation.triggerType === "schedule" && automation.cron ? (
                <>
                  {describeCron(automation.cron)} <span className="text-muted">({automation.timezone})</span>
                  {automation.enabled && automation.nextRunAt && (
                    <span className="mt-1 block text-xs text-muted">Next run {formatWhen(automation.nextRunAt, automation.timezone)}</span>
                  )}
                </>
              ) : automation.triggerType === "webhook" ? (
                "When a webhook arrives"
              ) : (
                "Only when you press Run now"
              )}
            </Row>
            <Row label="Connections">
              {linked.length === 0 ? (
                <span className="text-muted">None. The agent can read web pages and feeds only.</span>
              ) : (
                <ul className="space-y-1.5">
                  {linked.map((connection) => (
                    <li key={connection.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="badge">
                        {isConnectionKind(connection.kind) ? CONNECTION_KINDS[connection.kind].label : connection.kind} · {connection.name}
                      </span>
                      {connection.kind === "telegram" && connection.display.chatId && (
                        <span className="text-xs text-muted">
                          sends to chat ID <span className="font-mono text-foreground">{connection.display.chatId}</span>
                        </span>
                      )}
                      {connection.kind === "gmail" && <span className="text-xs text-muted">read-only</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Brain">
              {MODEL_MODES[automation.modelMode].label}
              {automation.modelMode === "pinned" && (
                <span className="mt-1 block font-mono text-xs text-muted">
                  brain {automation.modelId}
                  {automation.readerModelId && automation.readerModelId !== automation.modelId && ` · reading ${automation.readerModelId}`}
                </span>
              )}
            </Row>
            <Row label="Approval">
              {automation.requireApproval ? "Asks before it sends or changes anything" : "Acts without asking"}
            </Row>
          </dl>
        </section>

        <aside className="space-y-6">
          <section className="card p-5">
            <p className="eyebrow">Budget</p>
            <p className="mt-3 font-mono text-lg">
              {formatCredits(monthSpent)} <span className="text-sm text-muted">/ {formatCredits(automation.maxPerMonthMicro)}</span>
            </p>
            <p className="text-xs text-muted">credits used this month</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${monthPercent}% of the monthly cap used`}>
              <div className={`h-full rounded-full ${monthPercent >= 100 ? "bg-warning" : "bg-primary"}`} style={{ width: `${monthPercent}%` }} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Up to <span className="font-mono text-foreground">{formatCredits(automation.maxPerRunMicro)}</span> credits per run.
            </p>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Memory</p>
              {automation.memory && (
                <form action={clearMemory}>
                  <input type="hidden" name="id" value={automation.id} />
                  <button type="submit" className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline">
                    Clear
                  </button>
                </form>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13px] text-muted">
              {automation.memory || "Empty. The agent can save short notes here to use on later runs."}
            </p>
          </section>
        </aside>
      </div>

      {automation.triggerType === "webhook" && (
        <section className="card mt-6 space-y-3 p-5 sm:p-6">
          <p className="eyebrow">Webhook URL</p>
          <CopyField value={webhookUrl} label="Webhook URL" />
          <p className="text-xs text-muted">
            Send a POST request to start a run. The body, up to 64 KB, is given to the agent as the trigger payload. Anyone with this URL can start runs, so treat it like a password.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-background p-3 font-mono text-xs text-muted">
            {`curl -X POST '${webhookUrl}' \\\n  -H 'content-type: application/json' \\\n  -d '{"event":"test","message":"Hello from curl"}'`}
          </pre>
          <form action={rotateWebhook}>
            <input type="hidden" name="id" value={automation.id} />
            <ConfirmButton className="btn btn-secondary btn-sm" confirmText="Yes, replace the URL">
              Replace this URL
            </ConfirmButton>
          </form>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium">Runs</h2>
        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">
            No runs yet. Press Run now to try the job once.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {history.map((run) => (
              <li key={run.id}>
                <Link href={`/app/runs/${run.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-card">
                  <StatusBadge status={run.status} />
                  <span className="min-w-0 flex-1 basis-48 truncate text-[13px] text-muted">{run.result ?? run.error ?? "In progress"}</span>
                  <span className="eyebrow">{TRIGGER_LABEL[run.trigger]}</span>
                  <span className="w-20 text-right text-xs text-muted">{timeAgo(run.createdAt)}</span>
                  <span className="w-16 text-right font-mono text-xs">{formatCredits(run.creditsMicro)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
        <p className="text-[13px] text-muted">Deleting removes this automation and its run history. This cannot be undone.</p>
        <form action={deleteAutomation}>
          <input type="hidden" name="id" value={automation.id} />
          <ConfirmButton confirmText="Yes, delete it">Delete automation</ConfirmButton>
        </form>
      </section>
    </>
  );
}
