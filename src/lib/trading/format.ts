/** Display helpers for dollar amounts, token prices and percentages. Safe to use in the browser. */

export function fmtUsd(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = digits ?? (abs >= 1000 ? 0 : 2);
  return `${value < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** A dollar result with its sign, such as +$14.82 or -$0.31. */
export function signedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // Rounded to cents first, so a result smaller than a cent reads $0.00 and not -$0.00.
  const cents = Math.round(value * 100) / 100;
  const text = fmtUsd(Math.abs(cents), 2);
  return cents > 0 ? `+${text}` : cents < 0 ? `-${text}` : text;
}

/** Token prices run from fractions of a cent to thousands of dollars, so they keep significant digits instead of fixed decimals. */
export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${Number(value.toPrecision(4)).toString()}`;
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function pnlTone(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.round(value * 100) === 0) return "text-muted";
  return value > 0 ? "text-success" : "text-danger";
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function compactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
