/**
 * Live Mode is locked in code, not by a setting. Nothing in this app can sign a
 * trade: there is no swap-building or trade-signing code to turn on. The list
 * below is what has to exist and be reviewed before that changes. See
 * docs/TRADING_AGENT.md.
 */
export const LIVE_TRADING_AVAILABLE = false;

export const LIVE_BLOCKERS = [
  "Swap execution on Robinhood Chain (routing, approvals and transaction building) has not been built.",
  "Onchain quotes and transaction simulation against the real pools have not been built. Paper Mode models fills from pool depth.",
  "The wallet and signing design has not had a security review. Permission-limited signing (session keys or a smart account with onchain spending limits) is preferred over a server-held key.",
  "The risk engine, kill switch and position monitor have not been exercised against real fills, partial fills and reverted transactions.",
] as const;

/** What a user has to have done in Paper Mode before Live Mode could be offered to them. */
export const PAPER_REQUIREMENTS = { closedTrades: 10, days: 3 } as const;
