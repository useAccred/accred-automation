"use client";

import { Check, ChevronDown, Plus, ShieldCheck, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { lookupAsset, saveTradingAgent } from "@/app/trading-actions";
import { ModelLogo } from "@/components/model-logo";
import { Notice } from "@/components/status";
import { SubmitButton } from "@/components/ui";
import { MODEL_MODES, type ModelMode } from "@/lib/agent/modes";
import { CONNECTION_KINDS, type ConnectionKind } from "@/lib/connections/kinds";
import { modelBrand } from "@/lib/model-brand";
import type { FormCatalog } from "@/lib/queries";
import { compactUsd, fmtUsd, shortAddress } from "@/lib/trading/format";
import { NETWORK, PRESETS, positionCapUsd, presetMandate, profileOf, type Mandate, type MandateAsset, type RiskProfile } from "@/lib/trading/mandate";
import { ESSENTIAL_FIELDS, ESSENTIAL_KEYS, INTERVALS, MANDATE_GROUPS, NUMERIC_KEYS, minimumsToFit, type AssetFacts } from "@/lib/trading/mandate-fields";
import type { AssetOption } from "@/lib/trading/market-data";
import { PERMISSIONS, PERMISSION_LIST, REQUIRED_WITH_EXECUTE, type Permission } from "@/lib/trading/permissions";
import { marketFilterFailure } from "@/lib/trading/risk-engine";
import { STRATEGIES, STRATEGY_KINDS, type StrategyKind } from "@/lib/trading/strategy";

export interface TradingFormValues {
  id?: string;
  name: string;
  walletId: string;
  modelMode: ModelMode;
  modelId: string;
  maxPerRun: string;
  maxPerMonth: string;
  intervalMinutes: number;
  strategies: StrategyKind[];
  instructions: string;
  mandate: Mandate;
  permissions: Permission[];
  connectionIds: string[];
}

export interface WalletOption {
  id: string;
  name: string;
  address: string;
  /** Null when the chain could not be read. */
  balanceUsd: number | null;
  /** USDG in the wallet: what positions are bought with. Null when the chain could not be read. */
  usdg: number | null;
  revoked: boolean;
}

type NumericKey = (typeof NUMERIC_KEYS)[number];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${on ? "border-primary bg-primary/15 text-foreground" : "border-line text-muted hover:border-line-strong hover:text-foreground"}`;
/** Where a model sits by price, in the words a first-time user would use. */
const priceTier = (outputUsdPerMillion: string) => (Number(outputUsdPerMillion) >= 16 ? "Premium" : Number(outputUsdPerMillion) > 5 ? "Balanced" : "Low cost");
const tile = (on: boolean) => `cursor-pointer rounded-lg border p-3 text-left transition-colors ${on ? "border-primary bg-primary/10" : "border-line hover:border-line-strong"}`;

export function TradingForm({
  initial,
  wallets,
  connections,
  catalog,
  topAssets,
  assetFacts = {},
  openPositions = 0,
  liveEnabled,
}: {
  initial: TradingFormValues;
  wallets: WalletOption[];
  connections: Array<{ id: string; kind: ConnectionKind; name: string }>;
  catalog: FormCatalog;
  topAssets: AssetOption[];
  /** Market facts for assets already on the allowlist, so the form can say whether each would pass the filters. */
  assetFacts?: Record<string, AssetFacts>;
  openPositions?: number;
  /** Whether this server may trade with real funds. */
  liveEnabled: boolean;
}) {
  const editing = Boolean(initial.id);
  const [state, action] = useActionState(saveTradingAgent, undefined);
  const [name, setName] = useState(initial.name);
  const [walletId, setWalletId] = useState(initial.walletId);
  const [modelMode, setModelMode] = useState<ModelMode>(initial.modelMode);
  const [modelId, setModelId] = useState(initial.modelId);
  const [maxPerRun, setMaxPerRun] = useState(initial.maxPerRun);
  const [maxPerMonth, setMaxPerMonth] = useState(initial.maxPerMonth);
  const [intervalMinutes, setIntervalMinutes] = useState(initial.intervalMinutes);
  const [strategies, setStrategies] = useState<StrategyKind[]>(initial.strategies);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [numbers, setNumbers] = useState<Record<NumericKey, string>>(
    () => Object.fromEntries(NUMERIC_KEYS.map((key) => [key, String(initial.mandate[key])])) as Record<NumericKey, string>,
  );
  const [stopLossRequired, setStopLossRequired] = useState(initial.mandate.stopLossRequired);
  const [hours, setHours] = useState(initial.mandate.tradingHours);
  const [assets, setAssets] = useState<MandateAsset[]>(initial.mandate.allowedAssets);
  const [blocked, setBlocked] = useState(initial.mandate.blockedAssets.join("\n"));
  const [permissions, setPermissions] = useState<Permission[]>(initial.permissions);
  const [selected, setSelected] = useState<string[]>(initial.connectionIds);
  const [facts, setFacts] = useState<Record<string, AssetFacts>>(() => ({ ...Object.fromEntries(topAssets.map((asset) => [asset.address, asset])), ...assetFacts }));
  const [now] = useState(() => Date.now());
  const [customAddress, setCustomAddress] = useState("");
  const [lookupError, setLookupError] = useState<string>();
  const [looking, startLookup] = useTransition();
  const [timezone] = useState(() => (typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone));

  // The mandate exactly as it will be saved. An empty field becomes null and the server refuses it.
  const mandate = {
    ...Object.fromEntries(NUMERIC_KEYS.map((key) => [key, numbers[key].trim() === "" ? NaN : Number(numbers[key])])),
    mode: "live",
    tradingEnabled: true,
    allowedNetwork: NETWORK,
    stopLossRequired,
    tradingHours: hours,
    allowedAssets: assets,
    blockedAssets: blocked
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  } as Mandate;
  const complete = NUMERIC_KEYS.every((key) => Number.isFinite(mandate[key]));
  const profile: RiskProfile = complete ? profileOf(mandate) : "custom";
  const wallet = wallets.find((option) => option.id === walletId);
  const allocation = mandate.agentAllocationUsd;
  const cap = complete ? positionCapUsd(mandate) : NaN;
  const pinned = modelMode === "pinned";
  const chosen = catalog.models.find((model) => model.id === modelId);
  const execute = permissions.includes("EXECUTE_TRADE");

  const setNumber = (key: NumericKey, value: string) => setNumbers((current) => ({ ...current, [key]: value }));

  /** Why the market filters would turn an asset away right now, by the rule the risk engine itself applies. Undefined when its figures are not known. */
  function blocker(address: string): string | null | undefined {
    const known = facts[address];
    if (!known || !complete) return undefined;
    return marketFilterFailure(mandate, { network: NETWORK, priceUsd: 1, liquidityUsd: known.liquidityUsd, marketCapUsd: known.marketCapUsd, pairCreatedAt: known.pairCreatedAt, fetchedAt: now }, now);
  }

  function fitMinimums(address: string) {
    const known = facts[address];
    if (!known) return;
    setNumbers((current) => ({ ...current, ...Object.fromEntries(Object.entries(minimumsToFit(known, mandate, now)).map(([key, value]) => [key, String(value)])) }));
  }

  const targetShort = complete && mandate.defaultTakeProfitPercent < mandate.defaultStopLossPercent * mandate.minimumRiskReward;
  const stopTooWide = complete && mandate.defaultStopLossPercent > mandate.maxStopLossPercent;

  function applyPreset(next: Exclude<RiskProfile, "custom">) {
    const filled = presetMandate(next, Number.isFinite(allocation) && allocation > 0 ? allocation : 1000);
    setNumbers((current) => ({ ...current, ...Object.fromEntries(NUMERIC_KEYS.filter((key) => key !== "agentAllocationUsd" && key !== "reserveUsd").map((key) => [key, String(filled[key])])) }));
    setStopLossRequired(filled.stopLossRequired);
  }

  function toggleAsset(asset: AssetOption | MandateAsset) {
    setAssets((current) => (current.some((entry) => entry.address === asset.address) ? current.filter((entry) => entry.address !== asset.address) : [...current, { address: asset.address, symbol: asset.symbol }]));
  }

  function togglePermission(permission: Permission) {
    setPermissions((current) => {
      if (current.includes(permission)) {
        // Without the right to protect and close positions, the right to open them goes too.
        const next = current.filter((entry) => entry !== permission);
        return REQUIRED_WITH_EXECUTE.includes(permission) ? next.filter((entry) => entry !== "EXECUTE_TRADE") : next;
      }
      return permission === "EXECUTE_TRADE" ? [...new Set([...current, ...REQUIRED_WITH_EXECUTE, permission])] : [...current, permission];
    });
  }

  function addCustomAsset() {
    setLookupError(undefined);
    startLookup(async () => {
      const result = await lookupAsset(customAddress);
      if (result.error || !result.asset) return setLookupError(result.error ?? "That token could not be found.");
      const found = result.asset;
      setFacts((current) => ({ ...current, [found.address]: found }));
      setAssets((current) => (current.some((entry) => entry.address === found.address) ? current : [...current, { address: found.address, symbol: found.symbol }]));
      setCustomAddress("");
    });
  }

  return (
    <form action={action} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="timezone" value={timezone} suppressHydrationWarning />
      <input type="hidden" name="walletId" value={walletId} />
      <input type="hidden" name="mandate" value={JSON.stringify(mandate)} />
      <input type="hidden" name="modelMode" value={modelMode} />
      <input type="hidden" name="modelId" value={pinned ? modelId : ""} />
      {strategies.map((kind) => (
        <input key={kind} type="hidden" name="strategies" value={kind} />
      ))}
      {permissions.map((permission) => (
        <input key={permission} type="hidden" name="permissions" value={permission} />
      ))}
      {selected.map((id) => (
        <input key={id} type="hidden" name="connectionIds" value={id} />
      ))}

      <section className="card space-y-5 p-5 sm:p-6">
        <p className="eyebrow">01 · Agent and model</p>
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Momentum on Robinhood Chain" required />
        </div>
        {catalog.error && <Notice tone="warning">{catalog.error}</Notice>}
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="label">AI model · let Accred pick</legend>
          {(["auto", "economy", "quality"] as const).map((mode) => {
            const pick = catalog.preview[mode];
            return (
              <button key={mode} type="button" aria-pressed={modelMode === mode} onClick={() => setModelMode(mode)} className={tile(modelMode === mode)}>
                <span className="block text-[13px] font-medium">{MODEL_MODES[mode].label}</span>
                <span className="mt-1 block text-xs text-muted">
                  {mode === "auto" && "A strong model studies the market each cycle."}
                  {mode === "economy" && "A fast, cheap model. Lowest cost per cycle."}
                  {mode === "quality" && "A top model. Costs several times more per cycle."}
                </span>
                {pick && (
                  <span className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                    <ModelLogo modelId={pick.plannerId} size={16} />
                    <span className="truncate">
                      Now: <span className="text-foreground">{pick.planner}</span>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </fieldset>
        {catalog.featured.length > 0 && (
          <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="label">Or choose the model yourself</legend>
            {catalog.featured.map((model) => {
              const on = pinned && modelId === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setModelMode("pinned");
                    setModelId(model.id);
                  }}
                  className={`${tile(on)} flex items-start gap-3`}
                >
                  <ModelLogo modelId={model.id} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{model.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {modelBrand(model.id)?.label ?? "Other"} · {priceTier(model.output)}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-muted">
                      ${model.input} in / ${model.output} out
                    </span>
                  </span>
                </button>
              );
            })}
          </fieldset>
        )}
        {catalog.models.length > 0 && (
          <div>
            <label className="label" htmlFor="modelSearch">
              Any other model · search all {catalog.models.length}
            </label>
            <div className="flex items-center gap-2">
              <ModelLogo modelId={pinned ? modelId : ""} size={30} />
              <input
                id="modelSearch"
                list="trading-model-options"
                className="input font-mono"
                value={pinned ? modelId : ""}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setModelMode(event.target.value ? "pinned" : "auto");
                }}
                placeholder="Type a name, for example grok or deepseek"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <datalist id="trading-model-options">
              {catalog.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · ${model.input} in / ${model.output} out per 1M tokens
                </option>
              ))}
            </datalist>
            {pinned && modelId && !chosen && <p className="hint">Choose a model from the list to continue. What is typed here is not a model in the catalog.</p>}
          </div>
        )}
        <p className="hint">Prices are US dollars per 1 million tokens, paid from your Accred credits. The model only proposes trades. It holds no keys and cannot move funds.</p>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">02 · Dedicated wallet</p>
          <Link href="/app/trading/wallets" className="text-xs text-primary-soft underline-offset-4 hover:underline">
            Manage wallets
          </Link>
        </div>
        {wallets.length === 0 ? (
          <Notice tone="warning">
            You have no trading wallet yet.{" "}
            <Link href="/app/trading/wallets" className="underline underline-offset-4">
              Create a dedicated wallet
            </Link>{" "}
            first, then come back. Never use your main wallet for an agent.
          </Notice>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {wallets.map((option) => (
              <button key={option.id} type="button" disabled={option.revoked} aria-pressed={walletId === option.id} onClick={() => setWalletId(option.id)} className={`${tile(walletId === option.id)} disabled:cursor-not-allowed disabled:opacity-50`}>
                <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                  {option.name}
                  <span className="font-mono text-xs text-muted">{option.balanceUsd === null ? "balance unavailable" : fmtUsd(option.balanceUsd)}</span>
                </span>
                <span className="mt-1 block font-mono text-xs text-muted">{shortAddress(option.address)}</span>
                {option.revoked && <span className="mt-1 block text-xs text-warning">Trading authority revoked</span>}
              </button>
            ))}
          </div>
        )}
        <p className="hint">
          Deposits and withdrawals are on the Wallets page. The wallet needs USDG to buy positions with and a little ETH for network fees before the agent can trade.
        </p>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <p className="eyebrow">03 · Agent allocation</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="agentAllocationUsd">
              The most the agent may deploy ($)
            </label>
            <input id="agentAllocationUsd" className="input font-mono" inputMode="decimal" value={numbers.agentAllocationUsd} onChange={(event) => setNumber("agentAllocationUsd", event.target.value)} required />
            <p className="hint">A hard cap. Profits are not added to it, and it is never raised without your approval.</p>
          </div>
          <div className="rounded-lg border border-line bg-background p-3 text-[13px]">
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Wallet balance</dt>
                <dd className="font-mono">{wallet ? (wallet.balanceUsd === null ? "unavailable" : fmtUsd(wallet.balanceUsd)) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Agent allocation</dt>
                <dd className="font-mono">{fmtUsd(allocation)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Outside the agent&apos;s reach</dt>
                <dd className="font-mono">{wallet && wallet.balanceUsd !== null && Number.isFinite(allocation) ? fmtUsd(Math.max(0, wallet.balanceUsd - allocation)) : "—"}</dd>
              </div>
            </dl>
            <div className="mt-1.5 flex justify-between gap-3 border-t border-line pt-1.5">
              <span className="text-muted">USDG in the wallet</span>
              <span className="font-mono">{wallet ? (wallet.usdg === null ? "unavailable" : fmtUsd(wallet.usdg)) : "—"}</span>
            </div>
            <p className="mt-2 text-xs text-muted">Positions are bought with the wallet&apos;s USDG. A trade larger than the USDG the wallet really holds is refused.</p>
            {wallet && wallet.usdg !== null && Number.isFinite(allocation) && allocation > wallet.usdg && (
              <p className="mt-2 text-xs text-warning">The wallet holds less USDG than this allocation. Deposit more, or the agent can only use what is there.</p>
            )}
          </div>
        </div>
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <p className="eyebrow">04 · Strategy</p>
        <div>
          <p className="label">What the agent looks for</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STRATEGY_KINDS.map((kind) => {
              const on = strategies.includes(kind);
              return (
                <button key={kind} type="button" aria-pressed={on} onClick={() => setStrategies((current) => (on ? current.filter((entry) => entry !== kind) : [...current, kind]))} className={tile(on)}>
                  <span className="block text-[13px] font-medium">{STRATEGIES[kind].label}</span>
                  <span className="mt-1 block text-xs text-muted">{STRATEGIES[kind].blurb}</span>
                  <span className="mt-1.5 block text-[11px] text-faint">Screen: {STRATEGIES[kind].rule}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">Each strategy is a fixed screen that runs first. The model is only called, and credits only spent, when an asset passes one.</p>
        </div>
        <div>
          <label className="label" htmlFor="instructions">
            In your own words <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="instructions"
            name="instructions"
            className="input"
            rows={4}
            maxLength={2000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Trade momentum opportunities on Robinhood Chain. Avoid illiquid assets. Prefer setups where volume is rising with price."
          />
          <p className="hint">This guides what the model proposes. It can never override the mandate below: a proposal outside your limits is rejected whatever the instructions say.</p>
        </div>
        <div className="max-w-xs">
          <label className="label" htmlFor="intervalMinutes">
            How often it looks at the market
          </label>
          <select id="intervalMinutes" name="intervalMinutes" className="input" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>
            {INTERVALS.map((interval) => (
              <option key={interval.minutes} value={interval.minutes}>
                {interval.label}
              </option>
            ))}
          </select>
          <p className="hint">Stops and targets are checked about every 20 seconds, whatever you choose here.</p>
        </div>
      </section>

      <section className="card space-y-6 p-5 sm:p-6">
        <div>
          <p className="eyebrow">05 · Risk mandate</p>
          <p className="mt-2 max-w-2xl text-[13px] text-muted">
            These are hard limits enforced by the backend, not suggestions to the model. A profile only fills in the fields below. There are no rules you cannot see.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {(Object.keys(PRESETS) as Array<Exclude<RiskProfile, "custom">>).map((key) => (
            <button key={key} type="button" aria-pressed={profile === key} onClick={() => applyPreset(key)} className={tile(profile === key)}>
              <span className="block text-[13px] font-medium">{PRESETS[key].label}</span>
              <span className="mt-1 block text-xs text-muted">{PRESETS[key].blurb}</span>
            </button>
          ))}
          <div className={`${tile(profile === "custom")} cursor-default`} aria-current={profile === "custom"}>
            <span className="block text-[13px] font-medium">Custom</span>
            <span className="mt-1 block text-xs text-muted">Selected as soon as you edit any limit.</span>
          </div>
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium">The limits that matter most</legend>
          <p className="mb-3 mt-0.5 text-xs text-muted">Check these six. Everything else is filled in by the profile above and can stay as it is.</p>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {ESSENTIAL_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="label" htmlFor={field.key}>
                  {field.label} {field.unit && <span className="font-normal text-muted">({field.unit})</span>}
                </label>
                <input id={field.key} className="input font-mono" inputMode="decimal" value={numbers[field.key]} onChange={(event) => setNumber(field.key, event.target.value)} required />
                <p className="hint">{field.hint}</p>
              </div>
            ))}
          </div>
          {targetShort && (
            <p className="mt-3 text-xs text-warning">
              With a {mandate.defaultStopLossPercent}% stop loss, the take profit must be at least {+(mandate.defaultStopLossPercent * mandate.minimumRiskReward).toFixed(2)}% (your minimum risk/reward is {mandate.minimumRiskReward}×). Otherwise trades
              that use these defaults are rejected.
            </p>
          )}
          {stopTooWide && (
            <p className="mt-3 text-xs text-warning">
              The stop loss is wider than the widest stop allowed ({mandate.maxStopLossPercent}%). Raise &ldquo;Widest stop loss&rdquo; under All other limits, or narrow the stop.
            </p>
          )}
        </fieldset>
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
            <span>
              All other limits <span className="font-normal text-muted">· {NUMERIC_KEYS.length - 1 - ESSENTIAL_KEYS.length} more, set by the profile</span>
            </span>
            <ChevronDown size={15} className="text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-6 border-t border-line p-3 sm:p-4">
          {MANDATE_GROUPS.map((group) => (
            <fieldset key={group.id}>
              <legend className="text-[13px] font-medium">{group.title}</legend>
              <p className="mb-3 mt-0.5 text-xs text-muted">{group.blurb}</p>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields
                  .filter((field) => !ESSENTIAL_KEYS.includes(field.key))
                  .map((field) => (
                  <div key={field.key}>
                    <label className="label" htmlFor={field.key}>
                      {field.label} {field.unit && <span className="font-normal text-muted">({field.unit})</span>}
                    </label>
                    <input id={field.key} className="input font-mono" inputMode="decimal" value={numbers[field.key]} onChange={(event) => setNumber(field.key, event.target.value)} />
                    <p className="hint">{field.hint}</p>
                  </div>
                ))}
              </div>
              {group.id === "position" && (
                <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
                  <input type="checkbox" checked={stopLossRequired} onChange={(event) => setStopLossRequired(event.target.checked)} className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" />
                  <span>
                    <span className="block text-[13px] font-medium">Every proposal must state its stop loss</span>
                    <span className="mt-1 block text-xs text-muted">A proposal without one is rejected. When off, the default stop loss is applied instead. Either way, no position is ever open without a stop.</span>
                  </span>
                </label>
              )}
              {group.id === "time" && (
                <div className="mt-3 rounded-lg border border-line p-3">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="checkbox" checked={hours.enabled} onChange={(event) => setHours({ ...hours, enabled: event.target.checked })} className="size-4 accent-[hsl(224_83%_51%)]" />
                    <span className="text-[13px] font-medium">Only open positions during set hours</span>
                  </label>
                  {hours.enabled && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <div>
                        <label className="label" htmlFor="startHour">
                          From
                        </label>
                        <select id="startHour" className="input" value={hours.startHour} onChange={(event) => setHours({ ...hours, startHour: Number(event.target.value) })}>
                          {Array.from({ length: 24 }, (_, hour) => (
                            <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor="endHour">
                          Until
                        </label>
                        <select id="endHour" className="input" value={hours.endHour} onChange={(event) => setHours({ ...hours, endHour: Number(event.target.value) })}>
                          {Array.from({ length: 24 }, (_, hour) => (
                            <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:59`}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAYS.map((day, index) => {
                          const on = hours.days.includes(index);
                          return (
                            <button key={day} type="button" aria-pressed={on} onClick={() => setHours({ ...hours, days: on ? hours.days.filter((entry) => entry !== index) : [...hours.days, index].sort() })} className={chip(on)}>
                              {day}
                            </button>
                          );
                        })}
                      </div>
                      <p className="hint basis-full" suppressHydrationWarning>
                        In your timezone ({timezone}). Exits are enforced at all hours.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          ))}
          </div>
        </details>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div>
          <p className="eyebrow">06 · Assets</p>
          <p className="mt-2 text-[13px] text-muted">The agent may only trade what you select here, on Robinhood Chain. Nothing is allowed by default.</p>
        </div>
        {assets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {assets.map((asset) => (
              <button key={asset.address} type="button" onClick={() => toggleAsset(asset)} className={chip(true)} title={asset.address}>
                {asset.symbol} <span className="ml-1 font-mono text-[11px] text-muted">{shortAddress(asset.address)}</span>
                <X size={12} className="ml-1.5 inline" aria-label={`Remove ${asset.symbol}`} />
              </button>
            ))}
          </div>
        )}
        {assets.length > 0 && (
          <ul className="space-y-2">
            {assets.map((asset) => {
              const reason = blocker(asset.address);
              if (reason === undefined) return null;
              return reason === null ? (
                <li key={asset.address} className="flex items-center gap-2 text-xs text-success">
                  <Check size={13} className="flex-none" />
                  <span>
                    <span className="font-medium">{asset.symbol}</span> passes your market filters. The agent can trade it.
                  </span>
                </li>
              ) : (
                <li key={asset.address} className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p className="flex items-start gap-2 text-warning">
                    <TriangleAlert size={13} className="mt-0.5 flex-none" />
                    <span>
                      <span className="font-medium">{asset.symbol} will not be traded with your current limits.</span> {reason}.
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 pl-5">
                    <button type="button" className="btn btn-secondary" onClick={() => fitMinimums(asset.address)}>
                      Lower my minimums so it can trade
                    </button>
                    <span className="text-muted">This loosens a safety filter. Small pools cost more to buy and sell.</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {topAssets.length > 0 ? (
          <div>
            <p className="mb-2 text-xs text-muted">Most traded on Robinhood Chain right now, by pool depth:</p>
            <div className="flex flex-wrap gap-2">
              {topAssets
                .filter((asset) => !assets.some((entry) => entry.address === asset.address))
                .map((asset) => (
                  <button key={asset.address} type="button" onClick={() => toggleAsset(asset)} className={chip(false)} title={`${asset.name} · ${asset.address}`}>
                    <Plus size={12} className="mr-1 inline" />
                    {asset.symbol} <span className="ml-1 text-[11px] text-faint">{compactUsd(asset.liquidityUsd)} liquidity</span>
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">The asset list could not be loaded right now. You can still add a token by its address.</p>
        )}
        <div>
          <label className="label" htmlFor="customAddress">
            Add a token by address
          </label>
          <div className="flex gap-2">
            <input id="customAddress" className="input font-mono" value={customAddress} onChange={(event) => setCustomAddress(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
            <button type="button" className="btn btn-secondary flex-none" onClick={addCustomAsset} disabled={looking || !customAddress.trim()}>
              {looking ? "Checking…" : "Add"}
            </button>
          </div>
          {lookupError && <p className="mt-1.5 text-xs text-danger">{lookupError}</p>}
        </div>
        <div>
          <label className="label" htmlFor="blocked">
            Blocklist <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id="blocked" className="input font-mono text-xs" rows={2} value={blocked} onChange={(event) => setBlocked(event.target.value)} placeholder="Token addresses the agent must never trade, one per line" spellCheck={false} />
        </div>
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <p className="eyebrow">07 · Mode</p>
        <div className={tile(true)}>
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <ShieldCheck size={14} className="text-success" /> Live on Robinhood Chain mainnet
            <span className="eyebrow">Chain ID 4663 · real funds</span>
          </span>
          <span className="mt-1 block text-xs text-muted">
            Every trade is a real swap from this agent&apos;s wallet. Each one is simulated on the chain from the wallet first and only signed if that passes. Profit and loss come from what the transactions actually moved.
          </span>
        </div>
        {!liveEnabled && <Notice tone="warning">Live trading is switched off on this server, so an agent cannot be started yet.</Notice>}
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <p className="eyebrow">08 · Notifications and credits</p>
        {connections.length === 0 ? (
          <p className="text-[13px] text-muted">
            No connections yet.{" "}
            <Link href="/app/connections" className="text-primary-soft underline-offset-4 hover:underline">
              Add Telegram, Slack or Discord
            </Link>{" "}
            to be told about trades, rejections, stops and automatic pauses.
          </p>
        ) : (
          <div>
            <p className="label">Send notices to</p>
            <div className="flex flex-wrap gap-2">
              {connections.map((connection) => {
                const on = selected.includes(connection.id);
                return (
                  <button key={connection.id} type="button" aria-pressed={on} onClick={() => setSelected((current) => (on ? current.filter((id) => id !== connection.id) : [...current, connection.id]))} className={chip(on)}>
                    <span className="eyebrow mr-2">{CONNECTION_KINDS[connection.kind].label}</span>
                    {connection.name}
                  </button>
                );
              })}
            </div>
            <p className="hint">Executions, rejections, stop loss and take profit, loss limits, automatic pauses, failures and manual stops. A connection can only carry messages out. It never grants trading authority.</p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="maxPerRun">
              Credit budget per cycle
            </label>
            <input id="maxPerRun" name="maxPerRun" className="input font-mono" inputMode="decimal" value={maxPerRun} onChange={(event) => setMaxPerRun(event.target.value)} required />
            <p className="hint">The model is not called if the call could cost more. 100 credits = $1.</p>
          </div>
          <div>
            <label className="label" htmlFor="maxPerMonth">
              Credit cap per month
            </label>
            <input id="maxPerMonth" name="maxPerMonth" className="input font-mono" inputMode="decimal" value={maxPerMonth} onChange={(event) => setMaxPerMonth(event.target.value)} required />
            <p className="hint">The agent stops asking the model once this is reached. Open positions stay protected.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-5 p-5 sm:p-6">
        <div>
          <p className="eyebrow">09 · Review permissions and limits</p>
          <p className="mt-2 text-[13px] text-muted">You are defining exactly how this agent can trade. It gets a mandate, not access to your wallet.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PERMISSION_LIST.map((permission) => {
            const on = permissions.includes(permission);
            const locked = execute && REQUIRED_WITH_EXECUTE.includes(permission);
            return (
              <label key={permission} className={`flex items-start gap-3 rounded-lg border p-3 ${on ? "border-line-strong" : "border-line"} ${locked ? "" : "cursor-pointer"}`}>
                <input type="checkbox" checked={on} disabled={locked} onChange={() => togglePermission(permission)} className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" />
                <span>
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {PERMISSIONS[permission].label}
                    {PERMISSIONS[permission].sensitive && <span className="eyebrow !text-warning">Sensitive</span>}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{PERMISSIONS[permission].detail}</span>
                  <span className="mt-1 block font-mono text-[10px] text-faint">{permission}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="rounded-lg border border-line bg-background p-4">
          <p className="mb-2 text-xs text-muted">With this mandate the agent:</p>
          <ul className="space-y-1.5 text-[13px]">
            {[
              `Trades with real funds on Robinhood Chain mainnet. Every swap is simulated on the chain before it is signed.`,
              `Deploys at most ${fmtUsd(allocation)}${Number.isFinite(mandate.reserveUsd) && mandate.reserveUsd > 0 ? `, keeping ${fmtUsd(mandate.reserveUsd)} of that in reserve` : ""}. Everything else in the wallet is outside its reach.`,
              `Opens at most ${numbers.maxOpenPositions} positions at once, none larger than ${fmtUsd(cap)}, with at most ${numbers.maxTotalExposurePercent}% of the allocation exposed.`,
              `Risks at most ${fmtUsd((allocation * mandate.maxLossPerTradePercent) / 100)} per trade, and stops for the day after losing ${fmtUsd((allocation * mandate.dailyLossLimitPercent) / 100)}.`,
              `Pauses itself at a ${numbers.maxDrawdownPercent}% drawdown or after ${numbers.maxConsecutiveLosses} losses in a row.`,
              `Trades only ${assets.length ? assets.map((asset) => asset.symbol).join(", ") : "(no assets selected yet)"} on Robinhood Chain, at most ${numbers.maxTradesPerDay} times a day.`,
              `Can be paused, closed out or have its access revoked by you at any moment.`,
            ].map((line) => (
              <li key={line} className="flex items-baseline gap-2">
                <span className="dot flex-none translate-y-[-2px] text-primary-soft" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        {state?.riskIncreases && state.riskIncreases.length > 0 && (
          <div className="rounded-lg border border-warning/35 bg-warning/10 p-4">
            <p className="text-[13px] font-medium text-warning">These changes let the agent risk more than before</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]">
              {state.riskIncreases.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <label className="mt-3 flex cursor-pointer items-center gap-3 text-[13px]">
              <input type="checkbox" name="confirmRisk" className="size-4 accent-[hsl(224_83%_51%)]" />I understand and approve these increases
            </label>
          </div>
        )}
        {editing && openPositions > 0 && (
          <Notice tone="warning">
            {openPositions} position{openPositions === 1 ? " is" : "s are"} open. Open positions keep the exit rules of the mandate version that approved them. Changes apply to new trades.
          </Notice>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3">
          <input type="checkbox" name="approve" className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" required />
          <span>
            <span className="block text-[13px] font-medium">I have reviewed these permissions and limits and approve them</span>
            <span className="mt-1 block text-xs text-muted">
              {editing ? "Saving creates a new version of the mandate. Every trade records the version that approved it." : "The agent starts trading as soon as you approve. You can pause it at any time."}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-danger/30 p-3">
          <input type="checkbox" name="confirmLive" className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" required />
          <span>
            <span className="block text-[13px] font-medium">I understand this agent trades real funds from its wallet</span>
            <span className="mt-1 block text-xs text-muted">Losses are real and trades on the chain cannot be undone. The limits above cap what it can lose, they do not prevent loss.</span>
          </span>
        </label>
      </section>

      {state?.error && <Notice tone={state.riskIncreases ? "warning" : "danger"}>{state.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-primary btn-lg" pendingText="Saving…" disabled={wallets.length === 0 || !liveEnabled}>
          {editing ? "Approve and save changes" : "Approve and start trading"}
        </SubmitButton>
        <Link href={initial.id ? `/app/trading/${initial.id}` : "/app/trading"} className="btn btn-secondary btn-lg">
          Cancel
        </Link>
      </div>
    </form>
  );
}
