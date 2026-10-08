"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

const FAQ = [
  {
    q: "How is a bot different from a chat assistant?",
    a: "A bot has a job and keeps it. It remembers what you told it, uses your connected apps to read and draft, and comes back with the work. Anything that sends, posts or changes something waits for your Confirm in the thread.",
  },
  {
    q: "What can a bot connect to?",
    a: "Web pages and feeds are built in. Connect Gmail (read-only), Telegram, Slack, Discord, GitHub or any HTTP API on the Connections page and every bot can use them.",
  },
  {
    q: "What does it cost?",
    a: "The model cost of each reply, from your Accred credits, with no markup. 100 credits is $1. Each bot has a budget per message and per day that stops it; the defaults are 3 and 50 credits.",
  },
  {
    q: "Which model answers?",
    a: "Auto mode uses a strong model to think and a fast one to read long pages. You can switch a bot to Economy, Best quality, or pin one of the 450+ models in the Accred catalog.",
  },
  {
    q: "Can a bot trade or move funds?",
    a: "No. The Trading Desk bot reports on your trading agents with exact numbers, but trades are decided by the risk engine inside an agent's mandate. Nothing in a thread can withdraw funds or accept a key.",
  },
  {
    q: "Is there a Telegram version?",
    a: "Yes. @AccredAgentbot is the same agent in Telegram, with the same tools and confirmations. Link it on the Connections page.",
  },
];

export function BotFaq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ul className="divide-y divide-line border-y border-line">
      {FAQ.map((item, index) => (
        <li key={item.q}>
          <button type="button" onClick={() => setOpen(open === index ? null : index)} className="flex w-full items-center justify-between gap-6 py-5 text-left">
            <span className="text-[16px] font-medium">{item.q}</span>
            <Plus size={18} className={`flex-none text-muted transition-transform ${open === index ? "rotate-45" : ""}`} aria-hidden />
          </button>
          {open === index ? <p className="pb-6 text-[15px] leading-relaxed text-muted">{item.a}</p> : null}
        </li>
      ))}
    </ul>
  );
}
