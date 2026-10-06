/** Credit math in integer microcredits. 1 credit = 1,000,000 microcredits; 100 credits = $1. */

export const MICRO = 1_000_000n;

/** Parses a decimal credit string such as "0.004213". Anything past six decimals rounds up. */
export function toMicro(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid credit amount "${value}"`);
  const fraction = match[2] ?? "";
  const kept = BigInt(match[1]!) * MICRO + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
  return /[1-9]/.test(fraction.slice(6)) ? kept + 1n : kept;
}

/** Parses a balance, dropping anything past six decimals so it is never overstated. */
export function balanceToMicro(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid credit amount "${value}"`);
  return BigInt(match[1]!) * MICRO + BigInt((match[2] ?? "").slice(0, 6).padEnd(6, "0"));
}

/** Exact decimal string, e.g. 4213n -> "0.004213". */
export function microToExact(value: bigint): string {
  const whole = value / MICRO;
  const fraction = (value % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Short display form: two decimals from 1 credit up, four below. */
export function formatCredits(value: bigint): string {
  const decimals = value >= MICRO || value === 0n ? 2 : 4;
  const unit = 10n ** BigInt(6 - decimals);
  const rounded = (value + unit / 2n) / unit;
  const scale = 10n ** BigInt(decimals);
  const whole = (rounded / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(rounded % scale).toString().padStart(decimals, "0")}`;
}

export function formatUsd(value: bigint): string {
  // 100 credits = $1, so one microcredit is 1e-8 dollars.
  const dollars = Number(value) / 1e8;
  if (dollars === 0) return "$0.00";
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}
