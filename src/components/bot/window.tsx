"use client";

import { Bell, Mic, Monitor, Plus, Search, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MuseFace } from "@/components/muse";
import type { BotColor, BotShape } from "@/lib/db/schema";

/**
 * The chat window: a sidebar of bots and one thread, drawn like a desktop
 * app. Pure presentation; the workspace and the landing demo feed it.
 */

export interface SidebarBot {
  id: string;
  name: string;
  color: BotColor;
  shape: BotShape;
  /** A few faces at once, for a crew of bots. */
  crew?: Array<{ color: BotColor; shape: BotShape }>;
  time: string;
  preview: string;
  typing?: boolean;
}

export type ThreadItem =
  | { type: "time"; id: string; label: string }
  | { type: "user"; id: string; text: string }
  | { type: "bot"; id: string; text: string; tone?: "normal" | "error"; receipt?: string }
  | {
      type: "event";
      id: string;
      icon?: "clock" | "check" | "dot" | "memory";
      /** A muted verb before the icon, e.g. "Created routine". */
      label?: string;
      text: string;
      /** For a pending action: Confirm and Cancel buttons. */
      action?: { id: string; status: string; detail?: string; description?: string };
    };

export interface Person {
  initials: string;
  name: string;
}

export function BotWindow({
  bots,
  activeId,
  onSelect,
  onNew,
  thread,
  typing,
  person,
  composer,
  headerAction,
  query,
  onQuery,
  empty,
  className = "",
}: {
  bots: SidebarBot[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew?(): void;
  thread: ThreadItem[];
  typing?: boolean;
  person: Person;
  composer: ReactNode;
  headerAction?: ReactNode;
  query?: string;
  onQuery?(value: string): void;
  empty?: ReactNode;
  className?: string;
}) {
  const active = bots.find((bot) => bot.id === activeId) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const lastKey = thread.length ? `${thread[thread.length - 1]!.id}:${typing ? 1 : 0}:${thread.map((item) => (item.type === "event" && item.action ? item.action.status : "")).join("")}` : "";
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastKey, activeId]);

  return (
    <div className={`bw flex overflow-hidden rounded-[28px] border border-white/[0.08] text-[15px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)] ${className}`}>
      <aside className="bw-side flex w-[300px] flex-none flex-col border-r border-white/[0.07] max-md:hidden lg:w-[420px]">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-2.5" aria-hidden>
            <span className="h-[15px] w-[15px] rounded-full bg-[#ff5f57]" />
            <span className="h-[15px] w-[15px] rounded-full bg-[#febc2e]" />
            <span className="h-[15px] w-[15px] rounded-full bg-[#28c840]" />
          </div>
          <button type="button" onClick={onNew} className="bw-icon" aria-label="New bot" disabled={!onNew}>
            <Plus size={22} strokeWidth={1.6} />
          </button>
        </div>
        <label className="bw-search mx-6 mt-6 flex items-center gap-3 rounded-xl px-4">
          <Search size={18} className="text-white/40" />
          <input
            value={query ?? ""}
            onChange={(event) => onQuery?.(event.target.value)}
            placeholder="Search"
            className="h-[46px] w-full bg-transparent text-[17px] placeholder:text-white/35 focus:outline-none"
            readOnly={!onQuery}
          />
        </label>
        <ul className="mt-5 flex-1 overflow-y-auto px-4">
          {bots.map((bot) => (
            <li key={bot.id}>
              <button
                type="button"
                onClick={() => onSelect(bot.id)}
                className={`flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition-colors ${bot.id === activeId ? "bw-selected" : "hover:bg-white/[0.04]"}`}
              >
                <Avatar bot={bot} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[17px] text-white/[0.92]">{bot.name}</span>
                    <span className="flex-none text-[15px] text-white/40">{bot.time}</span>
                  </span>
                  <span className={`mt-0.5 block truncate text-[15px] ${bot.typing ? "text-white/70" : "text-white/45"}`}>{bot.typing ? "Typing…" : bot.preview}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 px-6 pb-6 pt-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] text-[13px] text-white/60">{person.initials}</span>
          <span className="text-[17px] text-white/[0.92]">{person.name}</span>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Phones have no sidebar: a strip of faces switches bots instead. */}
        <div className="flex flex-none items-center gap-2 overflow-x-auto border-b border-white/[0.07] px-3 py-2.5 md:hidden" role="tablist" aria-label="Bots">
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              role="tab"
              aria-selected={bot.id === activeId}
              onClick={() => onSelect(bot.id)}
              className={`flex flex-none items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] transition-colors ${bot.id === activeId ? "bw-selected text-white" : "text-white/60"}`}
            >
              <Avatar bot={bot} size={26} />
              <span className="max-w-[9rem] truncate">{bot.name}</span>
              {bot.typing ? <span className="bw-dot" /> : null}
            </button>
          ))}
          {onNew ? (
            <button type="button" onClick={onNew} className="bw-icon h-8 w-8 flex-none" aria-label="New bot">
              <Plus size={18} strokeWidth={1.6} />
            </button>
          ) : null}
        </div>
        <header className="flex h-[66px] flex-none items-center justify-between border-b border-white/[0.07] px-5">
          <div className="flex min-w-0 items-center gap-3">
            {active ? <Avatar bot={active} size={26} /> : null}
            <span className="truncate text-[17px] text-white/[0.92]">{active?.name ?? "Accred Bot"}</span>
          </div>
          <div className="flex items-center gap-1">
            {headerAction}
            <span className="bw-icon text-white/55" aria-hidden>
              <Monitor size={20} strokeWidth={1.6} />
            </span>
          </div>
        </header>

        <div ref={scroller} className="bw-thread flex-1 overflow-y-auto px-3 py-4 sm:px-6">
          {thread.length === 0 && !typing ? empty : null}
          <ol className="mx-auto flex max-w-[1000px] flex-col gap-3">
            {thread.map((item) => (
              <li key={item.id} className={item.type === "user" ? "flex justify-end" : item.type === "bot" ? "flex justify-start" : "flex justify-center"}>
                <Item item={item} />
              </li>
            ))}
            {typing ? (
              <li className="flex justify-start">
                <span className="bw-bot inline-flex items-center gap-1.5 rounded-[22px] px-5 py-4" aria-label="Typing">
                  <span className="bw-dot" />
                  <span className="bw-dot [animation-delay:150ms]" />
                  <span className="bw-dot [animation-delay:300ms]" />
                </span>
              </li>
            ) : null}
          </ol>
        </div>

        <div className="flex-none px-3 pb-3 pt-2 sm:px-6 sm:pb-6">{composer}</div>
      </section>
    </div>
  );
}

export function Avatar({ bot, size }: { bot: Pick<SidebarBot, "color" | "shape" | "crew">; size: number }) {
  if (bot.crew && bot.crew.length > 1) {
    const small = Math.round(size * 0.62);
    return (
      <span className="relative inline-block flex-none" style={{ width: size, height: size }} aria-hidden>
        {bot.crew.slice(0, 3).map((member, index) => (
          <span
            key={index}
            className="absolute"
            style={{ left: [size * 0.3, 0, size * 0.42][index], top: [0, size * 0.36, size * 0.4][index] }}
          >
            <MuseFace color={member.color} shape={member.shape} size={small} />
          </span>
        ))}
      </span>
    );
  }
  return <MuseFace color={bot.color} shape={bot.shape} size={size} className="flex-none" />;
}

function Item({ item }: { item: ThreadItem }) {
  if (item.type === "time") return <span className="py-1 text-[15px] text-white/40">{item.label}</span>;
  if (item.type === "user") return <span className="bw-user max-w-[85%] rounded-[22px] px-4 py-3 text-[16px] leading-[1.4] whitespace-pre-wrap sm:max-w-[78%] sm:px-5 sm:py-3.5 sm:text-[18px]">{item.text}</span>;
  if (item.type === "bot") {
    return (
      <span className="group flex max-w-[90%] flex-col items-start sm:max-w-[82%]">
        <span className={`bw-bot rounded-[22px] px-4 py-3 text-[16px] leading-[1.45] sm:px-5 sm:py-3.5 sm:text-[18px] ${item.tone === "error" ? "text-[#f0a3a3]" : ""}`}>
          <Rich text={item.text} />
        </span>
        {item.receipt ? <span className="mt-1 px-2 text-[12px] text-white/35 opacity-0 transition-opacity group-hover:opacity-100">{item.receipt}</span> : null}
      </span>
    );
  }
  return <EventRow item={item} />;
}

function EventRow({ item }: { item: Extract<ThreadItem, { type: "event" }> }) {
  if (item.action) return <ActionCard item={item} />;
  const Icon = item.icon === "clock" ? Bell : item.icon === "memory" ? Settings2 : null;
  const [label, text] = item.label !== undefined ? [item.label, item.text] : item.text.includes(" · ") ? [item.text.split(" · ")[0]!, item.text.split(" · ").slice(1).join(" · ")] : [undefined, item.text];
  return (
    <span className="inline-flex max-w-[90%] items-center gap-2 py-1 text-[16px] text-white/45">
      {label ? <span className="flex-none">{label}</span> : null}
      {Icon ? <Icon size={18} className="flex-none text-white/60" /> : label === "Failed" ? <X size={16} className="flex-none text-[#f0a3a3]" /> : <span className="bw-tick mr-1" aria-hidden />}
      <span className="truncate text-white/[0.85]">{text}</span>
    </span>
  );
}

function ActionCard({ item }: { item: Extract<ThreadItem, { type: "event" }> }) {
  const action = item.action!;
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "confirm" | "cancel") {
    setPending(decision);
    setError(null);
    try {
      const response = await fetch(`/api/bot/actions/${action.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      if (!response.ok) setError(((await response.json()) as { error?: string }).error ?? "That did not work.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(null);
    }
  }
  const label = { pending: "Waiting for you", done: "Done", cancelled: "Cancelled", failed: "Failed", expired: "Expired" }[action.status] ?? action.status;
  return (
    <div className="bw-bot w-full max-w-[560px] rounded-[20px] px-5 py-4 text-[16px]">
      <p className="flex items-center justify-between gap-3">
        <span className="text-white/45">Wants to</span>
        <span className={`text-[13px] ${action.status === "pending" ? "text-[#ffd166]" : action.status === "done" ? "text-[#7bd88f]" : "text-white/45"}`}>{label}</span>
      </p>
      <p className="mt-1 text-[17px] text-white/[0.92]">{item.text}</p>
      {action.description ? <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-white/60">{action.description}</p> : null}
      {action.detail ? <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-white/60">{action.detail}</p> : null}
      {action.status === "pending" ? (
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="bw-btn bw-btn-primary" disabled={pending !== null} onClick={() => decide("confirm")}>
            {pending === "confirm" ? "Working…" : "Confirm"}
          </button>
          <button type="button" className="bw-btn" disabled={pending !== null} onClick={() => decide("cancel")}>
            Cancel
          </button>
          {error ? <span className="text-[13px] text-[#f0a3a3]">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Plain text with two touches: "✓ " lines as a checklist and **bold** for a key figure. */
export function Rich({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <>
      {lines.map((line, index) => {
        const check = /^\s*(✓|\[x\]|- \[x\])\s+/.test(line);
        const body = check ? line.replace(/^\s*(✓|\[x\]|- \[x\])\s+/, "") : line;
        return (
          <span key={index} className={`block ${check ? "flex items-start gap-2" : ""}`}>
            {check ? <span className="bw-tick mr-1.5 mt-[0.45em]" aria-hidden /> : null}
            <span>{bold(body)}</span>
          </span>
        );
      })}
    </>
  );
}

function bold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => (part.startsWith("**") && part.endsWith("**") ? <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong> : part));
}

/** The composer pill: plus at the left, mic at the right. */
export function Composer({
  placeholder,
  disabled,
  onSend,
  hint,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend?(text: string): Promise<void> | void;
  hint?: ReactNode;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = value.trim();
    if (!text || disabled || !onSend) return;
    setValue("");
    await onSend(text);
    input.current?.focus();
  }
  return (
    <form onSubmit={submit} className="bw-composer flex items-end gap-3 rounded-[28px] px-3 py-2.5">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/[0.12] text-white/60" aria-hidden>
        <Plus size={20} strokeWidth={1.6} />
      </span>
      {hint ?? (
        <textarea
          ref={input}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) void submit(event);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="max-h-40 min-h-[40px] w-full resize-none bg-transparent py-2 text-[18px] leading-6 text-white/[0.92] placeholder:text-white/40 focus:outline-none disabled:opacity-60"
        />
      )}
      <button type="submit" className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/[0.12] text-white/70 transition-colors hover:bg-white/[0.06] disabled:opacity-50" aria-label="Send" disabled={disabled || !value.trim()}>
        <Mic size={18} strokeWidth={1.7} />
      </button>
    </form>
  );
}
