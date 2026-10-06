const STEPS: { name: string; by: string; tier: "smart" | "fast" | "tool"; credits: string | null }[] = [
  { name: "Plan the run", by: "Smart model", tier: "smart", credits: "0.11" },
  { name: "Read the feed", by: "Web and RSS", tier: "tool", credits: null },
  { name: "Condense 30 stories", by: "Fast model", tier: "fast", credits: "0.03" },
  { name: "Write the briefing", by: "Smart model", tier: "smart", credits: "0.28" },
  { name: "Send to Telegram", by: "Telegram", tier: "tool", credits: null },
];

const TIER_CLASS = {
  smart: "text-primary-soft",
  fast: "text-foreground",
  tool: "text-muted",
} as const;

/** Illustration of a run receipt for the hero. The numbers are an example, not live data. */
export function ReceiptCard() {
  return (
    <div className="card overflow-hidden shadow-[0_24px_80px_-24px_hsl(224_83%_51%/0.35)]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <span className="eyebrow">Example run</span>
        <span className="badge text-success">
          <span className="dot" />
          Succeeded
        </span>
      </div>

      <div className="px-5 pt-5">
        <p className="text-[15px] font-medium">Morning news briefing</p>
        <p className="mt-1 font-mono text-xs text-muted">Schedule · every day at 08:00</p>
      </div>

      <ol className="mt-4 border-t border-line">
        {STEPS.map((step, index) => (
          <li key={step.name} className="flex items-center gap-3 border-b border-line px-5 py-3">
            <span className="w-5 flex-none font-mono text-[11px] text-faint">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">{step.name}</p>
              <p className={`mt-0.5 font-mono text-[11px] ${TIER_CLASS[step.tier]}`}>{step.by}</p>
            </div>
            <span className="flex-none font-mono text-xs tabular-nums text-muted">
              {step.credits ? (
                <>
                  <span className="text-foreground">{step.credits}</span> cr
                </>
              ) : (
                "no charge"
              )}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex items-baseline justify-between px-5 pt-4">
        <span className="text-[13px] text-muted">Total charged</span>
        <span className="font-mono text-sm tabular-nums">
          0.42 <span className="text-muted">credits</span>
        </span>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: "8.4%" }} />
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted">Budget 5.00 · used 0.42</p>
      </div>
    </div>
  );
}
