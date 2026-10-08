import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DemoWindow } from "@/components/bot/demo";
import { BotFaq } from "@/components/bot/faq";
import { JobPicker } from "@/components/bot/job-picker";
import { Logo } from "@/components/logo";
import { MuseFace } from "@/components/muse";

export const metadata: Metadata = {
  title: "Accred Bot — AI teammates that finish the work",
  description:
    "Give real work to bots. Each one has a job, keeps context, uses your apps, asks before it writes anything, and is paid per message from your Accred credits.",
};

const NAV = [
  { href: "#teammates", label: "Teammates" },
  { href: "#jobs", label: "Jobs" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const CARDS = [
  {
    title: "Bots work where you work",
    body: "Connect Gmail, Telegram, Slack, Discord or GitHub once. A bot reads and drafts through them the way you would, and never sends without your ok.",
    chip: "You're in control",
    lines: ["Search mail from this week", "Read the thread from Globex", "Draft a reply in your voice"],
  },
  {
    title: "Show a bot how it's done",
    body: "Tell a bot the job in plain words once. Turn the steps it took into an automation that runs on a schedule, with a budget that stops it.",
    chip: "Routine",
    lines: ["Every weekday at 08:00", "Read the feeds, pick five stories", "Send the brief to Telegram"],
  },
  {
    title: "Bots get smarter over time",
    body: "Each bot keeps its own memory. Tell it a preference today and it remembers who approves, what they care about and how you like things written.",
    chip: "Memory",
    lines: ["Globex only signs annual", "Vikram approves", "Lead with usage numbers"],
  },
  {
    title: "The right model for each step",
    body: "A strong model plans and decides. A fast, cheap one reads long pages. Pin any of the 450+ models in the Accred catalog when you want a specific one.",
    chip: "Auto",
    lines: ["Plan · smart model", "Read 30 stories · fast model", "Write the answer · smart model"],
  },
];

const INCLUDED = ["Every bot preset, or your own", "Memory per bot", "Your connections: Gmail, Telegram, Slack, Discord, GitHub, HTTP", "Confirm before anything is sent or changed", "A credit budget per message and per day", "A receipt for every reply"];

export default function BotLandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-7 text-[13px] text-muted md:flex" aria-label="Main">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </a>
            ))}
            <Link href="/" className="transition-colors hover:text-foreground">
              Automations
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <a href="https://accred.sh" className="btn btn-secondary max-sm:hidden">
              accred.sh
            </a>
            <Link href="/app/bot" className="btn btn-primary">
              Open Accred Bot
            </Link>
          </div>
        </div>
      </header>

      <section className="glow">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-10 pt-16 text-center sm:px-8 sm:pt-24">
          <Link href="/app/bot" className="badge h-7 gap-2 px-3 text-[12px] normal-case tracking-normal text-foreground transition-colors hover:border-line-strong">
            <span className="font-medium">Accred Bot is here</span>
            <span className="text-muted">· Open the workspace</span>
            <ArrowUpRight size={12} aria-hidden />
          </Link>
          <h1 className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[3.25rem] font-semibold leading-none tracking-[-0.04em] sm:text-7xl lg:text-[5.5rem]">
            <span>Meet</span>
            <MuseFace light size={72} className="h-[0.9em] w-[0.9em]" eyes={{ x: 3, y: 1 }} />
            <span>Accred</span>
            <span className="text-faint">Bot</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            AI teammates you can give real work to. Bots use your apps and your connections, keep context on how you work, and come back with finished work. Paid per message from your Accred credits.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app/bot" className="btn btn-primary btn-lg">
              Open Accred Bot
              <ArrowUpRight size={15} aria-hidden />
            </Link>
            <Link href="/login" className="btn btn-secondary btn-lg">
              Sign in with your key
            </Link>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1280px] px-3 pb-20 sm:px-6">
          <DemoWindow />
        </div>
      </section>

      <section id="teammates" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
          <div className="card relative overflow-hidden rounded-3xl px-8 py-14 sm:px-12 sm:py-20">
            <div className="relative z-10 max-w-md">
              <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">Message bots like teammates</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-muted sm:text-base">
                Give tasks to bots the way you would a teammate. Each one takes a job from start to end, keeps context on how you work, gets smarter with every thread, and comes back when your confirmation is needed.
              </p>
            </div>
            <div className="pointer-events-none absolute -bottom-24 right-[-4rem] hidden md:block" aria-hidden>
              <MuseFace light size={440} eyes={{ x: -4, y: 2 }} />
            </div>
            <div className="pointer-events-none absolute inset-0 hidden md:block" aria-hidden>
              {[
                ["teal", "70%", "22%"],
                ["orange", "60%", "60%"],
                ["violet", "86%", "32%"],
                ["blue", "64%", "40%"],
                ["rose", "92%", "70%"],
              ].map(([color, left, top]) => (
                <span key={color} className="absolute h-3 w-3 rounded-full" style={{ left, top, background: `var(--muse-${color})` }} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">Work with many bots at once</h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted sm:text-base">
            Create a bot, give it a task, and add another when the work grows: one on a project, one on outbound, one on the inbox. Bots work in parallel, each with its own memory and budget, and keep working while you do something else.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {CARDS.map((card) => (
            <article key={card.title} className="card flex flex-col rounded-3xl p-7 sm:p-8">
              <h3 className="text-[17px] font-medium">{card.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{card.body}</p>
              <div className="bw mt-7 rounded-2xl border border-white/[0.07] p-4 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Thread</span>
                  <span className="badge border-white/[0.12] text-white/70">
                    <span className="dot text-primary-soft" />
                    {card.chip}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {card.lines.map((line) => (
                    <li key={line} className="bw-bot rounded-xl px-3.5 py-2.5 text-white/[0.88]">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="jobs" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">Give each bot a job</h2>
          <JobPicker />
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">Pricing</h2>
            <p className="mt-4 text-[15px] text-muted">There is no plan. Bots are paid per message from the credits behind your API key.</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-[1.1fr_0.9fr]">
            <div className="card rounded-3xl p-7 sm:p-8">
              <p className="eyebrow">Pay per message</p>
              <p className="mt-4 font-mono text-4xl tracking-tight">
                100 credits <span className="text-muted">=</span> $1
              </p>
              <p className="mt-2 text-[14px] text-muted">The model cost of each reply, with no markup on model prices. A typical reply costs a few hundredths of a credit.</p>
              <Link href="/login" className="btn btn-primary btn-lg mt-6 w-full">
                Start with your key
              </Link>
              <ul className="mt-7 space-y-2.5">
                {INCLUDED.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-[14px] text-muted">
                    <Check size={15} className="mt-0.5 flex-none text-foreground" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card flex flex-col justify-between rounded-3xl p-7 sm:p-8">
              <div>
                <p className="eyebrow">Also in Telegram</p>
                <p className="mt-4 text-[17px] font-medium">The same agent, in your pocket</p>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">
                  @AccredAgentbot answers in Telegram with the same tools and the same confirmations. Link it from Connections and talk to it anywhere.
                </p>
              </div>
              <a href="https://t.me/AccredAgentbot" className="btn btn-secondary mt-6 w-full">
                Open in Telegram
                <ArrowUpRight size={14} aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.6fr_1.4fr]">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">FAQs</h2>
          <BotFaq />
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-5 py-16 sm:px-8 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">
              Give your first bot a job.
              <br />
              <span className="text-primary-soft">It starts in a minute.</span>
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">Sign in with your Accred API key. Your chief of staff is waiting.</p>
          </div>
          <Link href="/app/bot" className="btn btn-primary btn-lg flex-none">
            Open Accred Bot
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo />
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted" aria-label="Footer">
            <a href="https://accred.sh" className="transition-colors hover:text-foreground">
              accred.sh
            </a>
            <Link href="/" className="transition-colors hover:text-foreground">
              Automations
            </Link>
            <a href="https://github.com/useAccred" className="transition-colors hover:text-foreground">
              GitHub
            </a>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
