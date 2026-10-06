"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";
import { Notice } from "@/components/status";
import { SubmitButton } from "@/components/ui";

export function LoginForm() {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="apiKey">
          API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          className="input font-mono"
          placeholder="ct_live_…"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton className="btn btn-primary btn-lg w-full" pendingText="Checking key…">
        Continue
      </SubmitButton>
    </form>
  );
}
