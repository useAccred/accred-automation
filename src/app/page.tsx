import Link from "next/link";
import { ArrowRight, ArrowUpRight, Braces, Gauge, GitPullRequest, Hash, MessagesSquare, ReceiptText, Rss, Send, ShieldCheck, type LucideIcon, Mail } from "lucide-react";
import { Logo } from "@/components/logo";
import { ReceiptCard } from "@/components/marketing/receipt-card";
import { Section } from "@/components/marketing/section";
import { COMING_SOON, CONNECTION_KINDS, CONNECTION_KIND_LIST, type ConnectionKind } from "@/lib/connections/kinds";
import { TEMPLATES } from "@/lib/templates";

const KIND_ICONS: Record<ConnectionKind, LucideIcon> = {
  telegram: Send,
  gmail: Mail,
  slack: Hash,
  discord: MessagesSquare,
  github: GitPullRequest,
  http: Braces,
};

const STEPS = [
  {
    number: "01",
    title: "Connect",
    body: "Link Telegram, Slack, Discord, GitHub or any HTTP API. Each automation only gets the connections you give it.",
  },
  {
    number: "02",
    title: "Describe",
    body: "Write what you want in plain words. Pick a trigger, a schedule or a webhook, and set a credit budget.",
  },
  {
    number: "03",
    title: "Run",
    body: "The agent picks the model for each step, asks before it writes anything if you want, and stops at your budget.",
  },
];

const BRAIN = [
  {
    label: "Smart model",
    tone: "text-primary-soft",
    body: "Plans the run, decides the next step and writes the result.",
  },
  {
    label: "Fast model",
    tone: "text-foreground",
    body: "Reads long pages and feeds and condenses them, so the expensive model sees only what matters.",
  },
  {
    label: "Pinned model",
    tone: "text-muted",
    body: "Prefer one model for everything? Pin any model from the catalog and Auto steps aside.",
  },
];

const CONTROLS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Approval before it writes",
    body: "Reading is automatic. Sending, posting or changing anything waits for your approval. This is on by default, and you can turn it off per automation.",
  },
  {
    icon: Gauge,
    title: "A budget that stops the agent",
    body: "Set a credit cap per run and per month. When a run would go over, the agent stops instead of spending more.",
  },
  {
    icon: ReceiptText,
    title: "A receipt for every step",
    body: "Each run keeps a step-by-step log with the exact credits charged for every model call.",
  },
];

const PRICING = [
  "You pay the model cost of each run from your Accred credits.",
  "100 credits = $1, with no markup on model prices.",
  "Automation itself has no extra fee in this version.",
];

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#templates", label: "Templates" },
  { href: "#pricing", label: "Pricing" },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col overflow-x-clip">
      <div className="glow">
        <header className="border-b border-line">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
            <Logo />
            <nav className="hidden items-center gap-7 text-[13px] text-muted md:flex" aria-label="Main">
              {NAV.map((item) => (
                <a key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                  {item.label}
                </a>
              ))}
              <a
                href="https://accred.sh"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                accred.sh
                <ArrowUpRight size={13} aria-hidden />
              </a>
            </nav>
            <Link href="/login" className="btn btn-primary">
              Open app
            </Link>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-28">
          <div className="min-w-0">
            <h1 className="text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-[4.5rem]">
              Describe the job.
              <br />
              <span className="text-primary-soft">An agent runs it.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-[17px]">
              Connect your apps and write the job in plain words. An agent runs it on a schedule or when a webhook
              arrives.{" "}
              <span className="text-foreground">
                Each run is paid from your Accred credits with an exact receipt. No subscription.
              </span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn btn-primary btn-lg">
                Start automating
                <ArrowUpRight size={15} aria-hidden />
              </Link>
              <a href="#templates" className="btn btn-secondary btn-lg">
                See templates
              </a>
            </div>
            <p className="eyebrow mt-8 flex items-center gap-2.5">
              <span className="dot flex-none text-primary" />
              <span>100 credits = $1 · pay per run · no subscription</span>
            </p>
          </div>

          <div className="mx-auto w-full min-w-0 max-w-md lg:max-w-none">
            <ReceiptCard />
          </div>
        </section>
      </div>

      <section id="how" className="scroll-mt-20 border-y border-line">
        <div className="mx-auto grid w-full max-w-6xl divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
          {STEPS.map((step) => (
            <div key={step.number} className="px-5 py-8 sm:px-8 md:py-10">
              <p className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-faint">{step.number}</span>
                <span className="text-[15px] font-medium">{step.title}</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="eyebrow">The brain</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">
            The right model for each step
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
            In Auto mode the agent uses a strong model to plan and decide, and a cheap fast model to read and condense
            long pages. It chooses from the 450+ models in the Accred catalog, so you are not tied to one vendor.
          </p>
          <p className="eyebrow mt-8 flex items-center gap-2.5">
            <span className="dot flex-none text-primary" />
            <span>One key · one balance</span>
          </p>
        </div>
        <div className="card divide-y divide-line">
          {BRAIN.map((row) => (
            <div key={row.label} className="flex flex-col gap-1.5 px-5 py-5 sm:flex-row sm:gap-6">
              <p className={`w-32 flex-none font-mono text-xs leading-6 ${row.tone}`}>{row.label}</p>
              <p className="text-sm leading-relaxed text-muted">{row.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Section
        id="templates"
        eyebrow="Templates"
        title="Start from a working automation"
        lead="Pick one, swap in your own links and limits, and run it. Every template is plain text you can edit."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <Link
              key={template.id}
              href={`/app/new?template=${template.id}`}
              className="card group flex flex-col p-5 transition-colors hover:border-line-strong hover:bg-raised"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">{template.category}</span>
                <ArrowUpRight
                  size={15}
                  className="text-faint transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </div>
              <h3 className="mt-4 text-[15px] font-medium">{template.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{template.description}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="badge">{template.triggerLabel}</span>
                {template.connections.map((kind) => (
                  <span key={kind} className="badge">
                    {CONNECTION_KINDS[kind].label}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="Connections"
        title="Works with the tools you already use"
        lead="Connect an app once and choose which automations may use it."
      >
        <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          <ConnectionRow icon={Rss} name="Web pages and RSS" blurb="Built in. No setup needed." tag="Built in" />
          {CONNECTION_KIND_LIST.map((info) => (
            <ConnectionRow key={info.kind} icon={KIND_ICONS[info.kind]} name={info.label} blurb={info.blurb} />
          ))}
          {COMING_SOON.map((name) => (
            <ConnectionRow key={name} name={name} blurb="Not available yet." tag="Soon" dimmed />
          ))}
        </ul>
      </Section>

      <Section
        eyebrow="Control"
        title="You stay in charge of what it does and what it spends"
      >
        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {CONTROLS.map((control) => (
            <div key={control.title}>
              <control.icon size={20} className="text-primary-soft" aria-hidden />
              <h3 className="mt-4 text-[15px] font-medium">{control.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{control.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="There is no plan">
        <div className="card grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <ul className="space-y-4">
            {PRICING.map((line) => (
              <li key={line} className="flex items-start gap-3 text-[15px] leading-relaxed">
                <span className="dot mt-[0.6rem] flex-none text-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="lg:text-right">
            <p className="font-mono text-2xl tracking-tight sm:text-3xl">
              100 credits <span className="text-muted">=</span> $1
            </p>
            <p className="eyebrow mt-2">Pay per run</p>
          </div>
        </div>
      </Section>

      <section className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-5 py-16 sm:px-8 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">
              Put your credits to work.
              <br />
              <span className="text-primary-soft">Start with one automation.</span>
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
              Sign in with your Accred API key, connect one app and run your first job.
            </p>
          </div>
          <Link href="/login" className="btn btn-primary btn-lg flex-none">
            Start automating
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
            <a href="https://accred.sh/docs" className="transition-colors hover:text-foreground">
              Docs
            </a>
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

function ConnectionRow({
  icon: Icon,
  name,
  blurb,
  tag,
  dimmed,
}: {
  icon?: LucideIcon;
  name: string;
  blurb: string;
  tag?: string;
  dimmed?: boolean;
}) {
  return (
    <li className="flex items-start gap-3.5 bg-card px-5 py-5">
      <span
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line bg-raised ${
          dimmed ? "text-faint" : "text-foreground"
        }`}
      >
        {Icon ? <Icon size={15} aria-hidden /> : <span className="dot" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${dimmed ? "text-muted" : ""}`}>
          {name}
          {tag ? <span className="badge">{tag}</span> : null}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{blurb}</p>
      </div>
    </li>
  );
}
