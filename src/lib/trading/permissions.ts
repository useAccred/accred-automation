/** What a trading agent may be allowed to do. Kept free of server imports so the form can use it. */

export const PERMISSIONS = {
  READ_MARKET_DATA: { label: "Read market data", detail: "Prices, liquidity and volume for the assets you selected.", sensitive: false },
  READ_BALANCE: { label: "Read balances", detail: "The dedicated wallet's balance and the agent's own positions.", sensitive: false },
  PROPOSE_TRADE: { label: "Propose trades", detail: "The model may suggest a trade. A suggestion moves nothing by itself.", sensitive: false },
  EXECUTE_TRADE: {
    label: "Open positions",
    detail: "A proposal that passes every risk check is executed as a real swap, inside the allocation, after it has been simulated on the chain.",
    sensitive: true,
  },
  CLOSE_POSITION: {
    label: "Close positions",
    detail: "Positions the agent opened are closed when a stop, target or time limit is reached. Closing only ever reduces exposure.",
    sensitive: true,
  },
  MANAGE_PROTECTIVE_ORDERS: {
    label: "Manage protective exits",
    detail: "Stop loss, take profit, trailing stop and break-even moves, enforced by the monitor without the model.",
    sensitive: true,
  },
  SEND_NOTIFICATION: { label: "Send notifications", detail: "Messages to the connections you select. Messaging never grants trading authority.", sensitive: false },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_LIST = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

/** What "Revoke trading access" takes away. Protective exits stay so open positions are never left unguarded. */
export const TRADING_AUTHORITY: Permission[] = ["PROPOSE_TRADE", "EXECUTE_TRADE"];

/** An agent that may open positions must also be able to protect and close them. */
export const REQUIRED_WITH_EXECUTE: Permission[] = ["READ_MARKET_DATA", "READ_BALANCE", "PROPOSE_TRADE", "CLOSE_POSITION", "MANAGE_PROTECTIVE_ORDERS"];
