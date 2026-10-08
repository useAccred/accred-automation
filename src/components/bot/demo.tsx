"use client";

import Link from "next/link";
import { useState } from "react";
import { DEMO_BOTS, DEMO_PERSON } from "@/lib/bot/demo";
import { BotWindow, Composer, type ThreadItem } from "./window";

/** The landing-page workspace. The sidebar switches threads; messaging needs an account. */
export function DemoWindow() {
  const [activeId, setActiveId] = useState("expense");
  const bot = DEMO_BOTS.find((entry) => entry.id === activeId)!;
  const thread: ThreadItem[] = bot.thread.map((line, index) => {
    const id = `${bot.id}-${index}`;
    if (line.t === "time") return { type: "time", id, label: line.label };
    if (line.t === "user") return { type: "user", id, text: line.text };
    if (line.t === "bot") return { type: "bot", id, text: line.text };
    return { type: "event", id, icon: line.icon, text: line.text };
  });
  return (
    <BotWindow
      bots={DEMO_BOTS.map((entry) => ({ id: entry.id, name: entry.name, color: entry.color, shape: entry.shape, crew: entry.crew, time: entry.time, preview: entry.preview }))}
      activeId={activeId}
      onSelect={setActiveId}
      thread={thread}
      person={DEMO_PERSON}
      className="h-[720px] w-full"
      composer={
        <Composer
          placeholder={`Message ${bot.name}`}
          disabled
          hint={
            <Link href="/login" className="flex min-h-[40px] w-full items-center py-2 text-[18px] text-white/50 transition-colors hover:text-white/80">
              Message {bot.name} · sign in to start
            </Link>
          }
        />
      }
    />
  );
}
