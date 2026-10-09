"use client";

import { useActionState, useState } from "react";
import { createTradingWallet, deleteTradingAgent, importTradingWallet, removeTradingWallet, withdrawFromWallet } from "@/app/trading-actions";
import { Notice } from "@/components/status";
import { ConfirmButton, SubmitButton } from "@/components/ui";

const EXPLORER = "https://robin.etherscan.io";

export function CreateWalletForm() {
  const [state, action] = useActionState(createTradingWallet, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="create-name">
          Name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="create-name" name="name" className="input" maxLength={60} placeholder="Momentum agent wallet" />
      </div>
      {state?.error && <Notice>{state.error}</Notice>}
      {state?.values?.created && <Notice tone="success">Wallet created. Its address is listed below.</Notice>}
      <SubmitButton pendingText="Creating…">Create wallet</SubmitButton>
      <p className="hint">A new key is generated on the server and stored encrypted. It is never shown, never given to a model and never written to a log.</p>
    </form>
  );
}

export function ImportWalletForm() {
  const [state, action] = useActionState(importTradingWallet, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="import-name">
          Name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="import-name" name="name" className="input" maxLength={60} placeholder="Imported agent wallet" />
      </div>
      <div>
        <label className="label" htmlFor="import-key">
          Private key
        </label>
        <input id="import-key" name="privateKey" type="password" className="input font-mono" placeholder="0x…" autoComplete="off" spellCheck={false} required />
        <p className="hint">Sent once over HTTPS, stored encrypted, and never shown again.</p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-[13px]">
        <input type="checkbox" name="dedicated" className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" required />
        <span>This wallet was made only for this agent. It is not my main wallet and holds nothing I am not prepared to allocate.</span>
      </label>
      {state?.error && <Notice>{state.error}</Notice>}
      {state?.values?.created && <Notice tone="success">Wallet imported.</Notice>}
      <SubmitButton className="btn btn-secondary" pendingText="Importing…">
        Import wallet
      </SubmitButton>
    </form>
  );
}

export function WithdrawForm({ walletId, emergency = false }: { walletId: string; emergency?: boolean }) {
  const [state, action] = useActionState(withdrawFromWallet, undefined);
  const [amount, setAmount] = useState(emergency ? "max" : "");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="walletId" value={walletId} />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <label className="label" htmlFor={`asset-${walletId}`}>
            Asset
          </label>
          <select id={`asset-${walletId}`} name="asset" className="input" defaultValue="USDG">
            <option value="USDG">USDG</option>
            <option value="ETH">ETH</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`amount-${walletId}`}>
            Amount
          </label>
          <div className="flex gap-2">
            <input id={`amount-${walletId}`} name="amount" className="input font-mono" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
            <button type="button" className="btn btn-secondary flex-none" onClick={() => setAmount("max")}>
              Max
            </button>
          </div>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`to-${walletId}`}>
          Send to
        </label>
        <input id={`to-${walletId}`} name="to" className="input font-mono" placeholder="0x… address on Robinhood Chain" spellCheck={false} autoComplete="off" required />
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-[13px]">
        <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-[hsl(224_83%_51%)]" required />
        <span>I have checked the address. A transfer on Robinhood Chain cannot be undone.</span>
      </label>
      {state?.error && <Notice>{state.error}</Notice>}
      {state?.values?.hash && (
        <Notice tone="success">
          Sent {state.values.amount} {state.values.asset}.{" "}
          <a href={`${EXPLORER}/tx/${state.values.hash}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            View the transaction
          </a>
        </Notice>
      )}
      <SubmitButton className="btn btn-secondary" pendingText="Simulating and sending…">
        Withdraw
      </SubmitButton>
      <p className="hint">The transfer is simulated against the chain first and only signed if that passes. Gas is paid in ETH, so withdraw ETH last.</p>
    </form>
  );
}

export function RemoveWalletForm({ walletId }: { walletId: string }) {
  const [state, action] = useActionState(removeTradingWallet, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="walletId" value={walletId} />
      {state?.error && <Notice>{state.error}</Notice>}
      <ConfirmButton className="btn btn-danger btn-sm" confirmText="Yes, destroy this wallet's key">
        Remove wallet
      </ConfirmButton>
      <p className="hint">Only possible when the wallet holds no ETH or USDG and no agent uses it. Other tokens are not checked: anything left in the wallet is lost with its key.</p>
    </form>
  );
}

export function DeleteAgentForm({ id }: { id: string }) {
  const [state, action] = useActionState(deleteTradingAgent, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <Notice>{state.error}</Notice>}
      <ConfirmButton confirmText="Yes, delete it">Delete agent</ConfirmButton>
    </form>
  );
}
