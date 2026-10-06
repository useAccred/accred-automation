import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, Brain, Check, Info, Minimize2, ShieldAlert, Square, Wrench, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideApproval, stopRun } from "@/app/actions";
import { Notice, StatusBadge } from "@/components/status";
import { AutoRefresh, SubmitButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCredits, formatUsd, microToExact } from "@/lib/credits";
import { automations, db, runSteps, runs, type RunStep } from "@/lib/db";
import { RUN_STATUS, TRIGGER_LABEL, formatDuration, formatWhen } from "@/lib/format";

export const metadata: Metadata = { title: "Run" };

const STEP_ICON = { decision: Brain, tool: Wrench, condense: Minimize2, approval: ShieldAlert, note: Info } as const;

function stepTone(step: RunStep): string {
  if (step.status === "error" || step.status === "rejected") return "text-danger";
  if (step.status === "waiting") return "text-warning";
  if (step.kind === "decision") return "text-primary-soft";
  return "text-muted";
}

function Step({ step }: { step: RunStep }) {
  const Icon = STEP_ICON[step.kind];
  const hasCost = step.creditsMicro > 0n || step.model;
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <span className={`mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border border-line bg-background ${stepTone(step)}`}>
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 break-words text-[13px] font-medium">
            {step.title}
            {step.status === "approved" && <span className="ml-2 text-xs font-normal text-success">Approved</span>}
            {step.status === "rejected" && <span className="ml-2 text-xs font-normal text-danger">Declined</span>}
            {step.status === "waiting" && <span className="ml-2 text-xs font-normal text-warning">Waiting for you</span>}
          </p>
          {hasCost && (
            <p className="flex flex-none items-center gap-2 font-mono text-xs text-muted" title={`${microToExact(step.creditsMicro)} credits`}>
              {step.model && <span className="max-w-44 truncate text-faint">{step.model}</span>}
              <span className="text-foreground">{formatCredits(step.creditsMicro)}</span>
            </p>
          )}
        </div>
        {step.detail && (
          <p className={`mt-1 line-clamp-6 whitespace-pre-wrap break-words text-xs leading-relaxed ${step.status === "error" ? "text-danger" : "text-muted"}`}>
            {step.detail}
          </p>
        )}
        {(step.durationMs !== null || step.inputTokens !== null) && (
          <p className="mt-1 text-[11px] text-faint">
            {[
              formatDuration(step.durationMs),
              step.inputTokens !== null && `${step.inputTokens.toLocaleString("en")} tokens in`,
              step.outputTokens !== null && `${step.outputTokens.toLocaleString("en")} out`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ run: runs, automation: { id: automations.id, name: automations.name, timezone: automations.timezone } })
    .from(runs)
    .innerJoin(automations, eq(automations.id, runs.automationId))
    .where(and(eq(runs.id, id), eq(runs.userId, user.id)));
  if (!row) notFound();
  const { run, automation } = row;
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.id)).orderBy(asc(runSteps.idx));

  const status = RUN_STATUS[run.status];
  const waiting = run.status === "waiting_approval" ? steps.findLast((step) => step.status === "waiting") : undefined;
  const percent = run.budgetMicro > 0n ? Math.min(100, Number((run.creditsMicro * 100n) / run.budgetMicro)) : 0;
  const modelCalls = steps.filter((step) => step.model).length;

  return (
    <>
      <AutoRefresh active={status.active} />
      <Link href={`/app/automations/${automation.id}`} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={14} />
        {automation.name}
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Run</h1>
          <StatusBadge status={run.status} />
          <span className="eyebrow">{TRIGGER_LABEL[run.trigger]}</span>
          <span className="text-xs text-muted">{formatWhen(run.createdAt, automation.timezone)}</span>
        </div>
        {(status.active || run.status === "waiting_approval") && (
          <form action={stopRun}>
            <input type="hidden" name="runId" value={run.id} />
            <SubmitButton className="btn btn-secondary btn-sm">
              <Square size={11} />
              Stop run
            </SubmitButton>
          </form>
        )}
      </div>

      {waiting && (
        <section className="mb-6 rounded-xl border border-warning/35 bg-warning/10 p-5">
          <p className="eyebrow !text-warning">Approval needed</p>
          <p className="mt-2 break-words text-sm font-medium">{waiting.title}</p>
          <p className="mt-1 font-mono text-xs text-muted">{waiting.tool}</p>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-background p-3 font-mono text-xs leading-relaxed">
            {Object.entries(waiting.args ?? {})
              .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
              .join("\n\n")}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={decideApproval}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="decision" value="approve" />
              <SubmitButton pendingText="Approving…">
                <Check size={14} />
                Approve
              </SubmitButton>
            </form>
            <form action={decideApproval}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="decision" value="reject" />
              <SubmitButton className="btn btn-secondary">
                <X size={14} />
                Decline
              </SubmitButton>
            </form>
          </div>
          <p className="mt-3 text-xs text-muted">Nothing is sent until you approve. If you decline, the agent is told and wraps up.</p>
        </section>
      )}

      {run.result && (
        <section className="card mb-6 p-5">
          <p className="eyebrow">Result</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{run.result}</p>
        </section>
      )}
      {run.error && (
        <div className="mb-6">
          <Notice tone={run.status === "failed" ? "danger" : "warning"}>{run.error}</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section>
          <h2 className="mb-3 text-sm font-medium">Steps</h2>
          {steps.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">
              {status.active ? "Starting. The first step appears once the model replies." : "This run ended before any step ran."}
            </p>
          ) : (
            <ol className="divide-y divide-line rounded-xl border border-line">
              {steps.map((step) => (
                <Step key={step.id} step={step} />
              ))}
            </ol>
          )}
        </section>

        <aside className="card h-fit p-5">
          <p className="eyebrow">Receipt</p>
          <p className="mt-3 font-mono text-2xl" title={`${microToExact(run.creditsMicro)} credits`}>
            {formatCredits(run.creditsMicro)}
          </p>
          <p className="text-xs text-muted">credits charged · {formatUsd(run.creditsMicro)}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${percent}% of the run budget used`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            of a <span className="font-mono text-foreground">{formatCredits(run.budgetMicro)}</span> credit budget
          </p>
          <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Model calls</dt>
              <dd className="font-mono">{modelCalls}</dd>
            </div>
            {run.plannerModel && (
              <div className="flex justify-between gap-3">
                <dt className="flex-none text-muted">Decides</dt>
                <dd className="truncate font-mono">{run.plannerModel}</dd>
              </div>
            )}
            {run.readerModel && run.readerModel !== run.plannerModel && (
              <div className="flex justify-between gap-3">
                <dt className="flex-none text-muted">Reads</dt>
                <dd className="truncate font-mono">{run.readerModel}</dd>
              </div>
            )}
            {run.startedAt && run.finishedAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Took</dt>
                <dd className="font-mono">{formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      {run.payload && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">Trigger payload</h2>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-card p-4 font-mono text-xs text-muted">{run.payload}</pre>
        </section>
      )}
    </>
  );
}
