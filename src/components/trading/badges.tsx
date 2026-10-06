import type { TradingStatus } from "@/lib/db/schema";
import { STATE_LABEL, type TradeState } from "@/lib/trading/states";

const TONES = {
  muted: "text-muted",
  blue: "text-primary-soft",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
} as const;

/** Paper or Live, and Running or Paused, side by side. */
export function AgentBadges({ mode, status, pausedBy }: { mode: "paper" | "live"; status: TradingStatus; pausedBy?: "user" | "breaker" | null }) {
  const state =
    status === "running"
      ? { label: "Running", tone: TONES.success, pulse: true }
      : status === "paused"
        ? { label: pausedBy === "breaker" ? "Auto-paused" : "Paused", tone: TONES.warning, pulse: false }
        : { label: "Stopped", tone: TONES.danger, pulse: false };
  return (
    <span className="flex flex-none items-center gap-1.5">
      <span className={`badge ${mode === "paper" ? TONES.muted : TONES.blue}`}>{mode === "paper" ? "Paper · retired" : "Live · mainnet"}</span>
      <span className={`badge ${state.tone}`}>
        <span className={`dot ${state.pulse ? "pulse" : ""}`} />
        {state.label}
      </span>
    </span>
  );
}

export function TradeStateBadge({ state }: { state: TradeState }) {
  const meta = STATE_LABEL[state];
  return (
    <span className={`badge ${TONES[meta.tone]}`}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}
