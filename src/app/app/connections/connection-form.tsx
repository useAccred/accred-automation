"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { addConnection } from "@/app/actions";
import { Notice } from "@/components/status";
import { SubmitButton } from "@/components/ui";
import type { ConnectionKindInfo } from "@/lib/connections/kinds";

export function ConnectionForm({ info }: { info: ConnectionKindInfo }) {
  const [state, action] = useActionState(addConnection, undefined);
  const [open, setOpen] = useState(false);
  const saved = state?.values?.saved === info.kind;
  // After a failed attempt the non-secret fields come back so they need not be retyped.
  const previous = state?.error ? state.values : undefined;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{info.label}</p>
          <p className="mt-0.5 text-[13px] text-muted">{info.blurb}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm flex-none" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <Plus size={13} className={`transition-transform ${open ? "rotate-45" : ""}`} />
          {open ? "Close" : "Add"}
        </button>
      </div>

      {open && (
        <form action={action} className="mt-4 space-y-3 border-t border-line pt-4">
          <input type="hidden" name="kind" value={info.kind} />
          <div>
            <label className="label" htmlFor={`${info.kind}-name`}>
              Name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id={`${info.kind}-name`} name="name" className="input" maxLength={60} placeholder={`My ${info.label}`} defaultValue={previous?.name ?? ""} />
          </div>
          {info.fields.map((field) => (
            <div key={field.key}>
              <label className="label" htmlFor={`${info.kind}-${field.key}`}>
                {field.label} {!field.required && <span className="font-normal text-muted">(optional)</span>}
              </label>
              <input
                id={`${info.kind}-${field.key}`}
                name={field.key}
                type={field.secret ? "password" : "text"}
                className="input font-mono"
                placeholder={field.placeholder}
                required={field.required}
                autoComplete="off"
                spellCheck={false}
                defaultValue={field.secret ? "" : (previous?.[field.key] ?? "")}
              />
              {field.help && <p className="hint">{field.help}</p>}
            </div>
          ))}
          {state?.error && <Notice>{state.error}</Notice>}
          {saved && <Notice tone="success">Connected. Link it to an automation to use it.</Notice>}
          <SubmitButton className="btn btn-primary" pendingText="Checking…">
            Connect {info.label}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
