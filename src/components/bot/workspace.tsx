"use client";

import { Settings2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MODEL_MODES, type ModelMode } from "@/lib/agent/modes";
import { BOT_COLORS, BOT_COLOR_LIST, BOT_PRESETS, BOT_SHAPES } from "@/lib/bot/presets";
import type { BotSummary } from "@/lib/bot/store";
import type { BotColor, BotShape } from "@/lib/db/schema";
import { MuseFace } from "@/components/muse";
import { BotWindow, Composer, type Person, type SidebarBot, type ThreadItem } from "./window";

/**
 * The signed-in workspace. Bots and threads come from /api/bot; a sent
 * message gets its reply in the background, so the thread polls while the
 * bot is busy and slowly otherwise, which also keeps other tabs in step.
 */

interface ThreadMessage {
  id: string;
  role: "user" | "bot" | "event";
  kind: string;
  content: string;
  meta: Record<string, unknown>;
  credits: string;
  at: string;
}

interface ModelOption {
  id: string;
  name: string;
}

const POLL_BUSY_MS = 1500;
const POLL_IDLE_MS = 8000;
const TIME_GAP_MS = 20 * 60_000;

function timeLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

function sidebarTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function describeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n")
    .slice(0, 800);
}

function toThread(messages: ThreadMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let last = 0;
  for (const message of messages) {
    const at = Date.parse(message.at);
    if (at - last > TIME_GAP_MS) items.push({ type: "time", id: `t-${message.id}`, label: timeLabel(message.at) });
    last = at;
    if (message.role === "user") items.push({ type: "user", id: message.id, text: message.content });
    else if (message.role === "bot") {
      const credits = Number(message.credits);
      const model = typeof message.meta.model === "string" ? message.meta.model : null;
      items.push({
        type: "bot",
        id: message.id,
        text: message.content,
        tone: message.kind === "error" || message.kind === "budget" ? "error" : "normal",
        receipt: credits > 0 ? `${credits.toFixed(4)} credits${model ? ` · ${model}` : ""}` : undefined,
      });
    }
    else if (message.kind === "action") {
      const status = String(message.meta.status ?? "pending");
      items.push({
        type: "event",
        id: message.id,
        text: message.content,
        action: { id: String(message.meta.actionId ?? ""), status, detail: typeof message.meta.detail === "string" ? message.meta.detail : undefined, description: describeArgs(message.meta.args) },
      });
    } else if (message.kind === "memory") {
      items.push({ type: "event", id: message.id, icon: "memory", label: "Saved to memory", text: message.content.replace(/^Save to memory\s*/i, "") });
    } else {
      const failed = message.meta.status === "error";
      items.push({
        type: "event",
        id: message.id,
        icon: "check",
        label: failed ? "Failed" : "",
        text: `${message.content}${failed && typeof message.meta.detail === "string" ? ` (${message.meta.detail})` : ""}`,
      });
    }
  }
  return items;
}

export function BotWorkspace({ initialBots, person, models, createPreset }: { initialBots: BotSummary[]; person: Person; models: ModelOption[]; createPreset?: string | null }) {
  const [bots, setBots] = useState<BotSummary[]>(initialBots);
  const [activeId, setActiveId] = useState<string | null>(initialBots[0]?.id ?? null);
  const [threads, setThreads] = useState<Record<string, ThreadMessage[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"new" | "settings" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Record<string, string>>({});
  const presetHandled = useRef(false);

  // Arriving from the landing page with ?preset= creates that bot once.
  useEffect(() => {
    if (!createPreset || presetHandled.current) return;
    presetHandled.current = true;
    window.history.replaceState(null, "", "/app/bot");
    void createBot({ preset: createPreset });
  }, [createPreset]);

  const refreshBots = useCallback(async () => {
    const response = await fetch("/api/bot", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { bots: BotSummary[] };
    setBots(data.bots);
    setBusy(Object.fromEntries(data.bots.map((bot) => [bot.id, bot.busy])));
  }, []);

  const loadThread = useCallback(async (botId: string, incremental: boolean) => {
    const after = incremental ? latest.current[botId] : undefined;
    const response = await fetch(`/api/bot/${botId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { messages: ThreadMessage[]; busy: boolean };
    setBusy((current) => (current[botId] === data.busy ? current : { ...current, [botId]: data.busy }));
    setThreads((current) => {
      const existing = after ? (current[botId] ?? []) : [];
      const byId = new Map(existing.map((message) => [message.id, message]));
      for (const message of data.messages) byId.set(message.id, message);
      const merged = [...byId.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { ...current, [botId]: merged };
    });
    // Action cards change in place, so always re-read the last minute as well.
    if (data.messages.length) latest.current[botId] = new Date(Date.parse(data.messages[data.messages.length - 1]!.at) - 60_000).toISOString();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadThread(activeId, false);
  }, [activeId, loadThread]);

  // Poll the open thread: quickly while the bot works, slowly otherwise.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (cancelled) return;
      await loadThread(activeId, true);
      await refreshBots();
      if (!cancelled) timer = setTimeout(loop, busy[activeId] ? POLL_BUSY_MS : POLL_IDLE_MS);
    };
    timer = setTimeout(loop, busy[activeId] ? POLL_BUSY_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId, busy, loadThread, refreshBots]);

  async function send(text: string) {
    if (!activeId) return;
    setError(null);
    const botId = activeId;
    const response = await fetch(`/api/bot/${botId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok) {
      setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "The message was not sent.");
      return;
    }
    const data = (await response.json()) as { message: ThreadMessage };
    setThreads((current) => ({ ...current, [botId]: [...(current[botId] ?? []), data.message] }));
    setBusy((current) => ({ ...current, [botId]: true }));
    setBots((current) => current.map((bot) => (bot.id === botId ? { ...bot, busy: true, preview: text, previewRole: "user", lastMessageAt: data.message.at } : bot)));
  }

  async function createBot(input: Record<string, unknown>) {
    setError(null);
    const response = await fetch("/api/bot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const data = (await response.json()) as { id?: string; bots?: BotSummary[]; error?: string };
    if (!response.ok || !data.id) {
      setError(data.error ?? "The bot was not created.");
      return;
    }
    setBots(data.bots ?? []);
    setActiveId(data.id);
    setPanel(null);
  }

  async function patchBot(input: Record<string, unknown>) {
    if (!activeId) return;
    setError(null);
    const response = await fetch(`/api/bot/${activeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const data = (await response.json()) as { bots?: BotSummary[]; error?: string };
    if (!response.ok) {
      setError(data.error ?? "The change was not saved.");
      return;
    }
    setBots(data.bots ?? []);
    if (input.clearThread) {
      latest.current[activeId] = "";
      setThreads((current) => ({ ...current, [activeId]: [] }));
    }
  }

  async function removeBot() {
    if (!activeId) return;
    const response = await fetch(`/api/bot/${activeId}`, { method: "DELETE" });
    const data = (await response.json()) as { bots?: BotSummary[] };
    if (!response.ok) return;
    const remaining = data.bots ?? [];
    setBots(remaining);
    setActiveId(remaining[0]?.id ?? null);
    setPanel(null);
  }

  const sidebar: SidebarBot[] = useMemo(
    () =>
      bots
        .filter((bot) => !query.trim() || bot.name.toLowerCase().includes(query.trim().toLowerCase()))
        .map((bot) => ({ id: bot.id, name: bot.name, color: bot.color, shape: bot.shape, time: sidebarTime(bot.lastMessageAt), preview: bot.preview, typing: busy[bot.id] })),
    [bots, query, busy],
  );
  const active = bots.find((bot) => bot.id === activeId) ?? null;
  const thread = useMemo(() => toThread(activeId ? (threads[activeId] ?? []) : []), [threads, activeId]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <BotWindow
        bots={sidebar}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setPanel(null);
        }}
        onNew={() => setPanel(panel === "new" ? null : "new")}
        thread={thread}
        typing={Boolean(activeId && busy[activeId])}
        person={person}
        query={query}
        onQuery={setQuery}
        className="min-h-0 flex-1"
        headerAction={
          active ? (
            <button type="button" className="bw-icon" aria-label="Bot settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
              <Settings2 size={19} strokeWidth={1.6} />
            </button>
          ) : null
        }
        empty={
          active ? (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
              <MuseFace color={active.color} shape={active.shape} size={64} />
              <p className="text-[17px] text-white/[0.92]">{active.name}</p>
              <p className="text-[15px] leading-relaxed text-white/45">{active.role || "Give this bot a job in its settings, then say hello."}</p>
            </div>
          ) : (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
              <MuseFace light size={64} />
              <p className="text-[17px] text-white/[0.92]">No bots yet</p>
              <button type="button" className="bw-btn bw-btn-primary" onClick={() => setPanel("new")}>
                Create your first bot
              </button>
            </div>
          )
        }
        composer={
          <div>
            {error ? <p className="mb-2 px-2 text-[13px] text-[#f0a3a3]">{error}</p> : null}
            <Composer placeholder={active ? `Message ${active.name}` : "Create a bot first"} disabled={!active} onSend={send} />
          </div>
        }
      />
      {panel === "new" ? <NewBotPanel onClose={() => setPanel(null)} onCreate={createBot} /> : null}
      {panel === "settings" && active ? <SettingsPanel bot={active} models={models} onClose={() => setPanel(null)} onSave={patchBot} onDelete={removeBot} /> : null}
    </div>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="bw absolute inset-y-3 right-3 z-10 flex w-[min(420px,calc(100%-1.5rem))] flex-col rounded-[24px] border border-white/[0.1] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
        <p className="text-[17px]">{title}</p>
        <button type="button" className="bw-icon" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </div>
  );
}

function NewBotPanel({ onClose, onCreate }: { onClose(): void; onCreate(input: Record<string, unknown>): Promise<void> }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [color, setColor] = useState<BotColor>("teal");
  const [shape, setShape] = useState<BotShape>("round");
  const [saving, setSaving] = useState<string | null>(null);
  async function create(input: Record<string, unknown>, key: string) {
    setSaving(key);
    await onCreate(input);
    setSaving(null);
  }
  return (
    <Panel title="New bot" onClose={onClose}>
      {!custom ? (
        <>
          <p className="text-[14px] text-white/50">Pick a job, or start from scratch. You can change everything later.</p>
          <ul className="mt-4 space-y-2">
            {BOT_PRESETS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => create({ preset: preset.id }, preset.id)}
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                >
                  <MuseFace color={preset.color} shape={preset.shape} size={36} className="mt-0.5 flex-none" />
                  <span className="min-w-0">
                    <span className="block text-[16px] text-white/[0.92]">{saving === preset.id ? "Creating…" : preset.name}</span>
                    <span className="mt-0.5 block text-[14px] leading-relaxed text-white/50">{preset.tagline}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="bw-btn mt-4 w-full justify-center" onClick={() => setCustom(true)}>
            Custom bot
          </button>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create({ name, role, color, shape }, "custom");
          }}
        >
          <div className="flex items-center gap-3">
            <MuseFace color={color} shape={shape} size={48} />
            <div className="flex flex-wrap gap-1.5">
              {BOT_COLOR_LIST.map((option) => (
                <button key={option} type="button" aria-label={option} onClick={() => setColor(option)} className={`h-6 w-6 rounded-full border-2 ${color === option ? "border-white" : "border-transparent"}`} style={{ background: BOT_COLORS[option].bg }} />
              ))}
              {BOT_SHAPES.map((option) => (
                <button key={option} type="button" onClick={() => setShape(option)} className={`rounded-full border px-2 text-[12px] ${shape === option ? "border-white text-white" : "border-white/20 text-white/50"}`}>
                  {option}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] text-white/60">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} className="bw-input" placeholder="Product Performance" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-white/60">Job</span>
            <textarea value={role} onChange={(event) => setRole(event.target.value)} rows={6} maxLength={4000} className="bw-input" placeholder="What this bot does, who it works for, how it should write. This becomes its standing instructions." />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="bw-btn bw-btn-primary" disabled={saving !== null || !name.trim()}>
              {saving ? "Creating…" : "Create bot"}
            </button>
            <button type="button" className="bw-btn" onClick={() => setCustom(false)}>
              Back
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function SettingsPanel({ bot, models, onClose, onSave, onDelete }: { bot: BotSummary; models: ModelOption[]; onClose(): void; onSave(input: Record<string, unknown>): Promise<void>; onDelete(): Promise<void> }) {
  const [name, setName] = useState(bot.name);
  const [role, setRole] = useState(bot.role);
  const [color, setColor] = useState<BotColor>(bot.color);
  const [shape, setShape] = useState<BotShape>(bot.shape);
  const [modelMode, setModelMode] = useState<ModelMode>(bot.modelMode);
  const [modelId, setModelId] = useState(bot.modelId ?? models[0]?.id ?? "");
  const [detail, setDetail] = useState<{ maxPerMessage: number; maxPerDay: number; memory: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bot/${bot.id}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { bot?: { maxPerMessage: number; maxPerDay: number; memory: string } }) => {
        if (!cancelled && data.bot) setDetail({ maxPerMessage: data.bot.maxPerMessage, maxPerDay: data.bot.maxPerDay, memory: data.bot.memory });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    await onSave({
      name,
      role,
      color,
      shape,
      modelMode,
      modelId: modelMode === "pinned" ? modelId : null,
      ...(detail ? { maxPerMessage: detail.maxPerMessage, maxPerDay: detail.maxPerDay, memory: detail.memory } : {}),
    });
    setSaving(false);
    onClose();
  }

  return (
    <Panel title="Bot settings" onClose={onClose}>
      <form className="space-y-4" onSubmit={save}>
        <div className="flex items-center gap-3">
          <MuseFace color={color} shape={shape} size={48} />
          <div className="flex flex-wrap gap-1.5">
            {BOT_COLOR_LIST.map((option) => (
              <button key={option} type="button" aria-label={option} onClick={() => setColor(option)} className={`h-6 w-6 rounded-full border-2 ${color === option ? "border-white" : "border-transparent"}`} style={{ background: BOT_COLORS[option].bg }} />
            ))}
            {BOT_SHAPES.map((option) => (
              <button key={option} type="button" onClick={() => setShape(option)} className={`rounded-full border px-2 text-[12px] ${shape === option ? "border-white text-white" : "border-white/20 text-white/50"}`}>
                {option}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] text-white/60">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} className="bw-input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-white/60">Job</span>
          <textarea value={role} onChange={(event) => setRole(event.target.value)} rows={6} maxLength={4000} className="bw-input" />
        </label>
        <div>
          <span className="mb-1 block text-[13px] text-white/60">Model</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(MODEL_MODES) as ModelMode[]).map((mode) => (
              <button key={mode} type="button" onClick={() => setModelMode(mode)} className={`rounded-xl border px-3 py-2 text-left ${modelMode === mode ? "border-white/60 bg-white/[0.06]" : "border-white/[0.1]"}`}>
                <span className="block text-[14px]">{MODEL_MODES[mode].label}</span>
                <span className="block text-[12px] leading-snug text-white/50">{MODEL_MODES[mode].blurb}</span>
              </button>
            ))}
          </div>
          {modelMode === "pinned" ? (
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} className="bw-input mt-2">
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {detail ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[13px] text-white/60">Credits per message</span>
                <input type="number" step="0.5" min={0.05} max={100} value={detail.maxPerMessage} onChange={(event) => setDetail({ ...detail, maxPerMessage: Number(event.target.value) })} className="bw-input" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] text-white/60">Credits per day</span>
                <input type="number" step="5" min={0.5} max={5000} value={detail.maxPerDay} onChange={(event) => setDetail({ ...detail, maxPerDay: Number(event.target.value) })} className="bw-input" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[13px] text-white/60">Memory (what the bot keeps about you)</span>
              <textarea value={detail.memory} onChange={(event) => setDetail({ ...detail, memory: event.target.value })} rows={4} maxLength={2000} className="bw-input" placeholder="Empty. The bot fills this as you talk." />
            </label>
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
          <button type="submit" className="bw-btn bw-btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="bw-btn" onClick={() => void onSave({ clearThread: true })}>
            Clear thread
          </button>
          <button type="button" className={`bw-btn ml-auto ${armed ? "border-[#f0a3a3] text-[#f0a3a3]" : ""}`} onClick={() => (armed ? void onDelete() : setArmed(true))}>
            <Trash2 size={14} className="mr-1.5" />
            {armed ? "Really delete" : "Delete"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
