"use client";

import { useActionState } from "react";
import { replaceKey } from "@/app/actions";
import { Notice } from "@/components/status";
import { SubmitButton } from "@/components/ui";

export function ReplaceKeyForm() {
  const [state, action] = useActionState(replaceKey, undefined);
  return (
    <form action={action} className="mt-5 space-y-3 border-t border-line pt-5">
      <label className="label" htmlFor="apiKey">
        Replace with a new key
      </label>
      <div className="flex flex-wrap gap-2">
        <input id="apiKey" name="apiKey" type="password" className="input min-w-0 flex-1 basis-56 font-mono" placeholder="ct_live_…" autoComplete="off" spellCheck={false} required />
        <SubmitButton className="btn btn-secondary" pendingText="Checking…">
          Replace key
        </SubmitButton>
      </div>
      {state?.error && <Notice>{state.error}</Notice>}
      {state?.values?.saved && <Notice tone="success">Key replaced. New runs use it from now on.</Notice>}
    </form>
  );
}
