"use client";

import Link from "next/link";
import { useState } from "react";
import { MuseFace } from "@/components/muse";
import { BOT_PRESETS } from "@/lib/bot/presets";

/** The preset chips with a one-line pitch for the chosen job. */
export function JobPicker() {
  const [activeId, setActiveId] = useState(BOT_PRESETS[0]!.id);
  const preset = BOT_PRESETS.find((entry) => entry.id === activeId)!;
  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-start">
      <div>
        <ul className="flex max-w-xl flex-wrap gap-2">
          {BOT_PRESETS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setActiveId(entry.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors ${
                  entry.id === activeId ? "border-line-strong bg-raised text-foreground" : "border-line text-muted hover:text-foreground"
                }`}
              >
                {entry.id === activeId ? <MuseFace color={entry.color} shape={entry.shape} size={16} /> : null}
                {entry.name}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
          <span className="text-foreground">{preset.tagline}</span> {preset.role}
        </p>
        <p className="mt-4 text-[13px] text-faint">
          {preset.needs.length ? `Works best with ${preset.needs.join(", ")} connected.` : "Works with the built-in tools. Connect apps to give it more."}
        </p>
        <Link href={`/app/bot?preset=${preset.id}`} className="btn btn-secondary mt-8">
          Create {preset.name}
        </Link>
      </div>
      <div className="bw mx-auto w-full max-w-sm rounded-[32px] border border-white/[0.1] p-4">
        <div className="flex items-center gap-3 px-2 pt-2">
          <MuseFace color={preset.color} shape={preset.shape} size={28} />
          <span className="text-[16px] text-white/[0.92]">{preset.name}</span>
        </div>
        <div className="mt-5 flex flex-col gap-3 px-1 pb-2">
          <span className="bw-user self-end rounded-[20px] px-4 py-3 text-[15px]">{preset.starter}</span>
          <span className="bw-bot self-start rounded-[20px] px-4 py-3 text-[15px] text-white/[0.88]">on it. i&apos;ll show you what i find before anything goes out.</span>
        </div>
      </div>
    </div>
  );
}
