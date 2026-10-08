import type { Metadata } from "next";
import { removeConnection } from "@/app/actions";
import { Notice, PageHeader } from "@/components/status";
import { ConfirmButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { googleConfigured } from "@/lib/connections/gmail";
import { COMING_SOON, CONNECTION_KINDS, CONNECTION_KIND_LIST, connectionDetails, isConnectionKind } from "@/lib/connections/kinds";
import { timeAgo } from "@/lib/format";
import { listConnections } from "@/lib/queries";
import { sharedBotConfigured } from "@/lib/telegram";
import { ConnectionForm } from "./connection-form";
import { TelegramConnect } from "./telegram-connect";

export const metadata: Metadata = { title: "Connections" };

const GMAIL_NOTICES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Gmail connected. Link it to an automation to use it." },
  denied: { tone: "warning", text: "Gmail was not connected because access was declined on Google's screen." },
  noscope: { tone: "warning", text: "Gmail was not connected: the permission to read mail was left unticked. Try again and keep it ticked." },
  failed: { tone: "danger", text: "Gmail could not be connected. Try again." },
  unconfigured: { tone: "warning", text: "Gmail is not set up on this server yet." },
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await requireUser();
  const list = await listConnections(user.id);
  const gmailNotice = GMAIL_NOTICES[(await searchParams).gmail ?? ""];

  return (
    <>
      <PageHeader
        title="Connections"
        description="The places your agents can act. Secrets are encrypted and never shown again. An automation only uses the connections you link to it."
      />

      {gmailNotice && (
        <div className="mb-6">
          <Notice tone={gmailNotice.tone}>{gmailNotice.text}</Notice>
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">Linked</h2>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">
            Nothing linked yet. Reading web pages and RSS feeds works without any connection.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="eyebrow w-20 flex-none">{isConnectionKind(connection.kind) ? CONNECTION_KINDS[connection.kind].label : connection.kind}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[13px] font-medium">{connection.name}</p>
                  {connectionDetails(connection.display).length === 0 ? (
                    <p className="text-xs text-muted">Secret saved</p>
                  ) : (
                    <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                      {connectionDetails(connection.display).map((detail) => (
                        <div key={detail.label} className="flex min-w-0 gap-1.5">
                          <dt className="flex-none text-muted">{detail.label}</dt>
                          <dd className="truncate font-mono">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {connection.kind === "telegram" && connection.display.chatId && (
                    <p className="mt-1 text-xs text-faint">
                      Telegram gave us this chat ID when you pressed Start in the bot. Messages from your automations go to this chat
                      {connection.display.owner ? ", sent by your own bot." : "."}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted">Added {timeAgo(connection.createdAt)}</span>
                <form action={removeConnection}>
                  <input type="hidden" name="id" value={connection.id} />
                  <ConfirmButton className="btn btn-danger btn-sm" confirmText="Yes, remove">
                    Remove
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Add a connection</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {CONNECTION_KIND_LIST.map((info) =>
            info.kind === "telegram" ? (
              <TelegramConnect
                key={info.kind}
                shared={sharedBotConfigured()}
                linked={list.filter((connection) => connection.kind === "telegram").length}
              />
            ) : info.oauth ? (
              <div key={info.kind} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{info.label}</p>
                    <p className="mt-0.5 text-[13px] text-muted">{info.blurb}</p>
                  </div>
                  {googleConfigured() ? (
                    // A plain link: this leaves the app for Google's consent screen.
                    <a href="/api/oauth/google/start" className="btn btn-secondary btn-sm flex-none">
                      Connect
                    </a>
                  ) : (
                    <span className="badge flex-none">Not set up</span>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted">
                  {googleConfigured()
                    ? "Emails the agent reads are sent to the AI model that runs the job."
                    : "The server needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before anyone can connect Gmail."}
                </p>
              </div>
            ) : (
              <ConnectionForm key={info.kind} info={info} />
            ),
          )}
        </div>
        <p className="mt-6 text-xs text-muted">
          <span className="eyebrow mr-2">Soon</span>
          {COMING_SOON.join(" · ")}
        </p>
      </section>
    </>
  );
}
