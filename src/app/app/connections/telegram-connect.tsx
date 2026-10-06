"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { useActionState, useState } from "react";
import { startTelegramLink } from "@/app/actions";
import { Notice } from "@/components/status";
import { AutoRefresh, SubmitButton } from "@/components/ui";

/** One-click linking through the shared bot. `linked` is how many Telegram chats the user has connected. */
export function TelegramConnect({ linked }: { linked: number }) {
  const [state, action] = useActionState(startTelegramLink, undefined);
  // Remember the count when the link was made; a higher count means the bot has linked the chat.
  const [linkedAtStart, setLinkedAtStart] = useState(linked);
  const url = state?.values?.url;
  const done = Boolean(url) && linked > linkedAtStart;
  const waiting = Boolean(url) && !done;

  return (
    <div className="card p-4">
      <AutoRefresh active={waiting} intervalMs={2000} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Telegram</p>
          <p className="mt-0.5 text-[13px] text-muted">Get messages from the Accred bot in any chat. No token or chat ID needed.</p>
        </div>
        {!waiting && (
          <form action={action} onSubmit={() => setLinkedAtStart(linked)}>
            <SubmitButton className="btn btn-secondary btn-sm flex-none" pendingText="Preparing…">
              {linked > 0 ? "Connect another" : "Connect"}
            </SubmitButton>
          </form>
        )}
      </div>

      {state?.error && (
        <div className="mt-4">
          <Notice>{state.error}</Notice>
        </div>
      )}
      {waiting && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <ol className="space-y-2 text-[13px] text-muted">
            <li>
              <span className="eyebrow mr-2">01</span>Open the bot in Telegram.
            </li>
            <li>
              <span className="eyebrow mr-2">02</span>Press <span className="text-foreground">Start</span>. This page updates by itself.
            </li>
          </ol>
          <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary">
            Open Telegram
            <ArrowUpRight size={14} />
          </a>
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="dot pulse text-primary-soft" />
            Waiting for you to press Start. The link works once and expires in 15 minutes.
          </p>
        </div>
      )}
      {done && (
        <div className="mt-4">
          <Notice tone="success">
            <Check size={13} className="mr-1.5 inline" />
            Telegram connected. Link it to an automation to use it.
          </Notice>
        </div>
      )}
    </div>
  );
}
