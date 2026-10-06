"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { saveAutomation } from "@/app/actions";
import { Notice } from "@/components/status";
import { SubmitButton } from "@/components/ui";
import { MODEL_MODES, type ModelMode } from "@/lib/agent/modes";
import { CONNECTION_KINDS, type ConnectionKind } from "@/lib/connections/kinds";
import type { FormCatalog } from "@/lib/queries";

export interface AutomationFormValues {
  id?: string;
  name: string;
  instruction: string;
  triggerType: "manual" | "schedule" | "webhook";
  cron: string;
  connectionIds: string[];
  modelMode: ModelMode;
  modelId: string;
  readerModelId: string;
  maxPerRun: string;
  maxPerMonth: string;
  requireApproval: boolean;
  enabled: boolean;
}

interface ConnectionOption {
  id: string;
  kind: ConnectionKind;
  name: string;
}

type Preset = "15m" | "hourly" | "6h" | "daily" | "weekly" | "custom";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function readCron(cron: string): { preset: Preset; time: string; weekday: string } {
  const fallback = { time: "08:00", weekday: "1" };
  if (cron === "*/15 * * * *") return { preset: "15m", ...fallback };
  if (cron === "0 * * * *") return { preset: "hourly", ...fallback };
  if (cron === "0 */6 * * *") return { preset: "6h", ...fallback };
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(cron);
  if (match) {
    const time = `${match[2]!.padStart(2, "0")}:${match[1]!.padStart(2, "0")}`;
    return match[3] === "*" ? { preset: "daily", time, weekday: "1" } : { preset: "weekly", time, weekday: match[3]! };
  }
  return { preset: cron ? "custom" : "daily", ...fallback };
}

function writeCron(preset: Preset, time: string, weekday: string, custom: string): string {
  const [hour = "8", minute = "0"] = time.split(":").map((part) => String(Number(part)));
  switch (preset) {
    case "15m":
      return "*/15 * * * *";
    case "hourly":
      return "0 * * * *";
    case "6h":
      return "0 */6 * * *";
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${weekday}`;
    case "custom":
      return custom.trim();
  }
}

const TRIGGERS = [
  { value: "schedule", label: "On a schedule", blurb: "Runs by itself at the times you set." },
  { value: "webhook", label: "When a webhook arrives", blurb: "Another service calls a private URL to start it." },
  { value: "manual", label: "Only when I press Run", blurb: "Good for trying a job out first." },
] as const;

export function AutomationForm({
  initial,
  connections,
  catalog,
  wantedKinds = [],
}: {
  initial: AutomationFormValues;
  connections: ConnectionOption[];
  catalog: FormCatalog;
  /** Connection types a template expects, to point out any that are missing. */
  wantedKinds?: ConnectionKind[];
}) {
  const [state, action] = useActionState(saveAutomation, undefined);
  const [name, setName] = useState(initial.name);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [triggerType, setTriggerType] = useState(initial.triggerType);
  const parsedCron = useMemo(() => readCron(initial.cron), [initial.cron]);
  const [preset, setPreset] = useState<Preset>(parsedCron.preset);
  const [time, setTime] = useState(parsedCron.time);
  const [weekday, setWeekday] = useState(parsedCron.weekday);
  const [customCron, setCustomCron] = useState(parsedCron.preset === "custom" ? initial.cron : "0 9 * * 1-5");
  const [selected, setSelected] = useState<string[]>(initial.connectionIds);
  const [modelMode, setModelMode] = useState<ModelMode>(initial.modelMode);
  const [modelId, setModelId] = useState(initial.modelId);
  const [readerModelId, setReaderModelId] = useState(initial.readerModelId);
  const [maxPerRun, setMaxPerRun] = useState(initial.maxPerRun);
  const [maxPerMonth, setMaxPerMonth] = useState(initial.maxPerMonth);
  const [requireApproval, setRequireApproval] = useState(initial.requireApproval);
  // The browser's timezone, read once; the server falls back to UTC if it is missing.
  const [timezone] = useState(() => (typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone));

  const cron = writeCron(preset, time, weekday, customCron);
  const selectedKinds = connections.filter((connection) => selected.includes(connection.id)).map((connection) => connection.kind);
  const missingKinds = wantedKinds.filter((kind) => !connections.some((connection) => connection.kind === kind));
  const abilities = [
    "Read web pages, JSON APIs and RSS feeds",
    "Keep short notes between runs",
    ...selectedKinds.flatMap((kind) => CONNECTION_KINDS[kind].abilities.map((ability) => `${CONNECTION_KINDS[kind].label}: ${ability}`)),
  ];
  const preview = modelMode === "pinned" ? undefined : catalog.preview[modelMode];
  const pinned = catalog.models.find((model) => model.id === modelId);
  const pinnedReader = catalog.models.find((model) => model.id === readerModelId);

  function toggle(connection: ConnectionOption) {
    setSelected((current) => {
      if (current.includes(connection.id)) return current.filter((id) => id !== connection.id);
      // One connection per type: picking a second Telegram replaces the first.
      const sameKind = connections.filter((other) => other.kind === connection.kind).map((other) => other.id);
      return [...current.filter((id) => !sameKind.includes(id)), connection.id];
    });
  }

  return (
    <form action={action} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="timezone" value={timezone} suppressHydrationWarning />
      <input type="hidden" name="cron" value={cron} />
      <input type="hidden" name="enabled" value={initial.enabled ? "on" : "off"} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="connectionIds" value={id} />
      ))}

      <section className="card space-y-5 p-5 sm:p-6">
        <div>
          <p className="eyebrow mb-4">01 · The job</p>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Morning briefing" required />
        </div>
        <div>
          <label className="label" htmlFor="instruction">
            What should the agent do?
          </label>
          <textarea
            id="instruction"
            name="instruction"
            className="input"
            rows={6}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={4000}
            placeholder="Read https://example.com/feed.xml, pick the three most important posts and send me a short summary on Telegram."
            required
          />
          <p className="hint">
            Write it like you would brief a person: where to look, what to decide, where to send the result, and when to do nothing.
          </p>
        </div>
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <p className="eyebrow">02 · Trigger</p>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">When it runs</legend>
          {TRIGGERS.map((trigger) => (
            <label
              key={trigger.value}
              className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                triggerType === trigger.value ? "border-primary bg-primary/10" : "border-line hover:border-line-strong"
              }`}
            >
              <input
                type="radio"
                name="triggerType"
                value={trigger.value}
                checked={triggerType === trigger.value}
                onChange={() => setTriggerType(trigger.value)}
                className="sr-only"
              />
              <span className="block text-[13px] font-medium">{trigger.label}</span>
              <span className="mt-1 block text-xs text-muted">{trigger.blurb}</span>
            </label>
          ))}
        </fieldset>

        {triggerType === "schedule" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="preset">
                How often
              </label>
              <select id="preset" className="input" value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>
                <option value="15m">Every 15 minutes</option>
                <option value="hourly">Every hour</option>
                <option value="6h">Every 6 hours</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="custom">Custom (cron)</option>
              </select>
            </div>
            {preset === "weekly" && (
              <div>
                <label className="label" htmlFor="weekday">
                  Day
                </label>
                <select id="weekday" className="input" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(preset === "daily" || preset === "weekly") && (
              <div>
                <label className="label" htmlFor="time">
                  Time
                </label>
                <input id="time" type="time" className="input" value={time} onChange={(event) => setTime(event.target.value || "08:00")} required />
              </div>
            )}
            {preset === "custom" && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="customCron">
                  Cron expression
                </label>
                <input id="customCron" className="input font-mono" value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="0 9 * * 1-5" />
                <p className="hint">Five fields: minute, hour, day, month, weekday. Runs must be at least 5 minutes apart.</p>
              </div>
            )}
            <p className="hint sm:col-span-3" suppressHydrationWarning>
              Times are in your timezone ({timezone}).
            </p>
          </div>
        )}
        {triggerType === "webhook" && (
          <p className="text-[13px] text-muted">You get a private URL after saving. Whatever is posted to it is handed to the agent as the trigger payload.</p>
        )}
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">03 · Connections</p>
          <Link href="/app/connections" className="text-xs text-primary-soft underline-offset-4 hover:underline">
            Manage connections
          </Link>
        </div>
        {missingKinds.length > 0 && (
          <Notice tone="warning">
            This template needs {missingKinds.map((kind) => CONNECTION_KINDS[kind].label).join(" and ")}. Add{" "}
            {missingKinds.length === 1 ? "it" : "them"} under Connections, then come back. You can save now and link it later.
          </Notice>
        )}
        {connections.length === 0 ? (
          <p className="text-[13px] text-muted">No connections yet. The agent can still read web pages and feeds on its own.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {connections.map((connection) => {
              const on = selected.includes(connection.id);
              return (
                <button
                  key={connection.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(connection)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    on ? "border-primary bg-primary/15 text-foreground" : "border-line text-muted hover:border-line-strong hover:text-foreground"
                  }`}
                >
                  <span className="eyebrow mr-2">{CONNECTION_KINDS[connection.kind].label}</span>
                  {connection.name}
                </button>
              );
            })}
          </div>
        )}
        {connections.length > 0 && selected.length === 0 && (
          <Notice tone="warning">
            Nothing is selected. Click a connection above to let this automation use it. A connection you have added is not used until it is selected here.
          </Notice>
        )}
        <div className="rounded-lg border border-line bg-background p-3">
          <p className="mb-2 text-xs text-muted">With this setup the agent can:</p>
          <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            {abilities.map((ability) => (
              <li key={ability} className="flex items-baseline gap-2">
                <span className="dot flex-none translate-y-[-2px] text-primary-soft" />
                {ability}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <p className="eyebrow">04 · Brain and budget</p>
        {catalog.error && <Notice tone="warning">{catalog.error}</Notice>}
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Model choice</legend>
          {(Object.keys(MODEL_MODES) as ModelMode[]).map((mode) => (
            <label
              key={mode}
              className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                modelMode === mode ? "border-primary bg-primary/10" : "border-line hover:border-line-strong"
              }`}
            >
              <input type="radio" name="modelMode" value={mode} checked={modelMode === mode} onChange={() => setModelMode(mode)} className="sr-only" />
              <span className="block text-[13px] font-medium">{MODEL_MODES[mode].label}</span>
              <span className="mt-1 block text-xs text-muted">{MODEL_MODES[mode].blurb}</span>
            </label>
          ))}
        </fieldset>

        {modelMode === "pinned" ? (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="modelId">
                Brain model
              </label>
              <input
                id="modelId"
                name="modelId"
                list="model-options"
                className="input font-mono"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="Type to search the catalog"
                autoComplete="off"
                spellCheck={false}
              />
              {catalog.suggested.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted">Suggested:</span>
                  {catalog.suggested.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-pressed={modelId === entry.id}
                      onClick={() => setModelId(entry.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        modelId === entry.id ? "border-primary bg-primary/15 text-foreground" : "border-line text-muted hover:border-line-strong hover:text-foreground"
                      }`}
                    >
                      {entry.name} <span className="text-faint">· {entry.note}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="hint">
                {pinned
                  ? `${pinned.name} decides every step: $${pinned.input} in / $${pinned.output} out per million tokens.`
                  : `This model decides every step. ${catalog.models.length} text models available; stronger ones follow instructions more reliably, smaller ones can stumble on the action format.`}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="readerModelId">
                Reading model <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="readerModelId"
                name="readerModelId"
                list="model-options"
                className="input font-mono"
                value={readerModelId}
                onChange={(event) => setReaderModelId(event.target.value)}
                placeholder="Leave empty to use the brain model"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="hint">
                {pinnedReader
                  ? `${pinnedReader.name} condenses long pages and inboxes before the brain sees them: $${pinnedReader.input} in / $${pinnedReader.output} out per million tokens.`
                  : "Condenses long pages and inboxes before the brain sees them. A fast, cheap model here lowers the cost of each run."}
              </p>
            </div>
            <datalist id="model-options">
              {catalog.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · ${model.input} in / ${model.output} out per 1M tokens
                </option>
              ))}
            </datalist>
          </div>
        ) : (
          <>
            <input type="hidden" name="modelId" value="" />
            <input type="hidden" name="readerModelId" value="" />
            {preview && (
              <p className="rounded-lg border border-line bg-background p-3 text-[13px] text-muted">
                Right now this means <span className="text-foreground">{preview.planner}</span> decides
                {preview.reader !== preview.planner && (
                  <>
                    {" "}
                    and <span className="text-foreground">{preview.reader}</span> reads long pages
                  </>
                )}
                . One decision step costs up to about <span className="font-mono text-foreground">{preview.stepCredits}</span> credits; most cost less.
              </p>
            )}
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="maxPerRun">
              Budget per run (credits)
            </label>
            <input id="maxPerRun" name="maxPerRun" className="input font-mono" inputMode="decimal" value={maxPerRun} onChange={(event) => setMaxPerRun(event.target.value)} required />
            <p className="hint">The agent stops before a step that could go over. 100 credits = $1.</p>
          </div>
          <div>
            <label className="label" htmlFor="maxPerMonth">
              Cap per month (credits)
            </label>
            <input id="maxPerMonth" name="maxPerMonth" className="input font-mono" inputMode="decimal" value={maxPerMonth} onChange={(event) => setMaxPerMonth(event.target.value)} required />
            <p className="hint">No more runs start this calendar month once it is reached.</p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            name="requireApproval"
            checked={requireApproval}
            onChange={(event) => setRequireApproval(event.target.checked)}
            className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]"
          />
          <span>
            <span className="block text-[13px] font-medium">Ask me before it sends or changes anything</span>
            <span className="mt-1 block text-xs text-muted">
              The run pauses and shows you the exact message or change. Reading never needs approval. Turn this off once you trust the job.
            </span>
          </span>
        </label>
      </section>

      {state?.error && <Notice>{state.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-primary btn-lg" pendingText="Saving…">
          {initial.id ? "Save changes" : "Create automation"}
        </SubmitButton>
        <Link href={initial.id ? `/app/automations/${initial.id}` : "/app"} className="btn btn-secondary btn-lg">
          Cancel
        </Link>
      </div>
    </form>
  );
}
