/**
 * B3 — Exact decimal amount parsing for wallet_transfer intents.
 *
 * No floating point anywhere: inputs are decimal strings, outputs are bigint
 * base units. Rejects zero, negatives, excess precision, scientific notation,
 * grouping separators, inner whitespace, and unreasonably large inputs.
 */

export type ParsedAmount = {
  /** Normalized human-readable form, e.g. "2.5" (no trailing zeros). */
  display: string;
  /** Exact integer base units. */
  baseUnits: bigint;
};

export type AmountErrorCode =
  | "INVALID_AMOUNT"
  | "ZERO_AMOUNT"
  | "EXCESS_PRECISION"
  | "AMOUNT_TOO_LARGE";

export class AmountError extends Error {
  readonly code: AmountErrorCode;
  constructor(code: AmountErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_INPUT_CHARS = 64;
const MAX_INTEGER_DIGITS = 24;

/**
 * Parse a human amount string into exact base units for a token with
 * `decimals` places. `decimals` must be the verified on-chain value.
 */
export function parseTransferAmount(input: unknown, decimals: number): ParsedAmount {
  if (typeof input !== "string") {
    throw new AmountError("INVALID_AMOUNT", "Amount must be a decimal string.");
  }
  if (input.length > MAX_INPUT_CHARS) {
    throw new AmountError("AMOUNT_TOO_LARGE", "Amount input is too large.");
  }
  const trimmed = input.trim();
  // Digits with at most one decimal point. No sign, no exponent, no separators.
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new AmountError("INVALID_AMOUNT", "Amount must be a plain decimal number.");
  }
  const intPart = match[1] as string;
  const fracPart = (match[2] ?? "") as string;
  if (intPart.length > MAX_INTEGER_DIGITS) {
    throw new AmountError("AMOUNT_TOO_LARGE", "Amount is unreasonably large.");
  }
  if (fracPart.length > decimals) {
    throw new AmountError(
      "EXCESS_PRECISION",
      `Amount has more decimal places than the asset supports (${decimals}).`,
    );
  }
  const paddedFrac = fracPart.padEnd(decimals, "0");
  const baseUnits =
    BigInt(intPart) * BigInt(10) ** BigInt(decimals) +
    (paddedFrac ? BigInt(paddedFrac) : BigInt(0));
  if (baseUnits <= BigInt(0)) {
    throw new AmountError("ZERO_AMOUNT", "Amount must be greater than zero.");
  }
  const normalizedInt = intPart.replace(/^0+(?=\d)/, "");
  const normalizedFrac = fracPart.replace(/0+$/, "");
  const display = normalizedFrac ? `${normalizedInt}.${normalizedFrac}` : normalizedInt;
  return { display, baseUnits };
}
