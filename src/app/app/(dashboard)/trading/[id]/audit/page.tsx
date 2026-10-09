import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/status";
import { requireUser } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import { getTradingAgent, listAudit } from "@/lib/trading/queries";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const agent = await getTradingAgent(user.id, (await params).id);
  if (!agent) notFound();
  const page = Math.max(0, Math.min(500, Number.parseInt((await searchParams).page ?? "0", 10) || 0));
  const events = await listAudit(agent.automation.id, PAGE + 1, page * PAGE);
  const base = `/app/trading/${agent.automation.id}/audit`;

  return (
    <>
      <Link href={`/app/trading/${agent.automation.id}`} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={14} />
        {agent.automation.name}
      </Link>
      <PageHeader
        eyebrow="Audit log"
        title="Everything this agent did, and why"
        description="Proposals, the market data behind them, every risk check, quotes, simulations, fills, exits, configuration changes and pauses. Entries are only ever added. Keys and secrets are never recorded."
      />
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">Nothing recorded on this page.</p>
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {events.slice(0, PAGE).map((event) => (
            <li key={event.id} className="px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="w-44 flex-none font-mono text-xs text-muted">{formatWhen(event.createdAt, agent.automation.timezone)}</span>
                <span className="eyebrow w-24 flex-none">{event.actor.replace("_", " ")}</span>
                <span className="min-w-0 flex-1 basis-60 break-words">{event.summary}</span>
                <span className="font-mono text-[11px] text-faint">{event.type}</span>
              </div>
              {event.data && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-primary-soft">Recorded data</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-background p-3 font-mono text-[11px] leading-relaxed text-muted">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex gap-2">
        {page > 0 && (
          <Link href={`${base}?page=${page - 1}`} className="btn btn-secondary btn-sm">
            Newer
          </Link>
        )}
        {events.length > PAGE && (
          <Link href={`${base}?page=${page + 1}`} className="btn btn-secondary btn-sm">
            Older
          </Link>
        )}
      </div>
    </>
  );
}
