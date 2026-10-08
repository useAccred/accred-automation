"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { checkOwnTelegramLink, startOwnTelegramLink, startTelegramLink } from "@/app/actions";
import { Notice } from "@/components/status";
import { AutoRefresh, SubmitButton } from "@/components/ui";

/**
 * Links a Telegram chat through the Accred bot or the user's own bot. Either
 * way the user presses Start in the bot and never needs a chat ID.
 * `linked` is how many Telegram chats the user has connected.
 */
export function TelegramConnect({ linked, shared }: { linked: number; shared: boolean }) {
  const router = useRouter();
  const [sharedState, sharedAction] = useActionState(startTelegramLink, undefined);
  const [ownState, ownAction] = useActionState(startOwnTelegramLink, undefined);
  const [mode, setMode] = useState<"shared" | "own" | null>(null);
  // Remember the count when a link was made; a higher count means the chat has been linked.
  const [linkedAtStart, setLinkedAtStart] = useState(linked);
  const [busy, setBusy] = useState(false);

  // Links from earlier attempts stay in the action state; these are the ones already finished or cancelled.
  const [ignored, setIgnored] = useState<string[]>([]);

  const active = mode === "own" ? ownState : mode === "shared" ? sharedState : undefined;
  const latestUrl = active?.values?.url;
  const url = latestUrl && !ignored.includes(latestUrl) ? latestUrl : undefined;
  const code = mode === "own" && url ? ownState?.values?.code : undefined;
  const done = Boolean(url) && linked > linkedAtStart;
  const waiting = Boolean(url) && !done && !busy;

  // Nothing listens to a user's own bot, so ask the server to look for the Start message.
  useEffect(() => {
    if (!waiting || !code) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const status = await checkOwnTelegramLink(code).catch(() => "waiting" as const);
      if (stopped) return;
      if (status === "linked") router.refresh();
      if (status === "busy") setBusy(true);
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting, code, router]);

  /** Starts a fresh attempt: whatever link was on screen before no longer counts. */
  function begin(next: "shared" | "own" | null) {
    setIgnored([sharedState?.values?.url, ownState?.values?.url].filter((value): value is string => Boolean(value)));
    setMode(next);
    setLinkedAtStart(linked);
    setBusy(false);
  }

  return (
    <div className="card p-4">
      <AutoRefresh active={waiting && mode === "shared"} intervalMs={2000} />
      <p className="text-sm font-medium">Telegram</p>
      <p className="mt-0.5 text-[13px] text-muted">
        Get messages from your automations in any chat. Press Start in a bot and the chat is linked; no chat ID needed.
      </p>

      {!waiting && (
        <div className="mt-3 flex flex-wrap gap-2">
          {shared && (
            <form action={sharedAction} onSubmit={() => begin("shared")}>
              <SubmitButton className="btn btn-secondary btn-sm" pendingText="Preparing…">
                Use the Accred bot
              </SubmitButton>
            </form>
          )}
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={mode === "own"} onClick={() => begin(mode === "own" ? null : "own")}>
            Use my own bot
          </button>
        </div>
      )}

      {mode === "own" && !waiting && !done && (
        <form action={ownAction} onSubmit={() => begin("own")} className="mt-4 space-y-3 border-t border-line pt-4">
          <div>
            <label className="label" htmlFor="telegram-own-token">
              Your bot&apos;s token
            </label>
            <input
              id="telegram-own-token"
              name="botToken"
              type="password"
              className="input font-mono"
              placeholder="123456789:AA…"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <p className="hint">
              In Telegram, open @BotFather, send /newbot, and paste the token it gives you. It is stored encrypted with your account and used only
              to send your automations&apos; messages.
            </p>
          </div>
          <SubmitButton className="btn btn-primary" pendingText="Checking the bot…">
            Continue
          </SubmitButton>
        </form>
      )}

      {active?.error && !waiting && (
        <div className="mt-4">
          <Notice>{active.error}</Notice>
        </div>
      )}
      {busy && (
        <div className="mt-4">
          <Notice>
            This bot is already used by another app, so its messages cannot be read here. Create a separate bot with @BotFather for Accred
            Automation.
          </Notice>
        </div>
      )}

      {waiting && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <ol className="space-y-2 text-[13px] text-muted">
            <li>
              <span className="eyebrow mr-2">01</span>Open {active?.values?.bot ? <span className="text-foreground">@{active.values.bot}</span> : "the bot"} in
              Telegram.
            </li>
            <li>
              <span className="eyebrow mr-2">02</span>Press <span className="text-foreground">Start</span>. This page updates by itself.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary">
              Open Telegram
              <ArrowUpRight size={14} />
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => begin(null)}>
              Cancel
            </button>
          </div>
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
