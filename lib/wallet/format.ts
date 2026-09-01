/**
 * Pure display helpers for wallet UI. No floating-point money math.
 */

import { formatUnits, type Address } from "viem";

/**
 * Truncate an EVM address for display: 0x1234…abcd
 */
export function truncateAddress(
  address: string,
  opts?: { leading?: number; trailing?: number },
): string {
  const leading = opts?.leading ?? 6;
  const trailing = opts?.trailing ?? 4;
  if (!address || address.length < leading + trailing + 2) {
    return address;
  }
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

/**
 * Format a token amount from bigint using viem formatUnits (decimal string).
 * Does not use JavaScript Number for the conversion.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  opts?: { maxFractional?: number },
): string {
  const full = formatUnits(value, decimals);
  const maxFractional = opts?.maxFractional;
  if (maxFractional === undefined) {
    return full;
  }
  const [intPart, fracPart = ""] = full.split(".");
  if (fracPart.length <= maxFractional) {
    return full;
  }
  // Truncate fractional digits (display only — not rounded via float)
  const truncated = fracPart.slice(0, maxFractional).replace(/0+$/, "");
  return truncated.length > 0 ? `${intPart}.${truncated}` : intPart;
}

export function isValidAddress(value: string | null | undefined): value is Address {
  if (!value || typeof value !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
