/** The life of one trade. Every move between states is written to the audit log. */

export const TRADE_STATES = [
  "DISCOVERED",
  "PROPOSED",
  "RISK_REJECTED",
  "APPROVED",
  "SIMULATED",
  "EXECUTING",
  "OPEN",
  "PARTIAL_EXIT",
  "CLOSED",
  "FAILED",
  "CANCELLED",
] as const;

export type TradeState = (typeof TRADE_STATES)[number];

const NEXT: Record<TradeState, TradeState[]> = {
  DISCOVERED: ["PROPOSED", "CANCELLED"],
  PROPOSED: ["APPROVED", "RISK_REJECTED", "CANCELLED", "FAILED"],
  APPROVED: ["SIMULATED", "RISK_REJECTED", "CANCELLED", "FAILED"],
  // The final check runs on the fresh quote, so a simulated trade can still be rejected.
  SIMULATED: ["EXECUTING", "RISK_REJECTED", "CANCELLED", "FAILED"],
  EXECUTING: ["OPEN", "FAILED"],
  OPEN: ["PARTIAL_EXIT", "CLOSED"],
  PARTIAL_EXIT: ["PARTIAL_EXIT", "CLOSED"],
  RISK_REJECTED: [],
  CLOSED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: TradeState, to: TradeState): boolean {
  return NEXT[from].includes(to);
}

export function isTerminal(state: TradeState): boolean {
  return NEXT[state].length === 0;
}

/** States a trade can be left in when a process dies before it holds anything. */
export const IN_FLIGHT: TradeState[] = ["DISCOVERED", "PROPOSED", "APPROVED", "SIMULATED", "EXECUTING"];

export const STATE_LABEL: Record<TradeState, { label: string; tone: "muted" | "blue" | "success" | "danger" | "warning" }> = {
  DISCOVERED: { label: "Discovered", tone: "muted" },
  PROPOSED: { label: "Proposed", tone: "blue" },
  RISK_REJECTED: { label: "Rejected by risk engine", tone: "warning" },
  APPROVED: { label: "Approved", tone: "blue" },
  SIMULATED: { label: "Simulated", tone: "blue" },
  EXECUTING: { label: "Executing", tone: "blue" },
  OPEN: { label: "Executed · open", tone: "success" },
  PARTIAL_EXIT: { label: "Partly closed", tone: "success" },
  CLOSED: { label: "Closed", tone: "muted" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};
